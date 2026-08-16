import WebSocket from 'ws';

const relayUrl = process.env.POCKETDESK_LIVE_RELAY;
const sessionId = process.env.POCKETDESK_LIVE_SESSION;
const viewerToken = process.env.POCKETDESK_LIVE_VIEWER_TOKEN;
if (!relayUrl || !sessionId || !viewerToken) {
  throw new Error('POCKETDESK_LIVE_RELAY, POCKETDESK_LIVE_SESSION, and POCKETDESK_LIVE_VIEWER_TOKEN are required');
}

const socketUrl = `${relayUrl.replace(/^http/, 'ws')}/connect/${sessionId}`;
const viewer = new WebSocket(socketUrl, ['pocketdesk-v1', `viewer.${viewerToken}`]);
await opened(viewer);
const observedErrors = [];
const observeErrors = (data, binary) => {
  if (binary) return;
  try {
    const message = JSON.parse(data.toString());
    if (message.type === 'error') observedErrors.push({ code: message.code, message: message.message });
  } catch {
    // Ignore unrelated relay messages.
  }
};
viewer.on('message', observeErrors);

viewer.send(JSON.stringify({ type: 'request-shell' }));
const catalogMessage = await nextJson(viewer, 'shell-snapshot', 20_000);
const apps = Array.isArray(catalogMessage.payload?.apps) ? catalogMessage.payload.apps : [];
const cameraApp = apps.find((app) => /^camera$/i.test(app?.name ?? ''));
const iconTarget = cameraApp ?? apps.find((app) => app?.pinned && typeof app.iconKey === 'string');
const iconKeys = typeof iconTarget?.iconKey === 'string' ? [iconTarget.iconKey] : [];
const iconPromise = nextJsonWhere(viewer, 'app-icon', (message) => message.payload?.key === iconTarget?.iconKey, 30_000);
viewer.send(JSON.stringify({ type: 'request-icons', payload: { keys: iconKeys } }));
const iconMessage = await iconPromise;
console.error('[smoke] catalog and packaged icon');

const initialSemanticPromise = nextJson(viewer, 'semantic-snapshot', 20_000);
viewer.send(JSON.stringify({ type: 'request-semantic' }));
const initialSemantic = await initialSemanticPromise;
console.error('[smoke] initial semantic snapshot');
const windows = Array.isArray(initialSemantic.payload?.windows) ? initialSemantic.payload.windows : [];
const explorerWindow = windows.find((window) => window?.process === 'explorer' && /file explorer/i.test(window?.title ?? ''));
const testWindow = explorerWindow
  ?? windows.find((window) => window?.process === 'Notepad')
  ?? windows.find((window) => window?.process === 'PhoneExperienceHost')
  ?? windows.find((window) => window?.process !== 'ChatGPT' && window?.process !== 'PickerHost');
let adaptedSemantic = initialSemantic;
let appVisual = null;
if (Number.isSafeInteger(testWindow?.processId)) {
  const adaptedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => message.payload?.activeWindowHandle === testWindow.windowHandle,
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'focusWindow', processId: testWindow.processId, windowHandle: testWindow.windowHandle } }));
  adaptedSemantic = await adaptedPromise;
  const visualPromise = nextJsonWhere(
    viewer,
    'app-visual',
    (message) => message.payload?.windowHandle === testWindow.windowHandle,
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'request-app-visual', payload: { processId: testWindow.processId, windowHandle: testWindow.windowHandle } }));
  appVisual = await visualPromise;
}
console.error('[smoke] adapted window and visual');

const opaqueWindow = windows.find((window) => /settings/i.test(`${window?.process ?? ''} ${window?.title ?? ''}`));
let opaqueSemantic = null;
let opaqueVisual = null;
if (Number.isSafeInteger(opaqueWindow?.processId)) {
  const semanticPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => message.payload?.activeWindowHandle === opaqueWindow.windowHandle,
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'focusWindow', processId: opaqueWindow.processId, windowHandle: opaqueWindow.windowHandle } }));
  opaqueSemantic = await semanticPromise;
  const visualPromise = nextJsonWhere(
    viewer,
    'app-visual',
    (message) => message.payload?.windowHandle === opaqueWindow.windowHandle,
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'request-app-visual', payload: { processId: opaqueWindow.processId, windowHandle: opaqueWindow.windowHandle } }));
  opaqueVisual = await visualPromise;
}
console.error('[smoke] optional Settings window');

viewer.send(JSON.stringify({ type: 'search-shell', payload: { query: 'Bezi' } }));
const searchMessage = await nextJson(viewer, 'shell-results', 20_000);
const searchApps = Array.isArray(searchMessage.payload?.apps) ? searchMessage.payload.apps : [];
const searchFiles = Array.isArray(searchMessage.payload?.files) ? searchMessage.payload.files : [];
console.error('[smoke] shell search');

const fileExplorerApp = apps.find((app) => /^file explorer$/i.test(app?.name ?? ''));
let launchedExplorerSelected = false;
if (typeof fileExplorerApp?.id === 'string') {
  const launchedPromise = nextJson(viewer, 'shell-launched', 20_000);
  const selectedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => {
      const activeHandle = message.payload?.activeWindowHandle;
      const openWindows = Array.isArray(message.payload?.windows) ? message.payload.windows : [];
      const active = openWindows.find((window) => window?.windowHandle === activeHandle);
      return active?.process === 'explorer' && /file explorer/i.test(active?.title ?? '');
    },
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'launch-shell', payload: { id: fileExplorerApp.id } }));
  await launchedPromise;
  const selected = await selectedPromise;
  launchedExplorerSelected = /file explorer/i.test(selected.payload?.activeTitle ?? '');
}
console.error('[smoke] File Explorer launch');

const beziApp = apps.find((app) => /^bezi$/i.test(app?.name ?? ''));
let launchedBeziSelected = false;
let beziBurstRecovered = false;
if (typeof beziApp?.id === 'string') {
  const launchedPromise = nextJson(viewer, 'shell-launched', 20_000);
  const selectedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => {
      const activeHandle = message.payload?.activeWindowHandle;
      const openWindows = Array.isArray(message.payload?.windows) ? message.payload.windows : [];
      return openWindows.some((window) => window?.windowHandle === activeHandle && window?.process === 'Bezi');
    },
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'launch-shell', payload: { id: beziApp.id } }));
  await launchedPromise;
  await selectedPromise;
  launchedBeziSelected = true;
  const refreshedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => /bezi/i.test(message.payload?.activeTitle ?? ''),
    30_000,
  );
  for (let index = 0; index < 6; index += 1) {
    viewer.send(JSON.stringify({ type: 'request-semantic' }));
  }
  await refreshedPromise;
  beziBurstRecovered = true;
}
console.error('[smoke] Bezi launch');

let launchedCameraSelected = false;
let cameraSemantic = null;
let cameraVisual = null;
let cameraPtzStatus = null;
let cameraPtzMoved = false;
let cameraPtzHomed = false;
if (typeof cameraApp?.id === 'string') {
  const launchedPromise = nextJson(viewer, 'shell-launched', 20_000);
  const selectedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => {
      const activeHandle = message.payload?.activeWindowHandle;
      const openWindows = Array.isArray(message.payload?.windows) ? message.payload.windows : [];
      const active = openWindows.find((window) => window?.windowHandle === activeHandle);
      return /camera/i.test(`${active?.process ?? ''} ${active?.title ?? ''}`);
    },
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'launch-shell', payload: { id: cameraApp.id } }));
  await launchedPromise;
  cameraSemantic = await selectedPromise;
  launchedCameraSelected = true;
  const processId = cameraSemantic.payload?.activeProcessId;
  const windowHandle = cameraSemantic.payload?.activeWindowHandle;
  if (Number.isSafeInteger(processId) && Number.isSafeInteger(windowHandle)) {
    const visualPromise = nextJsonWhere(viewer, 'app-visual', (message) => message.payload?.windowHandle === windowHandle, 30_000);
    viewer.send(JSON.stringify({ type: 'request-app-visual', payload: { processId, windowHandle } }));
    cameraVisual = await visualPromise;
  }
  const statusPromise = nextJson(viewer, 'camera-status', 30_000);
  viewer.send(JSON.stringify({ type: 'request-camera-status' }));
  cameraPtzStatus = await statusPromise;
  if (cameraPtzStatus.payload?.ptz === true) {
    const centeredPromise = nextJson(viewer, 'camera-status', 30_000);
    viewer.send(JSON.stringify({ type: 'camera-control', payload: { kind: 'home' } }));
    await centeredPromise;
    const movedPromise = nextJson(viewer, 'camera-status', 30_000);
    viewer.send(JSON.stringify({ type: 'camera-control', payload: { kind: 'move', direction: 'Right', amount: 2 } }));
    const movedStatus = await movedPromise;
    cameraPtzMoved = movedStatus.payload?.moved === true && movedStatus.payload?.pan?.current === 2;
    const resetPromise = nextJson(viewer, 'camera-status', 30_000);
    viewer.send(JSON.stringify({ type: 'camera-control', payload: { kind: 'home' } }));
    const resetStatus = await resetPromise;
    cameraPtzHomed = resetStatus.payload?.moved === true && resetStatus.payload?.pan?.current === 0 && resetStatus.payload?.tilt?.current === 0;
  }
}
console.error('[smoke] Camera launch and visual');

let staleSwitchPrevented = null;
const beziWindow = windows.find((window) => window?.process === 'Bezi');
if (Number.isSafeInteger(explorerWindow?.processId) && Number.isSafeInteger(beziWindow?.processId)) {
  const observedProcesses = [];
  const observeSnapshots = (data, binary) => {
    if (binary) return;
    try {
      const message = JSON.parse(data.toString());
      if (message.type !== 'semantic-snapshot') return;
      const active = message.payload?.windows?.find((window) => window?.windowHandle === message.payload?.activeWindowHandle);
      if (active?.process) observedProcesses.push(active.process);
    } catch {
      // Ignore unrelated relay messages.
    }
  };
  viewer.on('message', observeSnapshots);
  const beziSelectedPromise = nextJsonWhere(
    viewer,
    'semantic-snapshot',
    (message) => message.payload?.activeWindowHandle === beziWindow.windowHandle,
    30_000,
  );
  viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'focusWindow', processId: explorerWindow.processId, windowHandle: explorerWindow.windowHandle } }));
  viewer.send(JSON.stringify({ type: 'request-semantic' }));
  setTimeout(() => {
    viewer.send(JSON.stringify({ type: 'input', payload: { kind: 'focusWindow', processId: beziWindow.processId, windowHandle: beziWindow.windowHandle } }));
  }, 75);
  await beziSelectedPromise;
  viewer.off('message', observeSnapshots);
  staleSwitchPrevented = !observedProcesses.includes('explorer');
}
console.error('[smoke] rapid switch transaction');

viewer.off('message', observeErrors);
viewer.close(1000, 'smoke complete');
console.log(JSON.stringify({
  catalogApps: apps.length,
  pinnedApps: apps.filter((app) => app?.pinned === true).length,
  catalogBytes: Buffer.byteLength(JSON.stringify(catalogMessage)),
  shortcutPathsExposed: apps.some((app) => app && Object.hasOwn(app, 'shortcutPath')),
  iconReceived: typeof iconMessage.payload?.dataUri === 'string' && iconMessage.payload.dataUri.startsWith('data:image/png;base64,'),
  iconBytes: typeof iconMessage.payload?.dataUri === 'string' ? iconMessage.payload.dataUri.length : 0,
  adaptedProcess: testWindow?.process ?? null,
  semanticAdapter: adaptedSemantic.payload?.adapter ?? null,
  semanticControls: Array.isArray(adaptedSemantic.payload?.controls) ? adaptedSemantic.payload.controls.length : 0,
  semanticBytes: Buffer.byteLength(JSON.stringify(adaptedSemantic)),
  appVisualReceived: typeof appVisual?.payload?.dataUri === 'string' && appVisual.payload.dataUri.startsWith('data:image/jpeg;base64,'),
  appVisualBytes: appVisual ? Buffer.byteLength(JSON.stringify(appVisual)) : 0,
  opaqueProcess: opaqueWindow?.process ?? null,
  opaqueAdapter: opaqueSemantic?.payload?.adapter ?? null,
  opaqueControls: Array.isArray(opaqueSemantic?.payload?.controls) ? opaqueSemantic.payload.controls.length : 0,
  opaqueSemanticBytes: opaqueSemantic ? Buffer.byteLength(JSON.stringify(opaqueSemantic)) : 0,
  opaqueVisualReceived: typeof opaqueVisual?.payload?.dataUri === 'string' && opaqueVisual.payload.dataUri.startsWith('data:image/jpeg;base64,'),
  opaqueVisualBytes: opaqueVisual ? Buffer.byteLength(JSON.stringify(opaqueVisual)) : 0,
  searchApps: searchApps.length,
  searchFiles: searchFiles.length,
  rawPathsExposed: searchFiles.some((file) => file && Object.hasOwn(file, 'path')),
  helperWindowsExposed: windows.some((window) => ['PickerHost', 'TextInputHost', 'pcaui'].includes(window?.process)),
  launchedExplorerSelected,
  launchedBeziSelected,
  beziBurstRecovered,
  cameraCatalogued: !!cameraApp,
  cameraIconReceived: iconMessage.payload?.key === cameraApp?.iconKey && typeof iconMessage.payload?.dataUri === 'string',
  launchedCameraSelected,
  cameraAdapter: cameraSemantic?.payload?.adapter ?? null,
  cameraControls: Array.isArray(cameraSemantic?.payload?.controls) ? cameraSemantic.payload.controls.length : 0,
  cameraShutterFound: cameraSemantic?.payload?.controls?.some((control) => /^take (photo|video)$/i.test(control?.label ?? '')) ?? false,
  cameraVisualReceived: typeof cameraVisual?.payload?.dataUri === 'string' && cameraVisual.payload.dataUri.startsWith('data:image/jpeg;base64,'),
  cameraPtzAvailable: cameraPtzStatus?.payload?.ptz === true,
  cameraPtzRanges: cameraPtzStatus ? {
    pan: [cameraPtzStatus.payload?.pan?.minimum, cameraPtzStatus.payload?.pan?.maximum],
    tilt: [cameraPtzStatus.payload?.tilt?.minimum, cameraPtzStatus.payload?.tilt?.maximum],
    zoom: [cameraPtzStatus.payload?.zoom?.minimum, cameraPtzStatus.payload?.zoom?.maximum],
  } : null,
  cameraPtzMoved,
  cameraPtzHomed,
  hostErrors: observedErrors,
  staleSwitchPrevented,
}));

function opened(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timed out')), 10_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', reject);
  });
}

function nextJson(socket, type, timeoutMs) {
  return nextJsonWhere(socket, type, () => true, timeoutMs);
}

function nextJsonWhere(socket, type, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`${type} timed out`));
    }, timeoutMs);
    const onMessage = (data, binary) => {
      if (binary) return;
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== type || !predicate(message)) return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(message);
      } catch {
        // Ignore unrelated relay messages.
      }
    };
    socket.on('message', onMessage);
  });
}
