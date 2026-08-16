import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, radii } from '../theme';
import type {
  ConnectionStatus,
  SemanticWindow,
  ShellApp,
  ShellSearchResults,
  ShellSnapshot,
} from '../types';
import { groupOpenWindows } from '../lib/windowApp';
import { MotionPressable } from './MotionPressable';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  machineName: string;
  hostOnline: boolean;
  status: ConnectionStatus;
  windows: SemanticWindow[];
  shellSnapshot: ShellSnapshot | null;
  shellResults: ShellSearchResults | null;
  icons: Record<string, string>;
  onSearch: (query: string) => void;
  onLaunch: (id: string) => void;
  onOpenWindow: (processId: number, windowHandle: number) => void;
  onOpenLibrary: () => void;
  onRefresh: () => void;
  onPairAgain: () => void;
}

export function HomeScreen({
  machineName,
  hostOnline,
  status,
  windows,
  shellSnapshot,
  shellResults,
  icons,
  onSearch,
  onLaunch,
  onOpenWindow,
  onOpenLibrary,
  onRefresh,
  onPairAgain,
}: Props) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [catalogTimedOut, setCatalogTimedOut] = useState(false);
  const normalizedQuery = query.trim();
  const apps = shellSnapshot?.apps ?? [];
  const columns = width >= 620 ? 6 : width >= 430 ? 5 : 4;
  const tileWidth = `${100 / columns}%` as `${number}%`;
  const pinned = useMemo(() => apps.filter((app) => app.pinned), [apps]);
  const suggested = useMemo(
    () => (pinned.length ? pinned : apps).slice(0, columns * 3),
    [apps, columns, pinned],
  );
  const openApps = useMemo(() => groupOpenWindows(windows, apps), [windows, apps]);

  useEffect(() => {
    if (normalizedQuery.length < 2) return;
    const timer = setTimeout(() => onSearch(normalizedQuery), 300);
    return () => clearTimeout(timer);
  }, [normalizedQuery, onSearch]);

  useEffect(() => {
    if (!hostOnline || shellSnapshot) {
      setCatalogTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setCatalogTimedOut(true), 12_000);
    return () => clearTimeout(timer);
  }, [hostOnline, shellSnapshot]);

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
      <View style={styles.launchpadHeader}>
        <View style={styles.launchpadCopy}>
          <Text style={styles.title}>Launchpad</Text>
          <View style={styles.machineRow}>
            <View style={[styles.liveDot, !hostOnline && styles.offlineDot]} />
            <Text style={styles.machineText} numberOfLines={1}>
              {hostOnline
                ? machineName
                : status === 'connected'
                  ? 'PC is not connected'
                  : status === 'reconnecting'
                    ? 'Reconnecting to PC'
                    : 'Connecting to PC'}
            </Text>
          </View>
        </View>
        <MotionPressable onPress={onOpenLibrary} style={styles.libraryButton} accessibilityLabel="Open app library">
          <View style={styles.libraryGlyph}>
            {Array.from({ length: 9 }, (_, index) => <View key={index} style={styles.librarySquare} />)}
          </View>
        </MotionPressable>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchMark}>⌕</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps and files"
          placeholderTextColor={colors.textDim}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} style={styles.clearButton} accessibilityLabel="Clear search">
            <Text style={styles.clearText}>×</Text>
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
          <SectionHeader title="Favorites" action="All apps" onAction={onOpenLibrary} />
          {status === 'reconnecting' || status === 'connecting' ? (
            <LoadingState label={status === 'reconnecting' ? 'Reconnecting to your PC' : 'Connecting to your PC'} />
          ) : !hostOnline ? (
            <EmptyState
              title="This pairing is offline"
              body="This PC is offline. PocketDesk will reconnect automatically when Windows and the host are available."
              actionLabel="Forget PC"
              onPress={onPairAgain}
            />
          ) : shellSnapshot ? (
            suggested.length ? (
              <>
                <View style={styles.appGrid}>
                  {suggested.map((app) => (
                    <AppTile
                      key={app.id}
                      app={app}
                      icons={icons}
                      width={tileWidth}
                      onPress={() => onLaunch(app.id)}
                    />
                  ))}
                </View>
                <View style={styles.pageDots}>
                  <View style={styles.pageDotActive} />
                  {apps.length > suggested.length ? <View style={styles.pageDot} /> : null}
                </View>
              </>
            ) : (
              <EmptyState title="No favorites yet" body="Refresh after Windows is unlocked to load Start menu apps." onPress={onRefresh} />
            )
          ) : catalogTimedOut ? (
            <EmptyState
              title="Apps are taking too long"
              body="Your PC is online, but the Windows app catalog did not arrive. Try the request again."
              actionLabel="Try again"
              onPress={() => {
                setCatalogTimedOut(false);
                onRefresh();
              }}
            />
          ) : (
            <LoadingState label="Loading your Windows apps" />
          )}

          <View style={styles.openShelf}>
            <View style={styles.shelfHeader}>
              <Text style={styles.shelfTitle}>Open now</Text>
              <Pressable onPress={onOpenLibrary} hitSlop={10}><Text style={styles.shelfCount}>{openApps.length}</Text></Pressable>
            </View>
            {openApps.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.runningRow}>
                {openApps.map((group) => {
                  const window = group.representative;
                  return (
                    <MotionPressable
                      key={group.key}
                      onPress={() => onOpenWindow(window.processId, window.windowHandle)}
                      style={styles.runningApp}
                      accessibilityLabel={`Open ${group.name}`}
                    >
                      <View style={styles.runningAppInner}>
                        <View style={[styles.runningIcon, window.active && styles.runningIconActive]}>
                          <RemoteIcon iconKey={group.iconKey} icons={icons} size={45} radius={12} active={window.active} />
                        </View>
                        <Text style={styles.runningName} numberOfLines={1}>{group.name}</Text>
                        <View style={[styles.runningDot, window.active && styles.runningDotActive]} />
                      </View>
                    </MotionPressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.shelfEmpty}>
                <Text style={styles.shelfEmptyText}>Open an app above and it will stay within reach here.</Text>
              </View>
            )}
          </View>
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
  if (searching && !apps.length) return <LoadingState label="Searching Windows" />;
  if (!apps.length && !files.length) {
    return <View style={styles.noResults}><Text style={styles.noResultsTitle}>No results</Text><Text style={styles.noResultsBody}>Try a shorter app or file name.</Text></View>;
  }

  return (
    <View style={styles.results}>
      {apps.length ? <Text style={styles.resultHeading}>Applications</Text> : null}
      {apps.map((app) => (
        <ResultRow key={app.id} iconKey={app.iconKey} icons={icons} title={app.name} detail={app.pinned ? 'Favorite' : app.category} onPress={() => onLaunch(app.id)} />
      ))}
      {files.length ? <Text style={styles.resultHeading}>Files</Text> : null}
      {files.map((file) => (
        <ResultRow key={file.id} mark="▤" icons={icons} title={file.name} detail={`${file.kind} · ${file.location}`} onPress={() => onLaunch(file.id)} />
      ))}
      {searching ? <ActivityIndicator color={colors.text} style={styles.moreSpinner} /> : null}
    </View>
  );
}

function AppTile({ app, icons, width, onPress }: { app: ShellApp; icons: Record<string, string>; width: `${number}%`; onPress: () => void }) {
  return (
    <MotionPressable onPress={onPress} style={[styles.appTile, { width }]} accessibilityLabel={`Open ${app.name}`}>
      <View style={styles.appTileInner}>
        <View style={styles.appIconFrame}>
          <RemoteIcon iconKey={app.iconKey} icons={icons} size={56} radius={14} />
        </View>
        <Text style={styles.tileName} numberOfLines={2}>{app.name}</Text>
      </View>
    </MotionPressable>
  );
}

function ResultRow({ iconKey, mark, icons, title, detail, onPress }: { iconKey?: string; mark?: string; icons: Record<string, string>; title: string; detail: string; onPress: () => void }) {
  return (
    <MotionPressable onPress={onPress} style={styles.resultRow} accessibilityLabel={`Open ${title}`}>
      <View style={styles.resultRowInner}>
        {iconKey ? <RemoteIcon iconKey={iconKey} icons={icons} size={42} radius={11} /> : <View style={styles.resultIcon}><Text style={styles.resultMark}>{mark ?? '▤'}</Text></View>}
        <View style={styles.resultCopy}><Text style={styles.resultTitle} numberOfLines={1}>{title}</Text><Text style={styles.resultDetail} numberOfLines={1}>{detail}</Text></View>
        <Text style={styles.resultChevron}>›</Text>
      </View>
    </MotionPressable>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Pressable onPress={onAction} hitSlop={10}><Text style={styles.sectionAction}>{action}</Text></Pressable></View>;
}

function LoadingState({ label }: { label: string }) {
  return <View style={styles.loadingState}><ActivityIndicator color={colors.text} /><Text style={styles.loadingLabel}>{label}</Text></View>;
}

function EmptyState({ title, body, actionLabel = 'Refresh', onPress }: { title: string; body: string; actionLabel?: string; onPress: () => void }) {
  return <View style={styles.emptyState}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text><MotionPressable style={styles.emptyButton} onPress={onPress}><View style={styles.emptyButtonInner}><Text style={styles.emptyButtonText}>{actionLabel}</Text></View></MotionPressable></View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 26 },
  launchpadHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center' },
  launchpadCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -1.1 },
  machineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text, marginRight: 7 },
  offlineDot: { backgroundColor: colors.textDim },
  machineText: { maxWidth: 260, color: colors.textMuted, fontSize: 11, fontWeight: '500' },
  libraryButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  libraryGlyph: { width: 16, height: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 2, alignSelf: 'center', marginTop: 12 },
  librarySquare: { width: 4, height: 4, borderRadius: 1, backgroundColor: colors.text },
  searchBox: { height: 48, marginTop: 18, borderRadius: 15, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13 },
  searchMark: { width: 24, color: colors.textMuted, fontSize: 20, lineHeight: 22 },
  searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 14, fontWeight: '500' },
  clearButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.textMuted, fontSize: 18, lineHeight: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 13 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  sectionAction: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  appTile: { height: 101, paddingHorizontal: 5, marginBottom: 10 },
  appTileInner: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2 },
  appIconFrame: { width: 62, height: 62, borderRadius: 17, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tileName: { width: '100%', color: colors.text, fontSize: 10, lineHeight: 13, fontWeight: '500', textAlign: 'center', marginTop: 7 },
  pageDots: { height: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 2 },
  pageDotActive: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.text },
  pageDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  openShelf: { marginTop: 22, borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingVertical: 13 },
  shelfHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 11 },
  shelfTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  shelfCount: { minWidth: 24, color: colors.textMuted, fontSize: 10, fontWeight: '700', textAlign: 'right' },
  runningRow: { paddingHorizontal: 10, gap: 4 },
  runningApp: { width: 72, height: 82 },
  runningAppInner: { flex: 1, alignItems: 'center' },
  runningIcon: { width: 51, height: 51, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  runningIconActive: { borderWidth: 1, borderColor: colors.borderStrong },
  runningName: { width: 68, color: colors.textMuted, fontSize: 9, textAlign: 'center', marginTop: 5 },
  runningDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textDim, marginTop: 4 },
  runningDotActive: { width: 4, height: 4, backgroundColor: colors.text },
  shelfEmpty: { minHeight: 62, justifyContent: 'center', paddingHorizontal: 14 },
  shelfEmptyText: { color: colors.textDim, fontSize: 11, lineHeight: 17 },
  loadingState: { minHeight: 130, borderRadius: radii.large, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: 20, gap: 12 },
  loadingLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '500' },
  emptyState: { minHeight: 150, borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 22, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyBody: { maxWidth: 280, color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 6 },
  emptyButton: { width: 92, height: 38, borderRadius: 19, backgroundColor: colors.primary, marginTop: 14 },
  emptyButtonInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyButtonText: { color: colors.inverseText, fontSize: 11, fontWeight: '700' },
  results: { marginTop: 22 },
  resultHeading: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  resultRow: { height: 64, marginBottom: 3 },
  resultRowInner: { flex: 1, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 },
  resultIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  resultMark: { color: colors.textMuted, fontSize: 17 },
  resultCopy: { flex: 1, marginHorizontal: 11 },
  resultTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  resultDetail: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  resultChevron: { color: colors.textDim, fontSize: 23, marginRight: 4 },
  noResults: { paddingVertical: 64, alignItems: 'center' },
  noResultsTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  noResultsBody: { color: colors.textMuted, fontSize: 11, marginTop: 7 },
  moreSpinner: { marginTop: 14 },
});
