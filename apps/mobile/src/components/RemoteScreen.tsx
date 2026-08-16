import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii } from '../theme';
import type { RemoteSessionApi } from '../types';
import { groupOpenWindows, resolveWindowApp, resolveWindowIconKey, windowDisplayName } from '../lib/windowApp';
import { AppLibraryModal } from './AppLibraryModal';
import { AppWindowsModal } from './AppWindowsModal';
import { adapterNeedsVisual, getAppAdapterKind } from './AppAdapters';
import { ControlPanel } from './ControlPanel';
import { DesktopInputBar } from './DesktopInputBar';
import { HomeScreen } from './HomeScreen';
import { LiveCanvas } from './LiveCanvas';
import { MotionPressable } from './MotionPressable';
import { RemoteIcon } from './RemoteIcon';
import { SemanticWorkspace } from './SemanticWorkspace';

type Mode = 'home' | 'mobile' | 'desktop' | 'input';

interface Props {
  session: RemoteSessionApi;
}

const MODES: Array<{ mode: Mode; label: string; glyph: string; detail: string }> = [
  { mode: 'home', label: 'Home', glyph: '⌂', detail: 'Apps and recent windows' },
  { mode: 'mobile', label: 'Current', glyph: '▱', detail: 'Phone-native app controls' },
  { mode: 'desktop', label: 'Desktop', glyph: '□', detail: 'Live full desktop' },
  { mode: 'input', label: 'Input', glyph: '⌁', detail: 'Trackpad and keyboard' },
];

export function RemoteScreen({ session }: Props) {
  const [mode, setMode] = useState<Mode>('home');
  const [appsVisible, setAppsVisible] = useState(false);
  const [windowPickerKey, setWindowPickerKey] = useState<string | null>(null);
  const [closingWindowHandles, setClosingWindowHandles] = useState<number[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [desktopFit, setDesktopFit] = useState<'contain' | 'cover'>('contain');
  const transition = useRef(new Animated.Value(1)).current;
  const closeTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [pendingSelection, setPendingSelection] = useState<{
    afterCapturedAt: number;
    label: string;
    windowHandle?: number;
  } | null>(null);
  const windows = session.snapshot?.windows ?? [];
  const knownApps = useMemo(() => {
    const byId = new Map((session.shellSnapshot?.apps ?? []).map((app) => [app.id, app]));
    for (const app of session.shellResults?.apps ?? []) byId.set(app.id, app);
    return [...byId.values()];
  }, [session.shellSnapshot, session.shellResults]);
  const openAppGroups = useMemo(() => groupOpenWindows(windows, knownApps), [windows, knownApps]);
  const openAppCount = openAppGroups.length;
  const windowPickerGroup = windowPickerKey
    ? openAppGroups.find((group) => group.key === windowPickerKey) ?? null
    : null;
  const activeWindow = useMemo(
    () => {
      const pendingWindow = pendingSelection?.windowHandle
        ? windows.find((window) => window.windowHandle === pendingSelection.windowHandle)
        : pendingSelection
          ? windows.find((window) => windowMatchesLabel(window.process, window.title, pendingSelection.label))
          : null;
      return pendingWindow ?? session.snapshot?.windows.find(
        (window) => window.windowHandle === session.snapshot?.activeWindowHandle,
      ) ?? session.snapshot?.windows.find((window) => window.active) ?? null;
    },
    [pendingSelection, session.snapshot, windows],
  );

  useEffect(() => {
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [mode, transition]);

  useEffect(() => {
    if (!session.secureDesktopActive) return;
    setMode('desktop');
    setAppsVisible(false);
    setWindowPickerKey(null);
    setMenuVisible(false);
  }, [session.secureDesktopActive]);

  useEffect(() => {
    const openHandles = new Set(windows.map((window) => window.windowHandle));
    setClosingWindowHandles((current) => {
      const next = current.filter((handle) => openHandles.has(handle));
      for (const handle of current) {
        if (openHandles.has(handle)) continue;
        const timer = closeTimers.current.get(handle);
        if (timer) clearTimeout(timer);
        closeTimers.current.delete(handle);
      }
      return next.length === current.length ? current : next;
    });
  }, [windows]);

  useEffect(() => () => {
    for (const timer of closeTimers.current.values()) clearTimeout(timer);
    closeTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!session.hostOnline) return;
    if (mode === 'mobile') session.refreshSemantic();
    if (mode === 'home') session.requestShell();
  }, [mode, session.hostOnline, session.refreshSemantic, session.requestShell]);

  useEffect(() => {
    if (mode !== 'mobile' || !session.hostOnline) return;
    const timer = setInterval(session.refreshSemantic, 3_500);
    return () => clearInterval(timer);
  }, [mode, session.hostOnline, session.refreshSemantic]);

  useEffect(() => {
    const snapshot = session.snapshot;
    const selectedWindow = snapshot?.windows.find((window) => window.windowHandle === snapshot.activeWindowHandle)
      ?? snapshot?.windows.find((window) => window.active);
    const specializedVisual = !!selectedWindow && adapterNeedsVisual(selectedWindow.process, selectedWindow.title);
    if (
      mode !== 'mobile' ||
      pendingSelection ||
      !snapshot ||
      snapshot.activeProcessId <= 0 ||
      (!specializedVisual && snapshot.adapter === 'accessibility' && snapshot.accessibilityCount >= 12)
    ) return;
    session.requestAppVisual(snapshot.activeProcessId, snapshot.activeWindowHandle);
  }, [mode, pendingSelection, session.snapshot, session.requestAppVisual]);

  useEffect(() => {
    if (
      mode !== 'mobile' ||
      pendingSelection ||
      !session.hostOnline ||
      !activeWindow ||
      getAppAdapterKind(activeWindow.process, activeWindow.title) !== 'camera'
    ) return;
    const requestPreview = () => session.requestAppVisual(activeWindow.processId, activeWindow.windowHandle);
    requestPreview();
    session.requestCameraStatus();
    const timer = setInterval(requestPreview, 1_600);
    return () => clearInterval(timer);
  }, [mode, pendingSelection, session.hostOnline, activeWindow, session.requestAppVisual, session.requestCameraStatus]);

  useEffect(() => {
    if (!pendingSelection || !session.snapshot || session.snapshot.capturedAt <= pendingSelection.afterCapturedAt) return;
    const selected = session.snapshot.windows.find(
      (window) => window.windowHandle === session.snapshot?.activeWindowHandle,
    );
    const matches = pendingSelection.windowHandle
      ? selected?.windowHandle === pendingSelection.windowHandle
      : !!selected && windowMatchesLabel(selected.process, selected.title, pendingSelection.label);
    if (matches) setPendingSelection(null);
  }, [pendingSelection, session.snapshot]);

  useEffect(() => {
    if (!pendingSelection) return;
    const timer = setTimeout(() => setPendingSelection(null), 25_000);
    return () => clearTimeout(timer);
  }, [pendingSelection]);

  useEffect(() => {
    session.setStreamEnabled(mode === 'desktop');
    return () => session.setStreamEnabled(false);
  }, [mode, session.setStreamEnabled]);

  useEffect(() => {
    const apps = session.shellSnapshot?.apps ?? [];
    const resultApps = session.shellResults?.apps ?? [];
    const keys = [
      ...windows.map((window) => window.iconKey),
      ...windows.map((window) => resolveWindowIconKey(window, apps)),
      ...apps.filter((app) => app.pinned).map((app) => app.iconKey),
      ...apps.slice(0, 100).map((app) => app.iconKey),
      ...resultApps.map((app) => app.iconKey),
    ];
    session.requestIcons(keys);
  }, [windows, session.shellSnapshot, session.shellResults, session.requestIcons]);

  const selectMode = (next: Mode) => {
    if (session.secureDesktopActive && next !== 'desktop') return;
    setMode(next);
    setMenuVisible(false);
  };

  const openWindow = (processId: number, windowHandle: number) => {
    const target = windows.find((window) => window.windowHandle === windowHandle);
    setPendingSelection({
      afterCapturedAt: session.snapshot?.capturedAt ?? 0,
      label: target?.process ?? 'application',
      windowHandle,
    });
    session.sendInput({ kind: 'focusWindow', processId, windowHandle });
    setAppsVisible(false);
    setWindowPickerKey(null);
    setMode('mobile');
    setTimeout(session.refreshSemantic, 650);
  };

  const openApp = (groupKey: string) => {
    const group = openAppGroups.find((candidate) => candidate.key === groupKey);
    if (!group) return;
    if (group.windows.length === 1) {
      const window = group.windows[0];
      openWindow(window.processId, window.windowHandle);
      return;
    }
    setAppsVisible(false);
    setWindowPickerKey(group.key);
  };

  const closeWindow = (processId: number, windowHandle: number) => {
    if (closeTimers.current.has(windowHandle)) return;
    if (session.snapshot?.activeWindowHandle === windowHandle) setPendingSelection(null);
    setClosingWindowHandles((current) => [...current, windowHandle]);
    session.sendInput({ kind: 'closeWindow', processId, windowHandle });
    session.refreshSemantic();
    setTimeout(session.refreshSemantic, 700);
    const timer = setTimeout(() => {
      closeTimers.current.delete(windowHandle);
      setClosingWindowHandles((current) => current.filter((handle) => handle !== windowHandle));
      Alert.alert(
        'Window is still open',
        'Windows may be waiting for a save confirmation on the PC. If Close never reacts, restart the PocketDesk host and try again.',
      );
    }, 6_000);
    closeTimers.current.set(windowHandle, timer);
  };

  const launchItem = (id: string) => {
    const app = session.shellSnapshot?.apps.find((candidate) => candidate.id === id)
      ?? session.shellResults?.apps.find((candidate) => candidate.id === id);
    const file = session.shellResults?.files.find((candidate) => candidate.id === id);
    const matchingWindow = app
      ? windows.find((window) => resolveWindowApp(window, [app])?.id === app.id)
      : null;
    const openGroup = matchingWindow
      ? openAppGroups.find((group) => group.windows.some((window) => window.windowHandle === matchingWindow.windowHandle))
      : null;
    if (openGroup) {
      openApp(openGroup.key);
      return;
    }
    setPendingSelection({
      afterCapturedAt: session.snapshot?.capturedAt ?? 0,
      label: app?.name ?? file?.name ?? 'application',
    });
    session.launchShell(id);
    setAppsVisible(false);
    setMode('mobile');
    setTimeout(session.refreshSemantic, 950);
  };

  const refreshAll = () => {
    session.refreshSemantic();
    session.requestShell(true);
  };

  const forgetPC = () => {
    Alert.alert(
      'Forget this PC?',
      'This phone will lose access. You can add it again from the PC device manager.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: session.disconnect },
      ],
    );
  };

  const statusText = session.status === 'connected'
    ? session.secureDesktopActive ? 'Windows sign-in' : session.hostOnline ? 'Live' : 'PC offline'
    : session.status === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  const headerName = session.secureDesktopActive
    ? 'Windows sign-in'
    : mode === 'home'
      ? 'PocketDesk'
      : pendingSelection?.label ?? (activeWindow ? windowDisplayName(activeWindow, knownApps) : null) ?? session.desktopMeta?.machineName ?? 'PocketDesk';
  const activeIconKey = activeWindow
    ? resolveWindowIconKey(activeWindow, knownApps)
    : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <MotionPressable onPress={() => setMenuVisible(true)} style={styles.headerButton} accessibilityLabel="Open navigation menu">
          <View style={styles.menuGlyph}><View style={styles.menuLine} /><View style={styles.menuLineShort} /><View style={styles.menuLine} /></View>
        </MotionPressable>

        {mode !== 'home' && activeWindow ? (
          <View style={styles.activeIcon}><RemoteIcon iconKey={activeIconKey} icons={session.appIcons} size={30} radius={8} active /></View>
        ) : null}
        <View style={styles.headerCopy}>
          <Text style={styles.appName} numberOfLines={1}>{headerName}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, !session.hostOnline && styles.statusDotWaiting]} />
            <Text style={styles.statusText}>{statusText}</Text>
            {session.latencyMs !== null ? <Text style={styles.latency}>· {session.latencyMs} ms</Text> : null}
          </View>
        </View>

        {mode === 'desktop' ? (
          <MotionPressable onPress={() => setDesktopFit((current) => current === 'cover' ? 'contain' : 'cover')} style={styles.fitButton} accessibilityLabel="Toggle desktop fit">
            <View style={styles.headerButtonInner}><Text style={styles.fitText}>{desktopFit === 'cover' ? 'Fit' : 'Fill'}</Text></View>
          </MotionPressable>
        ) : null}
        {!session.secureDesktopActive ? (
          <MotionPressable
            onPress={() => { session.requestShell(); session.refreshSemantic(); setAppsVisible(true); }}
            style={styles.appsButton}
            accessibilityLabel="Open app library"
          >
            <View style={styles.appsButtonInner}>
              <View style={styles.appsGlyph}><View style={styles.appsGlyphSquare} /><View style={styles.appsGlyphSquare} /><View style={styles.appsGlyphSquare} /><View style={styles.appsGlyphSquare} /></View>
              {openAppCount ? <View style={styles.appsCount}><Text style={styles.appsCountText}>{openAppCount}</Text></View> : null}
            </View>
          </MotionPressable>
        ) : null}
      </View>

      {session.error ? <View style={styles.errorBanner}><Text style={styles.errorText} numberOfLines={2}>{session.error}</Text></View> : null}

      <Animated.View style={[styles.main, { opacity: transition, transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }]}>
        {mode === 'home' ? (
          <HomeScreen
            machineName={session.desktopMeta?.machineName ?? 'your PC'}
            hostOnline={session.hostOnline}
            status={session.status}
            windows={windows}
            shellSnapshot={session.shellSnapshot}
            shellResults={session.shellResults}
            icons={session.appIcons}
            onSearch={session.searchShell}
            onLaunch={launchItem}
            onOpenApp={openApp}
            onOpenLibrary={() => setAppsVisible(true)}
            onRefresh={refreshAll}
            onPairAgain={forgetPC}
          />
        ) : mode === 'mobile' ? (
          <SemanticWorkspace
            snapshot={pendingSelection ? null : session.snapshot}
            visual={session.appVisual}
            cameraStatus={session.cameraStatus}
            hostOnline={session.hostOnline}
            icons={session.appIcons}
            fileSnapshot={session.fileSnapshot}
            fileThumbnails={session.fileThumbnails}
            fileLoading={session.fileLoading}
            fileError={session.fileError}
            fileOperation={session.fileOperation}
            fileDownload={session.fileDownload}
            onInput={session.sendInput}
            onCameraControl={session.sendCameraControl}
            onRefresh={session.refreshSemantic}
            onBrowseFiles={session.requestFiles}
            onRequestFileThumbnails={session.requestFileThumbnails}
            onFileOperation={session.runFileOperation}
            onOpenFile={session.openFile}
            onDownloadFile={session.downloadFile}
            onShareDownloadedFile={session.shareDownloadedFile}
            onClearFileOperation={session.clearFileOperation}
            onClearFileDownload={session.clearFileDownload}
          />
        ) : mode === 'desktop' ? (
          <View style={styles.desktopStage}>
            <LiveCanvas frameUri={session.frameUri} meta={session.desktopMeta} interactive hostOnline={session.hostOnline} onInput={session.sendInput} fill resizeMode={desktopFit} />
            <DesktopInputBar onInput={session.sendInput} secure={session.secureDesktopActive} />
          </View>
        ) : (
          <ControlPanel meta={session.desktopMeta} onInput={session.sendInput} onQuality={session.setQuality} />
        )}
      </Animated.View>

      {!session.secureDesktopActive ? (
        <View style={styles.dock} accessibilityRole="tablist">
          {MODES.map((item) => (
            <ModeButton key={item.mode} {...item} current={mode} onPress={selectMode} />
          ))}
        </View>
      ) : null}

      <NavigationDrawer
        visible={menuVisible}
        mode={mode}
        statusText={statusText}
        latencyMs={session.latencyMs}
        hostOnline={session.hostOnline}
        secureDesktopActive={session.secureDesktopActive}
        onClose={() => setMenuVisible(false)}
        onSelectMode={selectMode}
        onOpenApps={() => { setMenuVisible(false); setAppsVisible(true); }}
        onRefresh={() => { refreshAll(); setMenuVisible(false); }}
        onDisconnect={forgetPC}
      />

      <AppLibraryModal
        visible={appsVisible}
        windows={windows}
        snapshot={session.shellSnapshot}
        icons={session.appIcons}
        closingWindowHandles={closingWindowHandles}
        onClose={() => setAppsVisible(false)}
        onOpenApp={openApp}
        onCloseWindow={closeWindow}
        onLaunch={launchItem}
        onRefresh={refreshAll}
        onRequestIcons={session.requestIcons}
      />
      <AppWindowsModal
        group={windowPickerGroup}
        icons={session.appIcons}
        closingWindowHandles={closingWindowHandles}
        onDismiss={() => setWindowPickerKey(null)}
        onOpenWindow={openWindow}
        onCloseWindow={closeWindow}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NavigationDrawer({
  visible,
  mode,
  statusText,
  latencyMs,
  hostOnline,
  secureDesktopActive,
  onClose,
  onSelectMode,
  onOpenApps,
  onRefresh,
  onDisconnect,
}: {
  visible: boolean;
  mode: Mode;
  statusText: string;
  latencyMs: number | null;
  hostOnline: boolean;
  secureDesktopActive: boolean;
  onClose: () => void;
  onSelectMode: (mode: Mode) => void;
  onOpenApps: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.drawerRoot}>
        <Pressable style={styles.drawerScrim} onPress={onClose} accessibilityLabel="Close navigation menu" />
        <SafeAreaView style={styles.drawer} edges={['top', 'bottom', 'left']}>
          <View style={styles.drawerHeader}>
            <View style={styles.wordmark}><Text style={styles.wordmarkText}>P</Text></View>
            <View><Text style={styles.drawerTitle}>PocketDesk</Text><Text style={styles.drawerSubtitle}>Remote workspace</Text></View>
          </View>

          {secureDesktopActive ? (
            <View style={styles.secureDrawerCard}>
              <Text style={styles.secureDrawerTitle}>Windows is locked</Text>
              <Text style={styles.secureDrawerBody}>Desktop, pointer, and keyboard controls remain available. Apps and files return after sign-in.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.drawerLabel}>Navigation</Text>
              {MODES.map((item) => {
                const active = item.mode === mode;
                return (
                  <MotionPressable key={item.mode} onPress={() => onSelectMode(item.mode)} style={[styles.drawerItem, active && styles.drawerItemActive]} accessibilityState={{ selected: active }}>
                    <View style={styles.drawerItemInner}>
                      <Text style={[styles.drawerItemGlyph, active && styles.drawerItemGlyphActive]}>{item.glyph}</Text>
                      <View style={styles.drawerItemCopy}><Text style={[styles.drawerItemTitle, active && styles.drawerItemTitleActive]}>{item.label}</Text><Text style={[styles.drawerItemDetail, active && styles.drawerItemDetailActive]}>{item.detail}</Text></View>
                      {active ? <View style={styles.drawerActiveDot} /> : null}
                    </View>
                  </MotionPressable>
                );
              })}

              <Text style={styles.drawerLabel}>Workspace</Text>
              <DrawerAction glyph="▦" label="App library" onPress={onOpenApps} />
              <DrawerAction glyph="↻" label="Refresh current view" onPress={onRefresh} />
            </>
          )}

          <View style={styles.drawerSpacer} />
          <View style={styles.connectionCard}>
            <View style={[styles.connectionDot, !hostOnline && styles.connectionDotOffline]} />
            <View style={styles.connectionCopy}><Text style={styles.connectionTitle}>{statusText}</Text><Text style={styles.connectionDetail}>{latencyMs === null ? 'Secure relay connection' : `${latencyMs} ms relay latency`}</Text></View>
          </View>
          <Pressable onPress={onDisconnect} style={styles.disconnectButton}><Text style={styles.disconnectText}>Forget this PC</Text></Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function DrawerAction({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  return (
    <MotionPressable onPress={onPress} style={styles.drawerAction}>
      <View style={styles.drawerActionInner}><Text style={styles.drawerActionGlyph}>{glyph}</Text><Text style={styles.drawerActionLabel}>{label}</Text><Text style={styles.drawerActionChevron}>›</Text></View>
    </MotionPressable>
  );
}

function ModeButton({ mode, current, label, glyph, onPress }: { mode: Mode; current: Mode; label: string; glyph: string; detail: string; onPress: (mode: Mode) => void }) {
  const active = current === mode;
  return (
    <MotionPressable onPress={() => onPress(mode)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <View style={styles.tabInner}>
        <Text style={[styles.tabGlyph, active && styles.tabGlyphActive]}>{glyph}</Text>
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      </View>
    </MotionPressable>
  );
}

function windowMatchesLabel(process: string, title: string, label: string): boolean {
  const expected = normalizeIdentity(label);
  const processName = normalizeIdentity(process);
  const windowTitle = normalizeIdentity(title);
  if (expected === 'fileexplorer') return processName === 'explorer';
  return !!expected && (processName === expected || windowTitle === expected || windowTitle.startsWith(expected));
}

function normalizeIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]+/g, '');
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 58, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  headerButton: { width: 38, height: 38, borderRadius: 19 },
  headerButtonInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  menuGlyph: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  menuLine: { width: 17, height: 1.5, borderRadius: 1, backgroundColor: colors.text },
  menuLineShort: { width: 11, height: 1.5, borderRadius: 1, backgroundColor: colors.text, alignSelf: 'center', marginLeft: -6 },
  activeIcon: { marginLeft: 4 },
  headerCopy: { flex: 1, marginLeft: 9 },
  appName: { color: colors.text, fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.success, marginRight: 5 },
  statusDotWaiting: { backgroundColor: colors.textDim },
  statusText: { color: colors.textMuted, fontSize: 9, fontWeight: '500' },
  latency: { color: colors.textDim, fontSize: 9, marginLeft: 3 },
  fitButton: { minWidth: 46, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, marginRight: 3 },
  fitText: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  appsButton: { width: 42, height: 38, borderRadius: 19 },
  appsButtonInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  appsGlyph: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  appsGlyphSquare: { width: 7, height: 7, borderRadius: 2, borderWidth: 1, borderColor: colors.textMuted },
  appsCount: { position: 'absolute', right: 0, top: 1, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  appsCountText: { color: colors.inverseText, fontSize: 7, fontWeight: '800' },
  errorBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 10, backgroundColor: '#2A1111', borderWidth: 1, borderColor: '#512525', paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 15 },
  main: { flex: 1 },
  desktopStage: { flex: 1 },
  dock: { height: 66, marginHorizontal: 10, marginTop: 6, marginBottom: 5, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', padding: 5, gap: 3 },
  tab: { flex: 1, borderRadius: 17 },
  tabActive: { backgroundColor: colors.primary },
  tabInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabGlyph: { color: colors.textMuted, fontSize: 17, lineHeight: 20 },
  tabGlyphActive: { color: colors.inverseText },
  tabLabel: { color: colors.textMuted, fontSize: 8, fontWeight: '600', marginTop: 2 },
  tabLabelActive: { color: colors.inverseText, fontWeight: '700' },
  drawerRoot: { flex: 1 },
  drawerScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  drawer: { width: '82%', maxWidth: 330, height: '100%', backgroundColor: colors.background, borderRightWidth: 1, borderRightColor: colors.border, paddingHorizontal: 14, paddingBottom: 14 },
  drawerHeader: { minHeight: 82, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 15 },
  wordmark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  wordmarkText: { color: colors.inverseText, fontSize: 17, fontWeight: '900' },
  drawerTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  drawerSubtitle: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  drawerLabel: { color: colors.textDim, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 9, marginBottom: 7, paddingHorizontal: 6 },
  secureDrawerCard: { borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 10 },
  secureDrawerTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  secureDrawerBody: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 6 },
  drawerItem: { height: 60, borderRadius: 14, marginBottom: 3 },
  drawerItemActive: { backgroundColor: colors.primary },
  drawerItemInner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  drawerItemGlyph: { width: 32, color: colors.textMuted, fontSize: 19 },
  drawerItemGlyphActive: { color: colors.inverseText },
  drawerItemCopy: { flex: 1 },
  drawerItemTitle: { color: colors.text, fontSize: 12, fontWeight: '700' },
  drawerItemTitleActive: { color: colors.inverseText },
  drawerItemDetail: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  drawerItemDetailActive: { color: '#565653' },
  drawerActiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.inverseText },
  drawerAction: { height: 46, borderRadius: 12 },
  drawerActionInner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  drawerActionGlyph: { width: 34, color: colors.textMuted, fontSize: 17 },
  drawerActionLabel: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  drawerActionChevron: { color: colors.textDim, fontSize: 21 },
  drawerSpacer: { flex: 1 },
  connectionCard: { minHeight: 62, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  connectionDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.text, marginRight: 10 },
  connectionDotOffline: { backgroundColor: colors.textDim },
  connectionCopy: { flex: 1 },
  connectionTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  connectionDetail: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  disconnectButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  disconnectText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
});
