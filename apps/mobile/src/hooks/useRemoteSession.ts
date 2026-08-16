import { useCallback, useEffect, useRef, useState } from 'react';
import { decode, encode } from 'base64-arraybuffer';
import { Directory, File, Paths, type FileHandle } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { buildSocketUrl, parsePairingDetails } from '../lib/pairing';
import type {
  AppVisual,
  CameraControlCommand,
  CameraPtzStatus,
  CaptureProfile,
  ConnectionStatus,
  DesktopMeta,
  FileBrowserSnapshot,
  FileDownloadState,
  FileOperationRequest,
  FileOperationState,
  InputCommand,
  PairingDetails,
  RemoteSessionApi,
  SemanticSnapshot,
  ShellSearchResults,
  ShellSnapshot,
} from '../types';

interface RelayMessage {
  type?: string;
  code?: unknown;
  payload?: unknown;
  hostOnline?: unknown;
  viewerCount?: unknown;
  timestamp?: unknown;
  message?: unknown;
}

export function useRemoteSession(): RemoteSessionApi {
  const [hasSession, setHasSession] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [desktopMeta, setDesktopMeta] = useState<DesktopMeta | null>(null);
  const [snapshot, setSnapshot] = useState<SemanticSnapshot | null>(null);
  const [shellSnapshot, setShellSnapshot] = useState<ShellSnapshot | null>(null);
  const [shellResults, setShellResults] = useState<ShellSearchResults | null>(null);
  const [appIcons, setAppIcons] = useState<Record<string, string>>({});
  const [appVisual, setAppVisual] = useState<AppVisual | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraPtzStatus | null>(null);
  const [fileSnapshot, setFileSnapshot] = useState<FileBrowserSnapshot | null>(null);
  const [fileThumbnails, setFileThumbnails] = useState<Record<string, string>>({});
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileOperation, setFileOperation] = useState<FileOperationState | null>(null);
  const [fileDownload, setFileDownload] = useState<FileDownloadState | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const manualCloseRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamEnabledRef = useRef(false);
  const iconCacheRef = useRef<Record<string, string>>({});
  const requestedIconsRef = useRef(new Set<string>());
  const requestedFileThumbnailsRef = useRef(new Set<string>());
  const fileSnapshotRef = useRef<FileBrowserSnapshot | null>(null);
  const fileDownloadRef = useRef<FileDownloadState | null>(null);
  const downloadRef = useRef<{
    requestId: string;
    name: string;
    mimeType: string;
    total: number;
    received: number;
    expectedSequence: number;
    file: File;
    handle: FileHandle;
  } | null>(null);

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    retryTimerRef.current = null;
    pingTimerRef.current = null;
  }, []);

  const resetFileState = useCallback(() => {
    downloadRef.current?.handle.close();
    downloadRef.current = null;
    fileSnapshotRef.current = null;
    fileDownloadRef.current = null;
    requestedFileThumbnailsRef.current.clear();
    setFileSnapshot(null);
    setFileThumbnails({});
    setFileLoading(false);
    setFileError(null);
    setFileOperation(null);
    setFileDownload(null);
  }, []);

  const publishFileDownload = useCallback((next: FileDownloadState | null) => {
    fileDownloadRef.current = next;
    setFileDownload(next);
  }, []);

  const connect = useCallback(
    (relayUrl: string, pairingCode: string) => {
      let details: PairingDetails;
      try {
        details = parsePairingDetails(relayUrl, pairingCode);
      } catch (connectionError) {
        setError(
          connectionError instanceof Error
            ? connectionError.message
            : 'Could not read the connection details.',
        );
        setStatus('error');
        return;
      }

      clearTimers();
      socketRef.current?.close();
      manualCloseRef.current = false;
      setHasSession(true);
      setStatus('connecting');
      setError(null);
      resetFileState();
      let attempt = 0;

      const handleJsonMessage = (raw: string) => {
        let message: RelayMessage;
        try {
          message = JSON.parse(raw) as RelayMessage;
        } catch {
          return;
        }

        if (message.type === 'relay-status') {
          if (typeof message.hostOnline === 'boolean') setHostOnline(message.hostOnline);
          if (typeof message.viewerCount === 'number') setViewerCount(message.viewerCount);
        } else if (message.type === 'host-status') {
          setHostOnline(message.hostOnline === true);
        } else if (message.type === 'desktop-meta' && isDesktopMeta(message.payload)) {
          setDesktopMeta(message.payload);
        } else if (message.type === 'semantic-snapshot') {
          const nextSnapshot = parseSemanticSnapshot(message.payload);
          if (nextSnapshot) {
            setSnapshot(nextSnapshot);
            setError(null);
          }
        } else if (message.type === 'shell-snapshot') {
          const nextSnapshot = parseShellSnapshot(message.payload);
          if (nextSnapshot) setShellSnapshot(nextSnapshot);
        } else if (message.type === 'shell-results') {
          const nextResults = parseShellResults(message.payload);
          if (nextResults) setShellResults(nextResults);
        } else if (message.type === 'app-icon') {
          const icon = parseAppIcon(message.payload);
          if (icon) {
            iconCacheRef.current = { ...iconCacheRef.current, [icon.key]: icon.dataUri };
            setAppIcons(iconCacheRef.current);
          }
        } else if (message.type === 'app-visual') {
          const visual = parseAppVisual(message.payload);
          if (visual) setAppVisual(visual);
        } else if (message.type === 'camera-status') {
          const status = parseCameraStatus(message.payload);
          if (status) setCameraStatus(status);
        } else if (message.type === 'files-snapshot') {
          const nextSnapshot = parseFileBrowserSnapshot(message.payload);
          if (nextSnapshot) {
            fileSnapshotRef.current = nextSnapshot;
            setFileSnapshot(nextSnapshot);
            setFileLoading(false);
            setFileError(null);
          }
        } else if (message.type === 'file-thumbnail') {
          const thumbnail = parseFileThumbnail(message.payload);
          if (thumbnail) setFileThumbnails((current) => ({ ...current, [thumbnail.id]: thumbnail.dataUri }));
        } else if (message.type === 'file-operation-result') {
          const result = parseFileOperationResult(message.payload);
          if (result) {
            setFileOperation({ requestId: result.requestId, status: result.ok ? 'success' : 'error', message: result.message });
            if (result.ok) {
              const directoryId = fileSnapshotRef.current?.directoryId ?? null;
              setFileLoading(true);
              socketRef.current?.send(JSON.stringify({ type: 'request-files', payload: { directoryId } }));
            }
          }
        } else if (message.type === 'file-download-start') {
          const transfer = parseFileDownloadStart(message.payload);
          if (transfer && fileDownloadRef.current?.requestId === transfer.requestId) {
            try {
              downloadRef.current?.handle.close();
              const directory = new Directory(Paths.cache, 'PocketDesk');
              directory.create({ idempotent: true, intermediates: true });
              const file = new File(directory, safeLocalFileName(transfer.name));
              file.create({ overwrite: true, intermediates: true });
              const handle = file.open();
              downloadRef.current = { ...transfer, received: 0, expectedSequence: 0, file, handle };
              publishFileDownload({
                requestId: transfer.requestId,
                status: 'downloading',
                name: transfer.name,
                mimeType: transfer.mimeType,
                received: 0,
                total: transfer.total,
                uri: '',
                message: '',
              });
            } catch (downloadError) {
              publishFileDownload({
                requestId: transfer.requestId,
                status: 'error',
                name: transfer.name,
                mimeType: transfer.mimeType,
                received: 0,
                total: transfer.total,
                uri: '',
                message: downloadError instanceof Error ? downloadError.message : 'Could not create the phone download.',
              });
            }
          }
        } else if (message.type === 'file-download-chunk') {
          const chunk = parseFileDownloadChunk(message.payload);
          const transfer = downloadRef.current;
          if (chunk && transfer && transfer.requestId === chunk.requestId && transfer.expectedSequence === chunk.sequence) {
            try {
              const bytes = new Uint8Array(decode(chunk.data));
              transfer.handle.writeBytes(bytes);
              transfer.received += bytes.byteLength;
              transfer.expectedSequence += 1;
              if (chunk.sequence % 3 === 0 || transfer.received >= transfer.total) {
                publishFileDownload({
                  requestId: transfer.requestId,
                  status: 'downloading',
                  name: transfer.name,
                  mimeType: transfer.mimeType,
                  received: transfer.received,
                  total: transfer.total,
                  uri: '',
                  message: '',
                });
              }
            } catch (downloadError) {
              transfer.handle.close();
              downloadRef.current = null;
              publishFileDownload({
                requestId: transfer.requestId,
                status: 'error',
                name: transfer.name,
                mimeType: transfer.mimeType,
                received: transfer.received,
                total: transfer.total,
                uri: '',
                message: downloadError instanceof Error ? downloadError.message : 'The download could not be written.',
              });
            }
          }
        } else if (message.type === 'file-download-end') {
          const ending = parseFileDownloadEnd(message.payload);
          const transfer = downloadRef.current;
          if (ending && transfer && transfer.requestId === ending.requestId) {
            transfer.handle.close();
            downloadRef.current = null;
            publishFileDownload({
              requestId: transfer.requestId,
              status: 'ready',
              name: transfer.name,
              mimeType: transfer.mimeType,
              received: transfer.received,
              total: transfer.total,
              uri: transfer.file.uri,
              message: 'Ready to save to Files',
            });
          }
        } else if (message.type === 'file-download-error') {
          const failure = parseFileDownloadError(message.payload);
          if (failure && fileDownloadRef.current?.requestId === failure.requestId) {
            downloadRef.current?.handle.close();
            downloadRef.current = null;
            publishFileDownload({ ...fileDownloadRef.current, status: 'error', message: failure.message });
          }
        } else if (message.type === 'pong' && typeof message.timestamp === 'number') {
          setLatencyMs(Math.max(0, Date.now() - message.timestamp));
        } else if (message.type === 'error' && typeof message.message === 'string') {
          setError(message.message);
          if (typeof message.code === 'string' && message.code.startsWith('FILES_')) {
            setFileLoading(false);
            setFileError(message.message);
          }
        }
      };

      const openSocket = () => {
        if (manualCloseRef.current) return;

        const socket = new WebSocket(buildSocketUrl(details), [
          'pocketdesk-v1',
          `viewer.${details.viewerToken}`,
        ]);
        socket.binaryType = 'arraybuffer';
        socketRef.current = socket;

        socket.onopen = () => {
          attempt = 0;
          setStatus('connected');
      setError(null);
      iconCacheRef.current = {};
      requestedIconsRef.current.clear();
      requestedFileThumbnailsRef.current.clear();
      setAppIcons({});
      setAppVisual(null);
      setCameraStatus(null);
          socket.send(JSON.stringify({ type: 'request-semantic' }));
          socket.send(JSON.stringify({ type: 'request-shell' }));
          socket.send(JSON.stringify({
            type: 'set-stream',
            payload: { enabled: streamEnabledRef.current },
          }));
          pingTimerRef.current = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, 5_000);
        };

        socket.onmessage = (event) => {
          if (typeof event.data === 'string') {
            handleJsonMessage(event.data);
            return;
          }
          if (event.data instanceof ArrayBuffer) {
            setFrameUri(`data:image/jpeg;base64,${encode(event.data)}`);
          }
        };

        socket.onerror = () => {
          setError('The relay connection had a network error.');
        };

        socket.onclose = (event) => {
          if (pingTimerRef.current) clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
          setHostOnline(false);
          if (manualCloseRef.current) return;

          if (event.code === 1008 || event.code === 4003) {
            setStatus('error');
            setError('This pairing code was rejected or has expired.');
            return;
          }

          attempt += 1;
          if (attempt >= 6) {
            setStatus('error');
            setError('Could not reconnect. Disconnect and pair again when the host is ready.');
            return;
          }
          setStatus('reconnecting');
          const delay = Math.min(10_000, 800 * 2 ** Math.min(attempt, 4));
          retryTimerRef.current = setTimeout(openSocket, delay);
        };
      };

      openSocket();
    },
    [clearTimers, publishFileDownload, resetFileState],
  );

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    clearTimers();
    socketRef.current?.close(1000, 'Viewer disconnected');
    socketRef.current = null;
    setHasSession(false);
    setStatus('idle');
    setError(null);
    setFrameUri(null);
    setDesktopMeta(null);
    setSnapshot(null);
    setShellSnapshot(null);
    setShellResults(null);
    setAppIcons({});
    setAppVisual(null);
    setCameraStatus(null);
    resetFileState();
    iconCacheRef.current = {};
    requestedIconsRef.current.clear();
    setHostOnline(false);
    setViewerCount(0);
    setLatencyMs(null);
  }, [clearTimers, resetFileState]);

  const send = useCallback((message: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendInput = useCallback(
    (command: InputCommand) => send({ type: 'input', payload: command }),
    [send],
  );

  const refreshSemantic = useCallback(
    () => send({ type: 'request-semantic' }),
    [send],
  );

  const requestShell = useCallback(
    (refresh = false) => send({ type: 'request-shell', payload: { refresh } }),
    [send],
  );

  const searchShell = useCallback(
    (query: string) => send({ type: 'search-shell', payload: { query } }),
    [send],
  );

  const launchShell = useCallback(
    (id: string) => send({ type: 'launch-shell', payload: { id } }),
    [send],
  );

  const requestIcons = useCallback((keys: string[]) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    const pending = [...new Set(keys)].filter((key) =>
      /^(app:[a-f0-9]{24}|window:\d{1,10})$/.test(key) &&
      !iconCacheRef.current[key] &&
      !requestedIconsRef.current.has(key),
    ).slice(0, 120);
    if (!pending.length) return;
    pending.forEach((key) => requestedIconsRef.current.add(key));
    send({ type: 'request-icons', payload: { keys: pending } });
  }, [send]);

  const requestAppVisual = useCallback((processId: number, windowHandle: number) => {
    if (!Number.isSafeInteger(processId) || processId <= 0 ||
      !Number.isSafeInteger(windowHandle) || windowHandle <= 0) return;
    send({ type: 'request-app-visual', payload: { processId, windowHandle } });
  }, [send]);

  const requestCameraStatus = useCallback(
    () => send({ type: 'request-camera-status' }),
    [send],
  );

  const requestFiles = useCallback((directoryId: string | null) => {
    setFileLoading(true);
    setFileError(null);
    send({ type: 'request-files', payload: { directoryId } });
  }, [send]);

  const requestFileThumbnails = useCallback((ids: string[]) => {
    const pending = [...new Set(ids)].filter((id) =>
      /^fs:[a-f0-9]{24}$/.test(id) &&
      !fileThumbnails[id] &&
      !requestedFileThumbnailsRef.current.has(id),
    ).slice(0, 36);
    if (!pending.length) return;
    pending.forEach((id) => requestedFileThumbnailsRef.current.add(id));
    send({ type: 'request-file-thumbnails', payload: { ids: pending } });
  }, [fileThumbnails, send]);

  const runFileOperation = useCallback((operation: FileOperationRequest) => {
    const requestId = createRequestId();
    setFileOperation({ requestId, status: 'running', message: 'Working…' });
    send({ type: 'file-operation', payload: { requestId, ...operation } });
  }, [send]);

  const openFile = useCallback((id: string) => {
    send({ type: 'open-file', payload: { id } });
  }, [send]);

  const downloadFile = useCallback((id: string) => {
    downloadRef.current?.handle.close();
    downloadRef.current = null;
    const requestId = createRequestId();
    publishFileDownload({
      requestId,
      status: 'waiting',
      name: '',
      mimeType: '',
      received: 0,
      total: 0,
      uri: '',
      message: 'Preparing download…',
    });
    send({ type: 'request-file-download', payload: { id, requestId } });
  }, [publishFileDownload, send]);

  const shareDownloadedFile = useCallback(async () => {
    if (!fileDownload?.uri || fileDownload.status !== 'ready') return;
    if (!(await Sharing.isAvailableAsync())) {
      publishFileDownload({ ...fileDownload, status: 'error', message: 'The phone share sheet is unavailable.' });
      return;
    }
    await Sharing.shareAsync(fileDownload.uri, {
      dialogTitle: `Save ${fileDownload.name}`,
      mimeType: fileDownload.mimeType || undefined,
    });
  }, [fileDownload, publishFileDownload]);

  const clearFileOperation = useCallback(() => setFileOperation(null), []);
  const clearFileDownload = useCallback(() => publishFileDownload(null), [publishFileDownload]);

  const sendCameraControl = useCallback(
    (command: CameraControlCommand) => send({ type: 'camera-control', payload: command }),
    [send],
  );

  const setQuality = useCallback(
    (profile: CaptureProfile) =>
      send({ type: 'set-quality', payload: { profile } }),
    [send],
  );

  const setStreamEnabled = useCallback(
    (enabled: boolean) => {
      streamEnabledRef.current = enabled;
      send({ type: 'set-stream', payload: { enabled } });
    },
    [send],
  );

  useEffect(() => disconnect, [disconnect]);

  return {
    hasSession,
    status,
    error,
    frameUri,
    desktopMeta,
    snapshot,
    shellSnapshot,
    shellResults,
    appIcons,
    appVisual,
    cameraStatus,
    fileSnapshot,
    fileThumbnails,
    fileLoading,
    fileError,
    fileOperation,
    fileDownload,
    hostOnline,
    viewerCount,
    latencyMs,
    connect,
    disconnect,
    sendInput,
    refreshSemantic,
    requestShell,
    searchShell,
    launchShell,
    requestIcons,
    requestAppVisual,
    requestCameraStatus,
    requestFiles,
    requestFileThumbnails,
    runFileOperation,
    openFile,
    downloadFile,
    shareDownloadedFile,
    clearFileOperation,
    clearFileDownload,
    sendCameraControl,
    setQuality,
    setStreamEnabled,
  };
}

function parseFileBrowserSnapshot(value: unknown): FileBrowserSnapshot | null {
  if (
    !isRecord(value) ||
    (value.directoryId !== null && typeof value.directoryId !== 'string') ||
    typeof value.name !== 'string' ||
    typeof value.pathLabel !== 'string' ||
    (value.parentId !== null && typeof value.parentId !== 'string') ||
    !Array.isArray(value.breadcrumbs) ||
    !Array.isArray(value.items)
  ) return null;
  const breadcrumbs = value.breadcrumbs.flatMap((crumb) => {
    if (!isRecord(crumb) || (crumb.id !== null && typeof crumb.id !== 'string') || typeof crumb.name !== 'string') return [];
    return [{ id: crumb.id as string | null, name: crumb.name }];
  });
  const items = value.items.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' || !/^fs:[a-f0-9]{24}$/.test(entry.id) ||
      typeof entry.name !== 'string' ||
      (entry.kind !== 'directory' && entry.kind !== 'file') ||
      typeof entry.extension !== 'string' ||
      typeof entry.mimeType !== 'string' ||
      !finite(entry.size) || !finite(entry.modifiedAt)
    ) return [];
    const locationKind = isFileLocationKind(entry.locationKind) ? entry.locationKind : undefined;
    const kind: 'directory' | 'file' = entry.kind;
    return [{
      id: entry.id,
      name: entry.name,
      kind,
      extension: entry.extension,
      mimeType: entry.mimeType,
      size: Math.max(0, entry.size),
      modifiedAt: Math.max(0, entry.modifiedAt),
      thumbnailAvailable: entry.thumbnailAvailable === true,
      ...(locationKind ? { locationKind } : {}),
    }];
  });
  return {
    directoryId: value.directoryId,
    name: value.name.slice(0, 260),
    pathLabel: value.pathLabel.slice(0, 2_000),
    parentId: value.parentId,
    breadcrumbs,
    items,
    truncated: value.truncated === true,
  };
}

function parseFileThumbnail(value: unknown): { id: string; dataUri: string } | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' || !/^fs:[a-f0-9]{24}$/.test(value.id) ||
    typeof value.dataUri !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.dataUri) ||
    value.dataUri.length > 125_000
  ) return null;
  return { id: value.id, dataUri: value.dataUri };
}

function parseFileOperationResult(value: unknown): { requestId: string; ok: boolean; message: string } | null {
  if (!isRecord(value) || !requestId(value.requestId) || typeof value.ok !== 'boolean' || typeof value.message !== 'string') return null;
  return { requestId: value.requestId, ok: value.ok, message: value.message.slice(0, 300) };
}

function parseFileDownloadStart(value: unknown): { requestId: string; name: string; mimeType: string; total: number } | null {
  if (
    !isRecord(value) || !requestId(value.requestId) || typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' || !finite(value.size) || value.size < 0 || value.size > 250 * 1024 * 1024
  ) return null;
  return { requestId: value.requestId, name: value.name.slice(0, 260), mimeType: value.mimeType.slice(0, 120), total: value.size };
}

function parseFileDownloadChunk(value: unknown): { requestId: string; sequence: number; data: string } | null {
  if (
    !isRecord(value) || !requestId(value.requestId) || !finite(value.sequence) ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
    typeof value.data !== 'string' || value.data.length > 100_000 || !/^[A-Za-z0-9+/=]*$/.test(value.data)
  ) return null;
  return { requestId: value.requestId, sequence: value.sequence, data: value.data };
}

function parseFileDownloadEnd(value: unknown): { requestId: string } | null {
  return isRecord(value) && requestId(value.requestId) ? { requestId: value.requestId } : null;
}

function parseFileDownloadError(value: unknown): { requestId: string; message: string } | null {
  if (!isRecord(value) || !requestId(value.requestId) || typeof value.message !== 'string') return null;
  return { requestId: value.requestId, message: value.message.slice(0, 300) };
}

function requestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function isFileLocationKind(value: unknown): value is NonNullable<FileBrowserSnapshot['items'][number]['locationKind']> {
  return typeof value === 'string' && ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'drive'].includes(value);
}

function createRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function safeLocalFileName(value: string): string {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 180);
  return safe || 'PocketDesk download';
}

function parseCameraStatus(value: unknown): CameraPtzStatus | null {
  if (
    !isRecord(value) ||
    typeof value.device !== 'string' ||
    typeof value.action !== 'string' ||
    typeof value.error !== 'string' ||
    !Array.isArray(value.presets)
  ) return null;
  const pan = parseCameraAxis(value.pan);
  const tilt = parseCameraAxis(value.tilt);
  const zoom = parseCameraAxis(value.zoom);
  if (!pan || !tilt || !zoom) return null;
  const presets = value.presets.flatMap((preset) => {
    if (!isRecord(preset) || (preset.slot !== 1 && preset.slot !== 2 && preset.slot !== 3)) return [];
    return [{ slot: preset.slot as 1 | 2 | 3, saved: preset.saved === true }];
  });
  return {
    device: value.device,
    available: value.available === true,
    ptz: value.ptz === true,
    action: value.action,
    moved: value.moved === true,
    pan,
    tilt,
    zoom,
    presets,
    error: value.error,
  };
}

function parseCameraAxis(value: unknown): CameraPtzStatus['pan'] | null {
  if (!isRecord(value)) return null;
  const values = [value.minimum, value.maximum, value.step, value.defaultValue, value.current, value.flags];
  if (!values.every(finite)) return null;
  return {
    supported: value.supported === true,
    minimum: value.minimum as number,
    maximum: value.maximum as number,
    step: value.step as number,
    defaultValue: value.defaultValue as number,
    current: value.current as number,
    flags: value.flags as number,
  };
}

function parseAppIcon(value: unknown): { key: string; dataUri: string } | null {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    !/^(app:[a-f0-9]{24}|window:\d{1,10})$/.test(value.key) ||
    typeof value.dataUri !== 'string' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.dataUri) ||
    value.dataUri.length > 120_000
  ) return null;
  return { key: value.key, dataUri: value.dataUri };
}

function parseAppVisual(value: unknown): AppVisual | null {
  if (
    !isRecord(value) ||
    !finite(value.processId) || !Number.isSafeInteger(value.processId) || value.processId <= 0 ||
    !finite(value.windowHandle) || !Number.isSafeInteger(value.windowHandle) || value.windowHandle <= 0 ||
    !finite(value.width) || value.width < 1 || value.width > 1_200 ||
    !finite(value.height) || value.height < 1 || value.height > 2_000 ||
    !finite(value.capturedAt) ||
    typeof value.dataUri !== 'string' ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value.dataUri) ||
    value.dataUri.length > 110_000
  ) return null;
  return {
    processId: value.processId,
    windowHandle: value.windowHandle,
    width: value.width,
    height: value.height,
    capturedAt: value.capturedAt,
    dataUri: value.dataUri,
  };
}

function parseShellSnapshot(value: unknown): ShellSnapshot | null {
  if (!isRecord(value) || typeof value.capturedAt !== 'number' || !Array.isArray(value.apps)) {
    return null;
  }
  return { capturedAt: value.capturedAt, apps: parseShellApps(value.apps) };
}

function parseShellResults(value: unknown): ShellSearchResults | null {
  if (
    !isRecord(value) ||
    typeof value.query !== 'string' ||
    !Array.isArray(value.apps) ||
    !Array.isArray(value.files)
  ) return null;

  const files = value.files.flatMap((file) => {
    if (!isRecord(file) || typeof file.id !== 'string' || typeof file.name !== 'string') return [];
    return [{
      id: file.id,
      name: file.name,
      location: typeof file.location === 'string' ? file.location : '',
      kind: typeof file.kind === 'string' ? file.kind : 'File',
      modifiedAt: typeof file.modifiedAt === 'string' ? file.modifiedAt : '',
    }];
  });
  return { query: value.query, apps: parseShellApps(value.apps), files };
}

function parseShellApps(value: unknown[]) {
  return value.flatMap((app) => {
    if (!isRecord(app) || typeof app.id !== 'string' || typeof app.name !== 'string') return [];
    return [{
      id: app.id,
      iconKey: typeof app.iconKey === 'string' ? app.iconKey : `app:${app.id}`,
      name: app.name,
      category: typeof app.category === 'string' ? app.category : 'Start menu',
      pinned: app.pinned === true,
    }];
  });
}

function isDesktopMeta(value: unknown): value is DesktopMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.machineName === 'string' &&
    finite(value.sourceWidth) &&
    finite(value.sourceHeight) &&
    finite(value.streamWidth) &&
    finite(value.streamHeight) &&
    finite(value.fps) &&
    finite(value.quality) &&
    (value.profile === 'smooth' || value.profile === 'balanced' || value.profile === 'sharp')
  );
}

function parseSemanticSnapshot(value: unknown): SemanticSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.capturedAt !== 'number' ||
    typeof value.activeTitle !== 'string' ||
    !Array.isArray(value.windows) ||
    !Array.isArray(value.controls)
  ) {
    return null;
  }

  const windows = value.windows.flatMap((window) => {
    if (
      !isRecord(window) ||
      !finite(window.processId) ||
      typeof window.title !== 'string' ||
      typeof window.process !== 'string'
    ) return [];
    return [{
      processId: window.processId,
      iconKey: typeof window.iconKey === 'string' ? window.iconKey : `window:${window.processId}`,
      windowHandle: finite(window.windowHandle) ? window.windowHandle : 0,
      title: window.title,
      process: window.process,
      active: window.active === true,
    }];
  });

  const controls = value.controls.flatMap((control) => {
    if (
      !isRecord(control) ||
      typeof control.id !== 'string' ||
      typeof control.label !== 'string' ||
      typeof control.kind !== 'string' ||
      !finite(control.x) ||
      !finite(control.y)
    ) return [];
    const category = isControlCategory(control.category)
      ? control.category
      : categoryForKind(control.kind);
    const source: SemanticSnapshot['controls'][number]['source'] = control.source === 'vision'
      ? 'vision'
      : 'accessibility';
    return [{
      id: control.id,
      label: control.label,
      kind: control.kind,
      category,
      value: typeof control.value === 'string' ? control.value : '',
      description: typeof control.description === 'string' ? control.description : '',
      section: typeof control.section === 'string' ? control.section : '',
      source,
      action: typeof control.action === 'string' ? control.action : 'read',
      depth: finite(control.depth) ? Math.max(0, Math.min(30, control.depth)) : 0,
      order: finite(control.order) ? Math.max(0, control.order) : 0,
      parentId: typeof control.parentId === 'string' ? control.parentId : '',
      enabled: control.enabled !== false,
      editable: control.editable === true,
      interactive: control.interactive === true || control.source === 'vision',
      focused: control.focused === true,
      selected: control.selected === true,
      checked: typeof control.checked === 'boolean' ? control.checked : null,
      expanded: typeof control.expanded === 'boolean' ? control.expanded : null,
      x: Math.max(0, Math.min(1, control.x)),
      y: Math.max(0, Math.min(1, control.y)),
      left: finite(control.left) ? Math.max(0, Math.min(1, control.left)) : 0,
      top: finite(control.top) ? Math.max(0, Math.min(1, control.top)) : 0,
      width: finite(control.width) ? Math.max(0, Math.min(1, control.width)) : 0,
      height: finite(control.height) ? Math.max(0, Math.min(1, control.height)) : 0,
    }];
  });

  return {
    capturedAt: value.capturedAt,
    activeProcessId: finite(value.activeProcessId) ? value.activeProcessId : 0,
    activeWindowHandle: finite(value.activeWindowHandle) ? value.activeWindowHandle : 0,
    activeTitle: value.activeTitle,
    adapter: isSemanticAdapter(value.adapter) ? value.adapter : 'basic',
    accessibilityCount: finite(value.accessibilityCount) ? value.accessibilityCount : 0,
    visionCount: finite(value.visionCount) ? value.visionCount : 0,
    windowFrame: parseFrame(value.windowFrame),
    windows,
    controls,
  };
}

function parseFrame(value: unknown): SemanticSnapshot['windowFrame'] {
  if (!isRecord(value)) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: finite(value.x) ? Math.max(0, Math.min(1, value.x)) : 0,
    y: finite(value.y) ? Math.max(0, Math.min(1, value.y)) : 0,
    width: finite(value.width) ? Math.max(0, Math.min(1, value.width)) : 1,
    height: finite(value.height) ? Math.max(0, Math.min(1, value.height)) : 1,
  };
}

function isSemanticAdapter(value: unknown): value is SemanticSnapshot['adapter'] {
  return value === 'accessibility' || value === 'hybrid' || value === 'vision' || value === 'basic';
}

function isControlCategory(
  value: unknown,
): value is SemanticSnapshot['controls'][number]['category'] {
  return value === 'action' || value === 'field' || value === 'navigation' ||
    value === 'option' || value === 'content';
}

function categoryForKind(
  kind: string,
): SemanticSnapshot['controls'][number]['category'] {
  if (kind === 'Edit' || kind === 'ComboBox') return 'field';
  if (kind === 'CheckBox' || kind === 'RadioButton') return 'option';
  if (['MenuItem', 'TabItem', 'Hyperlink', 'TreeItem', 'ListItem'].includes(kind)) {
    return 'navigation';
  }
  if (kind === 'Text' || kind === 'Document') return 'content';
  return 'action';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
