import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii } from '../theme';
import type { CaptureProfile, DesktopMeta, InputCommand } from '../types';

interface Props {
  meta: DesktopMeta | null;
  onInput: (command: InputCommand) => void;
  onQuality: (profile: CaptureProfile) => void;
}

export function ControlPanel({ meta, onInput, onQuality }: Props) {
  const [text, setText] = useState('');
  const last = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const profile = meta?.profile ?? 'balanced';

  const trackpad = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          last.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
          moved.current = false;
        },
        onPanResponderMove: (event) => {
          const x = event.nativeEvent.pageX;
          const y = event.nativeEvent.pageY;
          const dx = x - last.current.x;
          const dy = y - last.current.y;
          last.current = { x, y };
          if (Math.abs(dx) + Math.abs(dy) > 0.5) {
            moved.current = true;
            onInput({ kind: 'moveRelative', dx, dy });
          }
        },
        onPanResponderRelease: () => {
          if (!moved.current) onInput({ kind: 'leftClick' });
        },
      }),
    [onInput],
  );

  const submitText = () => {
    if (!text) return;
    onInput({ kind: 'text', text });
    setText('');
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Precision trackpad</Text>
          <Text style={styles.sectionBody}>Move anywhere. Tap anywhere to click.</Text>
        </View>
        <Text style={styles.gesture}>⌁</Text>
      </View>

      <View style={styles.trackpad} {...trackpad.panHandlers}>
        <View style={styles.trackpadMark} />
        <Text style={styles.trackpadLabel}>MOVE CURSOR</Text>
      </View>

      <View style={styles.mouseRow}>
        <ActionButton label="Left click" glyph="◉" onPress={() => onInput({ kind: 'leftClick' })} />
        <ActionButton
          label="Double"
          glyph="◎"
          onPress={() => {
            onInput({ kind: 'leftClick' });
            onInput({ kind: 'leftClick' });
          }}
        />
        <ActionButton label="Right click" glyph="◌" onPress={() => onInput({ kind: 'rightClick' })} />
      </View>

      <View style={styles.scrollRow}>
        <Pressable style={styles.wideButton} onPress={() => onInput({ kind: 'scroll', delta: 420 })}>
          <Text style={styles.buttonGlyph}>↑</Text>
          <Text style={styles.buttonText}>Scroll up</Text>
        </Pressable>
        <Pressable style={styles.wideButton} onPress={() => onInput({ kind: 'scroll', delta: -420 })}>
          <Text style={styles.buttonGlyph}>↓</Text>
          <Text style={styles.buttonText}>Scroll down</Text>
        </Pressable>
      </View>

      <Text style={styles.overline}>TYPE ON YOUR PC</Text>
      <View style={styles.composerRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={submitText}
          placeholder="Write or paste text…"
          placeholderTextColor={colors.textMuted}
          style={styles.composer}
          returnKeyType="send"
        />
        <Pressable style={styles.sendButton} onPress={submitText}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutRow}>
        <Shortcut label="Esc" onPress={() => onInput({ kind: 'key', key: 'Escape' })} />
        <Shortcut label="Tab" onPress={() => onInput({ kind: 'key', key: 'Tab' })} />
        <Shortcut label="Enter" onPress={() => onInput({ kind: 'key', key: 'Enter' })} />
        <Shortcut label="Ctrl L" onPress={() => onInput({ kind: 'shortcut', keys: ['Ctrl', 'L'] })} />
        <Shortcut label="Alt Tab" onPress={() => onInput({ kind: 'shortcut', keys: ['Alt', 'Tab'] })} />
        <Shortcut label="Close app" onPress={() => onInput({ kind: 'shortcut', keys: ['Alt', 'F4'] })} />
        <Shortcut label="Ctrl W" onPress={() => onInput({ kind: 'shortcut', keys: ['Ctrl', 'W'] })} />
      </ScrollView>

      <Text style={styles.overline}>STREAM PROFILE</Text>
      <View style={styles.profileRow}>
        {(['smooth', 'balanced', 'sharp'] as const).map((option) => (
          <Pressable
            key={option}
            onPress={() => onQuality(option)}
            style={[styles.profile, profile === option && styles.profileActive]}
          >
            <Text style={[styles.profileText, profile === option && styles.profileTextActive]}>
              {option[0].toUpperCase() + option.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ActionButton({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionButton} onPress={onPress}>
      <Text style={styles.buttonGlyph}>{glyph}</Text>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Shortcut({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.shortcut} onPress={onPress}>
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionBody: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  gesture: { color: colors.textMuted, fontSize: 28 },
  trackpad: {
    height: 154,
    borderRadius: radii.large,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackpadMark: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.textMuted },
  trackpadLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, marginTop: 10 },
  mouseRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionButton: {
    flex: 1,
    minHeight: 62,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  wideButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonGlyph: { color: colors.textMuted, fontSize: 18 },
  buttonText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  overline: { color: colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 22, marginBottom: 9 },
  composerRow: { flexDirection: 'row', gap: 8 },
  composer: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.medium,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
  },
  sendButton: { minWidth: 72, borderRadius: radii.medium, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.inverseText, fontSize: 13, fontWeight: '800' },
  shortcutRow: { gap: 8, paddingRight: 16 },
  shortcut: { paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.surfaceRaised, borderRadius: radii.small },
  shortcutText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  profileRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.medium, padding: 4 },
  profile: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  profileActive: { backgroundColor: colors.primary },
  profileText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  profileTextActive: { color: colors.inverseText },
});
