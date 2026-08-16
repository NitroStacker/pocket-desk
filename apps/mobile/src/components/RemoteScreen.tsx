import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type { RemoteSessionApi } from '../types';
import { groupOpenWindows, resolveWindowIconKey, windowDisplayName } from '../lib/windowApp';
import { AppLibraryModal } from './AppLibraryModal';
import { adapterNeedsVisual, getAppAdapterKind } from './AppAdapters';
import { ControlPanel } from './ControlPanel';
import { HomeScreen } from './HomeScreen';
import { LiveCanvas } from './LiveCanvas';
import { RemoteIcon } from './RemoteIcon';
import { SemanticWorkspace } from './SemanticWorkspace';

type Mode = 'home' | 'mobile' | 'desktop' | 'input';

interface Props {
  session: RemoteSessionApi;
}

export function RemoteScreen({ session }: Props) {
  const [mode, setMode] = useState<Mode>('home');
  const [appsVisible, setAppsVisible] = useState(false);
  const [desktopFit, setDesktopFit] = useState<'contain' | 'cover'>('cover');
  const [pendingSelection, setPendingSelection] = useState<{
    afterCapturedAt: number;
    label: string;
    windowHandle?: number;
  } | null>(null);
  const windows = session.snapshot?.windows ?? [];
  const openAppCount = useMemo(
    () => groupOpenWindows(windows, session.shellSnapshot?.apps ?? []).length,
    [windows, session.shellSnapshot],
  );
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
    if (mode === 'mobile') session.refreshSemantic();
    if (mode === 'home') session.requestShell();
  }, [mode, session.refreshSemantic, session.requestShell]);

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
  }, [mode, pendingSelection, session.hostOnline, activeWindow, session.requestAppVisual]);

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

  const openWindow = (processId: number, windowHandle: number) => {
    const target = windows.find((window) => window.windowHandle === windowHandle);
    setPendingSelection({
      afterCapturedAt: session.snapshot?.capturedAt ?? 0,
      label: target?.process ?? 'application',
      windowHandle,
    });
    session.sendInput({ kind: 'focusWindow', processId, windowHandle });
    setAppsVisible(false);
    setMode('mobile');
    setTimeout(session.refreshSemantic, 650);
  };

  const launchItem = (id: string) => {
    const app = session.shellSnapshot?.apps.find((candidate) => candidate.id === id)
      ?? session.shellResults?.apps.find((candidate) => candidate.id === id);
    const file = session.shellResults?.files.find((candidate) => candidate.id === id);
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

  const statusText = session.status === 'connected'
    ? session.hostOnline ? 'PC live' : 'Waiting for PC'
    : session.status === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  const headerName = mode === 'home'
    ? 'PocketDesk Home'
    : pendingSelection?.label ?? (activeWindow ? windowDisplayName(activeWindow, session.shellSnapshot?.apps ?? []) : null) ?? session.desktopMeta?.machineName ?? 'PocketDesk';
  const activeIconKey = activeWindow
    ? resolveWindowIconKey(activeWindow, session.shellSnapshot?.apps ?? [])
    : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        {mode === 'home' || !activeWindow ? (
          <View style={styles.homeIcon}><Text style={styles.homeIconText}>W</Text></View>
        ) : (
          <RemoteIcon iconKey={activeIconKey} icons={session.appIcons} size={42} radius={12} active />
        )}
        <View style={styles.headerCopy}>
          <Text style={styles.appName} numberOfLines={1}>{headerName}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, !session.hostOnline && styles.statusDotWaiting]} />
            <Text style={styles.statusText}>{statusText}</Text>
            {session.latencyMs !== null ? <Text style={styles.latency}>{session.latencyMs} ms</Text> : null}
          </View>
        </View>

        {mode === 'desktop' ? (
          <Pressable onPress={() => setDesktopFit((current) => current === 'cover' ? 'contain' : 'cover')} style={styles.compactAction}>
            <Text style={styles.compactActionText}>{desktopFit === 'cover' ? 'FIT' : 'FILL'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => { session.requestShell(); session.refreshSemantic(); setAppsVisible(true); }}
          style={styles.appsButton}
          accessibilityLabel="View open and pinned apps"
        >
          <Text style={styles.appsButtonText}>Apps</Text>
          <View style={styles.appsCount}><Text style={styles.appsCountText}>{openAppCount}</Text></View>
        </Pressable>
        <Pressable onPress={session.disconnect} style={styles.closeButton} accessibilityLabel="Disconnect">
          <Text style={styles.closeText}>X</Text>
        </Pressable>
      </View>

      {session.error ? <View style={styles.errorBanner}><Text style={styles.errorText} numberOfLines={2}>{session.error}</Text></View> : null}

      <View style={styles.main}>
        {mode === 'home' ? (
          <HomeScreen
            machineName={session.desktopMeta?.machineName ?? 'your PC'}
            hostOnline={session.hostOnline}
            windows={windows}
            shellSnapshot={session.shellSnapshot}
            shellResults={session.shellResults}
            icons={session.appIcons}
            onSearch={session.searchShell}
            onLaunch={launchItem}
            onOpenWindow={openWindow}
            onOpenLibrary={() => setAppsVisible(true)}
            onRefresh={refreshAll}
          />
        ) : mode === 'mobile' ? (
          <SemanticWorkspace snapshot={pendingSelection ? null : session.snapshot} visual={session.appVisual} cameraStatus={session.cameraStatus} hostOnline={session.hostOnline} icons={session.appIcons} onInput={session.sendInput} onCameraControl={session.sendCameraControl} onRefresh={session.refreshSemantic} />
        ) : mode === 'desktop' ? (
          <LiveCanvas frameUri={session.frameUri} meta={session.desktopMeta} interactive hostOnline={session.hostOnline} onInput={session.sendInput} fill resizeMode={desktopFit} />
        ) : (
          <ControlPanel meta={session.desktopMeta} onInput={session.sendInput} onQuality={session.setQuality} />
        )}
      </View>

      <View style={styles.tabBar} accessibilityRole="tablist">
        <ModeButton mode="home" current={mode} label="Home" onPress={setMode} />
        <ModeButton mode="mobile" current={mode} label="Current" onPress={setMode} />
        <ModeButton mode="desktop" current={mode} label="Desktop" onPress={setMode} />
        <ModeButton mode="input" current={mode} label="Input" onPress={setMode} />
      </View>

      <AppLibraryModal
        visible={appsVisible}
        windows={windows}
        snapshot={session.shellSnapshot}
        icons={session.appIcons}
        onClose={() => setAppsVisible(false)}
        onOpenWindow={openWindow}
        onLaunch={launchItem}
        onRefresh={refreshAll}
        onRequestIcons={session.requestIcons}
      />
    </SafeAreaView>
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

function ModeButton({ mode, current, label, onPress }: { mode: Mode; current: Mode; label: string; onPress: (mode: Mode) => void }) {
  const active = current === mode;
  return (
    <Pressable onPress={() => onPress(mode)} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 66, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  homeIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  homeIconText: { color: colors.text, fontSize: 18, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 10 },
  appName: { color: colors.text, fontSize: 13, fontWeight: '900', textTransform: 'capitalize' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusDotWaiting: { backgroundColor: colors.warning },
  statusText: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
  latency: { color: colors.textMuted, fontSize: 9, marginLeft: 2 },
  compactAction: { height: 38, paddingHorizontal: 9, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginRight: 5 },
  compactActionText: { color: colors.textMuted, fontSize: 8, fontWeight: '900' },
  appsButton: { height: 40, paddingLeft: 12, paddingRight: 7, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  appsButtonText: { color: colors.text, fontSize: 11, fontWeight: '900' },
  appsCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, marginLeft: 7, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  appsCountText: { color: colors.text, fontSize: 8, fontWeight: '900' },
  closeButton: { width: 36, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 3 },
  closeText: { color: colors.textMuted, fontSize: 11, fontWeight: '900' },
  errorBanner: { marginHorizontal: 14, marginTop: 8, borderRadius: 12, backgroundColor: '#3A1A2A', paddingHorizontal: 12, paddingVertical: 9 },
  errorText: { color: '#FDA4AF', fontSize: 11, lineHeight: 15 },
  main: { flex: 1 },
  tabBar: { minHeight: 64, paddingHorizontal: 8, paddingTop: 7, paddingBottom: 7, flexDirection: 'row', gap: 5, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
  tabActive: { backgroundColor: colors.surfaceRaised },
  tabLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '900' },
  tabLabelActive: { color: colors.text },
  tabIndicator: { width: 12, height: 3, borderRadius: 2, backgroundColor: 'transparent', marginTop: 6 },
  tabIndicatorActive: { width: 24, backgroundColor: colors.primaryBright },
});
