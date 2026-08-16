import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii } from '../theme';
import type {
  SemanticWindow,
  ShellApp,
  ShellSearchResults,
  ShellSnapshot,
} from '../types';
import { groupOpenWindows } from '../lib/windowApp';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  machineName: string;
  hostOnline: boolean;
  windows: SemanticWindow[];
  shellSnapshot: ShellSnapshot | null;
  shellResults: ShellSearchResults | null;
  icons: Record<string, string>;
  onSearch: (query: string) => void;
  onLaunch: (id: string) => void;
  onOpenWindow: (processId: number, windowHandle: number) => void;
  onOpenLibrary: () => void;
  onRefresh: () => void;
}

export function HomeScreen({
  machineName,
  hostOnline,
  windows,
  shellSnapshot,
  shellResults,
  icons,
  onSearch,
  onLaunch,
  onOpenWindow,
  onOpenLibrary,
  onRefresh,
}: Props) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim();
  const apps = shellSnapshot?.apps ?? [];
  const pinned = useMemo(() => apps.filter((app) => app.pinned).slice(0, 18), [apps]);
  const suggested = useMemo(
    () => (pinned.length ? pinned : apps).slice(0, 12),
    [apps, pinned],
  );
  const openApps = useMemo(() => groupOpenWindows(windows, apps), [windows, apps]);

  useEffect(() => {
    if (normalizedQuery.length < 2) return;
    const timer = setTimeout(() => onSearch(normalizedQuery), 350);
    return () => clearTimeout(timer);
  }, [normalizedQuery, onSearch]);

  const currentResults = shellResults?.query.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase()
    ? shellResults
    : null;
  const localMatches = normalizedQuery
    ? apps.filter((app) => app.name.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase())).slice(0, 30)
    : [];
  const resultApps = currentResults?.apps ?? localMatches;
  const resultFiles = currentResults?.files ?? [];
  const searching = normalizedQuery.length >= 2 && !currentResults;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>WINDOWS ON YOUR PHONE</Text>
        <Text style={styles.title}>Good to see you.</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {hostOnline ? `${machineName} is ready` : `Waiting for ${machineName}`}
        </Text>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchMark}>Q</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps and files on your PC"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} style={styles.clearButton} accessibilityLabel="Clear search">
            <Text style={styles.clearText}>X</Text>
          </Pressable>
        ) : null}
      </View>

      {normalizedQuery ? (
        <SearchResults
          apps={resultApps}
          files={resultFiles}
          searching={searching}
          icons={icons}
          onLaunch={onLaunch}
        />
      ) : (
        <>
          <SectionHeader title="Pinned" action="All apps" onAction={onOpenLibrary} />
          {shellSnapshot ? (
            suggested.length ? (
              <View style={styles.appGrid}>
                {suggested.map((app) => <AppTile key={app.id} app={app} icons={icons} onPress={() => onLaunch(app.id)} />)}
              </View>
            ) : (
              <EmptyCard title="No Start menu apps found" body="Refresh the Windows app catalog after the PC is unlocked." onPress={onRefresh} />
            )
          ) : (
            <LoadingCard label="Reading your Start menu and taskbar" />
          )}

          <SectionHeader title="Open now" action={`${openApps.length} apps`} onAction={onOpenLibrary} />
          {openApps.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.windowRow}>
              {openApps.map((group) => {
                const window = group.representative;
                return (
                <Pressable
                  key={group.key}
                  onPress={() => onOpenWindow(window.processId, window.windowHandle)}
                  style={({ pressed }) => [styles.windowCard, window.active && styles.windowCardActive, pressed && styles.pressed]}
                >
                  <RemoteIcon iconKey={group.iconKey} icons={icons} size={42} radius={13} active={window.active} />
                  <Text style={styles.windowProcess} numberOfLines={1}>{group.name}</Text>
                  <Text style={styles.windowTitle} numberOfLines={2}>{group.windows.length > 1 ? `${group.windows.length} windows` : window.title}</Text>
                  <Text style={styles.openLabel}>{window.active ? 'CURRENT' : 'OPEN'}</Text>
                </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <EmptyCard title="No open windows" body="Launch a pinned app or refresh after unlocking Windows." onPress={onRefresh} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function SearchResults({
  apps,
  files,
  searching,
  icons,
  onLaunch,
}: {
  apps: ShellApp[];
  files: ShellSearchResults['files'];
  searching: boolean;
  icons: Record<string, string>;
  onLaunch: (id: string) => void;
}) {
  if (searching && !apps.length) return <LoadingCard label="Searching Windows" />;
  if (!apps.length && !files.length) {
    return <View style={styles.noResults}><Text style={styles.noResultsTitle}>No matches yet</Text><Text style={styles.noResultsBody}>Try an app name or part of a file name.</Text></View>;
  }

  return (
    <View style={styles.results}>
      {apps.length ? <Text style={styles.resultHeading}>APPS</Text> : null}
      {apps.map((app) => (
        <ResultRow key={app.id} iconKey={app.iconKey} icons={icons} title={app.name} detail={app.pinned ? 'Pinned to taskbar' : app.category} onPress={() => onLaunch(app.id)} />
      ))}
      {files.length ? <Text style={styles.resultHeading}>FILES</Text> : null}
      {files.map((file) => (
        <ResultRow key={file.id} initial="F" icons={icons} title={file.name} detail={`${file.kind} - ${file.location}`} onPress={() => onLaunch(file.id)} />
      ))}
      {searching ? <ActivityIndicator color={colors.primaryBright} style={styles.moreSpinner} /> : null}
    </View>
  );
}

function AppTile({ app, icons, onPress }: { app: ShellApp; icons: Record<string, string>; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.appTile, pressed && styles.pressed]}>
      <RemoteIcon iconKey={app.iconKey} icons={icons} size={46} radius={14} />
      <Text style={styles.tileName} numberOfLines={2}>{app.name}</Text>
      <Text style={styles.tileCategory} numberOfLines={1}>{app.pinned ? 'TASKBAR' : app.category.toUpperCase()}</Text>
    </Pressable>
  );
}

function ResultRow({ iconKey, initial: mark, icons, title, detail, onPress }: { iconKey?: string; initial?: string; icons: Record<string, string>; title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}>
      {iconKey ? <RemoteIcon iconKey={iconKey} icons={icons} size={44} radius={13} /> : <View style={styles.resultIcon}><Text style={styles.resultInitial}>{mark ?? 'F'}</Text></View>}
      <View style={styles.resultCopy}><Text style={styles.resultTitle} numberOfLines={1}>{title}</Text><Text style={styles.resultDetail} numberOfLines={1}>{detail}</Text></View>
      <Text style={styles.resultOpen}>OPEN</Text>
    </Pressable>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable></View>;
}

function LoadingCard({ label }: { label: string }) {
  return <View style={styles.loadingCard}><ActivityIndicator color={colors.primaryBright} /><Text style={styles.loadingLabel}>{label}</Text></View>;
}

function EmptyCard({ title, body, onPress }: { title: string; body: string; onPress: () => void }) {
  return <View style={styles.emptyCard}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text><Pressable style={styles.emptyButton} onPress={onPress}><Text style={styles.emptyButtonText}>Refresh</Text></Pressable></View>;
}

function initial(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || 'W';
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 38 },
  hero: { paddingTop: 10, paddingBottom: 20 },
  eyebrow: { color: colors.primaryBright, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -1, marginTop: 6 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 5 },
  searchBox: { height: 56, borderRadius: 18, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchMark: { color: colors.primaryBright, fontSize: 12, fontWeight: '900', marginRight: 10 },
  searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 14, fontWeight: '600' },
  clearButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.textMuted, fontSize: 11, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  sectionAction: { color: colors.primaryBright, fontSize: 11, fontWeight: '800' },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  appTile: { width: '48%', minHeight: 134, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  tileIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tileInitial: { color: colors.text, fontSize: 18, fontWeight: '900' },
  tileName: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 10 },
  tileCategory: { color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginTop: 5 },
  windowRow: { gap: 10, paddingRight: 16 },
  windowCard: { width: 176, minHeight: 148, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  windowCardActive: { borderColor: colors.primary, backgroundColor: '#17213A' },
  windowIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: colors.primary },
  windowInitial: { color: colors.text, fontSize: 17, fontWeight: '900' },
  windowProcess: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 10 },
  windowTitle: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  openLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 9 },
  loadingCard: { minHeight: 110, borderRadius: radii.medium, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: 18, gap: 12 },
  loadingLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  emptyCard: { borderRadius: radii.medium, backgroundColor: colors.surface, padding: 20, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  emptyBody: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 13 },
  emptyButtonText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  results: { marginTop: 20 },
  resultHeading: { color: colors.primaryBright, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, marginTop: 13, marginBottom: 8 },
  resultRow: { minHeight: 68, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 8 },
  resultIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  resultInitial: { color: colors.text, fontSize: 17, fontWeight: '900' },
  resultCopy: { flex: 1, marginHorizontal: 11 },
  resultTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  resultDetail: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  resultOpen: { color: colors.primaryBright, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  noResults: { paddingVertical: 50, alignItems: 'center' },
  noResultsTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  noResultsBody: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  moreSpinner: { marginTop: 12 },
  pressed: { opacity: 0.7 },
});
