import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii } from '../theme';
import type { InputCommand } from '../types';

interface Props {
  onInput: (command: InputCommand) => void;
  secure?: boolean;
}

export function DesktopInputBar({ onInput, secure = false }: Props) {
  const [text, setText] = useState('');

  const sendText = () => {
    if (!text) return;
    onInput({ kind: 'text', text });
    setText('');
    if (secure) onInput({ kind: 'key', key: 'Enter' });
  };

  return (
    <View style={styles.bar}>
      {secure ? (
        <>
          <Shortcut label="Ctrl Alt Del" onPress={() => onInput({ kind: 'secureAttention' })} />
          <Shortcut label="Tab" onPress={() => onInput({ kind: 'key', key: 'Tab' })} />
        </>
      ) : (
        <>
          <Shortcut label="Copy" onPress={() => onInput({ kind: 'shortcut', keys: ['Ctrl', 'C'] })} />
          <Shortcut label="Paste" onPress={() => onInput({ kind: 'shortcut', keys: ['Ctrl', 'V'] })} />
        </>
      )}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={secure ? 'Windows password' : 'Type on PC'}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCapitalize={secure ? 'none' : 'sentences'}
        autoCorrect={!secure}
        spellCheck={!secure}
        secureTextEntry={secure}
        keyboardAppearance="dark"
        maxLength={2000}
        returnKeyType="send"
        onSubmitEditing={sendText}
        accessibilityLabel={secure ? 'Windows password' : 'Text to type on the remote PC'}
      />
      <Pressable
        onPress={sendText}
        disabled={!text}
        style={[styles.send, !text && styles.sendDisabled]}
        accessibilityLabel="Send text to PC"
      >
        <Text style={styles.sendText}>{secure ? 'Sign in' : 'Send'}</Text>
      </Pressable>
    </View>
  );
}

function Shortcut({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.shortcut} accessibilityRole="button">
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 56, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  shortcut: { minWidth: 48, height: 42, paddingHorizontal: 9, borderRadius: radii.small, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  shortcutText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  input: { flex: 1, height: 42, borderRadius: radii.small, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 11, fontSize: 14 },
  send: { minWidth: 50, height: 42, paddingHorizontal: 9, borderRadius: radii.small, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: colors.inverseText, fontSize: 10, fontWeight: '900' },
});
