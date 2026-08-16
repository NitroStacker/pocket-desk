import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii } from '../theme';
import type { SemanticWindow, ShellApp, ShellSnapshot } from '../types';
import { groupOpenWindows } from '../lib/windowApp';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  visible: boolean;
  windows: SemanticWindow[];
  snapshot: ShellSnapshot | null;
  icons: Record<string, string>;
  onClose: () => void;
  onOpenWindow: (processId: number, windowHandle: number) => void;
  onLaunch: (id: string) => void;
  onRefresh: () => void;
  onRequestIcons: (keys: string[]) => void;
}

export function AppLibraryModal({ visible, windows, snapshot, icons, onClose, onOpenWindow, onLaunch, onRefresh, onRequestIcons }: Props) {
  const [query, setQuery] = useState('');
  const apps = snapshot?.apps ?? [];
  const normalized = query.trim().toLocaleLowerCase();
  const shownApps = useMemo(
    () => apps.filter((app) => !normalized || `${app.name} ${app.category}`.toLocaleLowerCase().includes(normalized)).slice(0, 100),
    [apps, normalized],
  );
  const pinned = shownApps.filter((app) => app.pinned);
  const remaining = shownApps.filter((app) => !app.pinned);
  const openApps = useMemo(() => groupOpenWindows(windows, apps).filter((group) => {
    if (!normalized) return true;
    return `${group.name} ${group.windows.map((window) => window.title).join(' ')}`
      .toLocaleLowerCase()
      .includes(normalized);
  }), [windows, apps, normalized]);

  useEffect(() => {
    if (!visible) return;
    onRequestIcons([
      ...openApps.map((group) => group.iconKey),
      ...shownApps.map((app) => app.iconKey),
    ]);
  }, [visible, openApps, shownApps, onRequestIcons]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>WINDOWS LIBRARY</Text>
            <Text style={styles.title}>Apps</Text>
          </View>
          <Pressable onPress={onRefresh} style={styles.headerButton}><Text style={styles.headerButtonText}>Sync</Text></Pressable>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Close apps"><Text style={styles.closeText}>X</Text></Pressable>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchMark}>Q</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Filter your apps" placeholderTextColor={colors.textMuted} style={styles.searchInput} autoCorrect={false} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <SectionLabel title="Open now" count={openApps.length} />
          {openApps.length ? openApps.map((group) => {
            const window = group.representative;
            const detail = group.windows.length > 1
              ? `${group.windows.length} windows · ${window.title}`
              : window.title;
            return (
            <Pressable key={group.key} onPress={() => onOpenWindow(window.processId, window.windowHandle)} style={({ pressed }) => [styles.windowRow, window.active && styles.activeRow, pressed && styles.pressed]}>
              <RemoteIcon iconKey={group.iconKey} icons={icons} size={46} radius={14} active={window.active} />
              <View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{group.name}</Text><Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text></View>
              <Text style={[styles.rowAction, window.active && styles.activeAction]}>{window.active ? 'CURRENT' : 'SWITCH'}</Text>
            </Pressable>
            );
          }) : <Text style={styles.emptyText}>No desktop windows are open.</Text>}

          <SectionLabel title="Pinned to taskbar" count={pinned.length} />
          {pinned.length ? <View style={styles.grid}>{pinned.map((app) => <LibraryTile key={app.id} app={app} icons={icons} onPress={() => onLaunch(app.id)} />)}</View> : <Text style={styles.emptyText}>No pinned shortcuts were found.</Text>}

          <SectionLabel title={query ? 'Matching apps' : 'All Start menu apps'} count={remaining.length} />
          {remaining.map((app) => (
            <Pressable key={app.id} onPress={() => onLaunch(app.id)} style={({ pressed }) => [styles.windowRow, pressed && styles.pressed]}>
              <RemoteIcon iconKey={app.iconKey} icons={icons} size={46} radius={14} />
              <View style={styles.rowCopy}><Text style={styles.rowTitle} numberOfLines={1}>{app.name}</Text><Text style={styles.rowDetail} numberOfLines={1}>{app.category}</Text></View>
              <Text style={styles.rowAction}>OPEN</Text>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function SectionLabel({ title, count }: { title: string; count: number }) {
  return <View style={styles.sectionLabel}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.countBadge}><Text style={styles.countText}>{count}</Text></View></View>;
}

function LibraryTile({ app, icons, onPress }: { app: ShellApp; icons: Record<string, string>; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}><RemoteIcon iconKey={app.iconKey} icons={icons} size={46} radius={14} /><Text style={styles.tileName} numberOfLines={2}>{app.name}</Text><Text style={styles.pinLabel}>PINNED</Text></Pressable>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 76, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primaryBright, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 25, fontWeight: '900', letterSpacing: -0.6, marginTop: 2 },
  headerButton: { height: 40, paddingHorizontal: 14, borderRadius: 13, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  headerButtonText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  closeButton: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginLeft: 7 },
  closeText: { color: colors.textMuted, fontSize: 13, fontWeight: '900' },
  searchBox: { height: 52, margin: 16, marginBottom: 2, borderRadius: 17, backgroundColor: colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchMark: { color: colors.primaryBright, fontSize: 11, fontWeight: '900', marginRight: 10 },
  searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 14, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', flex: 1 },
  countBadge: { minWidth: 26, height: 22, borderRadius: 11, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { color: colors.textMuted, fontSize: 9, fontWeight: '900' },
  windowRow: { minHeight: 69, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  activeRow: { borderColor: colors.primary, backgroundColor: '#17213A' },
  appIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  appIconActive: { backgroundColor: colors.primary },
  appInitial: { color: colors.text, fontSize: 18, fontWeight: '900' },
  rowCopy: { flex: 1, marginHorizontal: 11 },
  rowTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  rowDetail: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  rowAction: { color: colors.primaryBright, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  activeAction: { color: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', minHeight: 126, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12 },
  tileName: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800', marginTop: 9 },
  pinLabel: { color: colors.textMuted, fontSize: 7, fontWeight: '900', letterSpacing: 0.8, marginTop: 5 },
  emptyText: { color: colors.textMuted, fontSize: 11, lineHeight: 17, paddingVertical: 12 },
  pressed: { opacity: 0.7 },
});
