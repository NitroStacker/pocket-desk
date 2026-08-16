import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../theme';
import type { InputCommand, SemanticSnapshot } from '../types';

interface Props {
  snapshot: SemanticSnapshot | null;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}

export function AppsPanel({ snapshot, onInput, onRefresh }: Props) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Open apps</Text>
          <Text style={styles.body}>Switch windows without finding tiny taskbar icons.</Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.refresh}>
          <Text style={styles.refreshGlyph}>↻</Text>
        </Pressable>
      </View>

      {snapshot?.windows.length ? (
        snapshot.windows.map((window) => (
          <Pressable
            key={window.windowHandle}
            onPress={() => onInput({ kind: 'focusWindow', processId: window.processId, windowHandle: window.windowHandle })}
            style={({ pressed }) => [
              styles.appCard,
              window.active && styles.appCardActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.appIcon, window.active && styles.appIconActive]}>
              <Text style={styles.appInitial}>{window.process.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.appCopy}>
              <Text style={styles.appName} numberOfLines={1}>{window.process}</Text>
              <Text style={styles.appTitle} numberOfLines={2}>{window.title}</Text>
            </View>
            <View style={styles.trailing}>
              {window.active ? <Text style={styles.activeLabel}>ACTIVE</Text> : null}
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        ))
      ) : (
        <EmptyState onRefresh={onRefresh} />
      )}
    </ScrollView>
  );
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>▦</Text>
      <Text style={styles.emptyTitle}>No windows yet</Text>
      <Text style={styles.emptyBody}>Refresh after the host connects and unlocks the Windows desktop.</Text>
      <Pressable style={styles.emptyButton} onPress={onRefresh}>
        <Text style={styles.emptyButtonText}>Scan desktop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headerCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  body: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  refresh: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  refreshGlyph: { color: colors.primaryBright, fontSize: 21 },
  appCard: {
    minHeight: 78,
    borderRadius: radii.medium,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  appCardActive: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.74 },
  appIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  appIconActive: { backgroundColor: colors.surfaceSoft },
  appInitial: { color: colors.text, fontSize: 20, fontWeight: '900' },
  appCopy: { flex: 1, marginHorizontal: 12 },
  appName: { color: colors.text, fontSize: 14, fontWeight: '800', textTransform: 'capitalize' },
  appTitle: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  trailing: { alignItems: 'flex-end', gap: 5 },
  activeLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  chevron: { color: colors.textMuted, fontSize: 26 },
  empty: { backgroundColor: colors.surface, borderRadius: radii.large, alignItems: 'center', padding: 28, marginTop: 10 },
  emptyGlyph: { color: colors.primaryBright, fontSize: 32 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 12 },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radii.medium, paddingHorizontal: 18, paddingVertical: 12, marginTop: 16 },
  emptyButtonText: { color: colors.inverseText, fontWeight: '800', fontSize: 12 },
});
