import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii } from '../theme';
import type { InputCommand, SemanticControl, SemanticSnapshot } from '../types';

interface Props {
  snapshot: SemanticSnapshot | null;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}

export function SmartPanel({ snapshot, onInput, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  const controls = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snapshot?.controls ?? [];
    return (snapshot?.controls ?? []).filter(
      (control) =>
        control.label.toLowerCase().includes(normalized) ||
        control.kind.toLowerCase().includes(normalized),
    );
  }, [query, snapshot]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heroRow}>
        <View style={styles.smartIcon}><Text style={styles.smartGlyph}>✦</Text></View>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Smart controls</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {snapshot?.activeTitle ?? 'Scanning the active app…'}
          </Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.refresh}>
          <Text style={styles.refreshGlyph}>↻</Text>
        </Pressable>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Find a button, field, menu…"
        placeholderTextColor={colors.textMuted}
        style={styles.search}
      />

      <View style={styles.explainer}>
        <Text style={styles.explainerGlyph}>↗</Text>
        <Text style={styles.explainerText}>
          These controls come from Windows accessibility data and activate the real app.
        </Text>
      </View>

      {controls.length ? (
        <View style={styles.grid}>
          {controls.map((control) => (
            <ControlCard
              key={control.id}
              control={control}
              onPress={() => onInput({ kind: 'tap', x: control.x, y: control.y })}
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>◇</Text>
          <Text style={styles.emptyTitle}>
            {query ? 'No matching controls' : 'No mobile controls found'}
          </Text>
          <Text style={styles.emptyBody}>
            Some games and custom graphics do not expose accessibility actions. Use Direct mode for those.
          </Text>
          <Pressable style={styles.scanButton} onPress={onRefresh}>
            <Text style={styles.scanText}>Scan active app</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function ControlCard({ control, onPress }: { control: SemanticControl; onPress: () => void }) {
  const glyph = glyphForKind(control.kind);
  return (
    <Pressable
      disabled={!control.enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        control.focused && styles.controlFocused,
        !control.enabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.controlTop}>
        <Text style={styles.controlGlyph}>{glyph}</Text>
        <Text style={styles.kind}>{friendlyKind(control.kind)}</Text>
      </View>
      <Text style={styles.controlLabel} numberOfLines={3}>{control.label}</Text>
      <Text style={styles.activate}>Tap to activate  →</Text>
    </Pressable>
  );
}

function glyphForKind(kind: string): string {
  if (kind === 'Edit') return '⌨';
  if (kind.includes('Menu')) return '☰';
  if (kind.includes('Check')) return '✓';
  if (kind.includes('Radio')) return '◉';
  if (kind.includes('Tab')) return '▱';
  if (kind.includes('Combo')) return '⌄';
  if (kind.includes('Link')) return '↗';
  return '●';
}

function friendlyKind(kind: string): string {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 42 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  smartIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  smartGlyph: { color: colors.text, fontSize: 22 },
  heroCopy: { flex: 1, marginHorizontal: 12 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  subtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  refresh: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  refreshGlyph: { color: colors.primaryBright, fontSize: 21 },
  search: { minHeight: 50, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 14, marginTop: 16 },
  explainer: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#17233A', borderRadius: radii.medium, padding: 13, marginTop: 10 },
  explainerGlyph: { color: colors.accent, fontSize: 16 },
  explainerText: { flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 13 },
  control: { width: '48.6%', minHeight: 145, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  controlFocused: { borderColor: colors.accent },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  controlTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlGlyph: { color: colors.primaryBright, fontSize: 18 },
  kind: { color: colors.textMuted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  controlLabel: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 13, flex: 1 },
  activate: { color: colors.accent, fontSize: 9, fontWeight: '800', marginTop: 8 },
  empty: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.large, padding: 26, marginTop: 14 },
  emptyGlyph: { color: colors.primaryBright, fontSize: 30 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 10 },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  scanButton: { backgroundColor: colors.primary, paddingHorizontal: 17, paddingVertical: 12, borderRadius: radii.medium, marginTop: 15 },
  scanText: { color: colors.text, fontSize: 12, fontWeight: '800' },
});
