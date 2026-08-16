import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii } from '../theme';
import type { ConnectionStatus } from '../types';

interface Props {
  status: ConnectionStatus;
  error: string | null;
  restoring: boolean;
  onConnect: (relayUrl: string, pairingCode: string) => void;
}

const DEFAULT_RELAY = process.env.EXPO_PUBLIC_RELAY_URL ?? '';

export function ConnectionScreen({ status, error, restoring, onConnect }: Props) {
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY);
  const [pairingCode, setPairingCode] = useState('');
  const [showRelay, setShowRelay] = useState(!DEFAULT_RELAY);
  const busy = status === 'connecting' || restoring;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.brandRow}>
              <View style={styles.logo}><Text style={styles.logoGlyph}>P</Text></View>
              <Text style={styles.brand}>PocketDesk</Text>
            </View>

            {restoring ? (
              <View style={styles.restoring}>
                <ActivityIndicator color={colors.primaryBright} />
                <Text style={styles.restoringText}>Reconnecting to your PC…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.title}>Pair your PC</Text>
                <Text style={styles.subtitle}>Paste the one-time code shown by PocketDesk Host.</Text>

                <TextInput
                  value={pairingCode}
                  onChangeText={setPairingCode}
                  placeholder="Pairing code"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="ascii-capable"
                  style={styles.input}
                  accessibilityLabel="One-time pairing code"
                />

                {showRelay ? (
                  <TextInput
                    value={relayUrl}
                    onChangeText={setRelayUrl}
                    placeholder="https://relay.example.workers.dev"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[styles.input, styles.relayInput]}
                    accessibilityLabel="Cloudflare relay URL"
                  />
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  disabled={busy || !pairingCode.trim()}
                  onPress={() => onConnect(relayUrl, pairingCode)}
                  style={({ pressed }) => [
                    styles.connectButton,
                    pressed && styles.buttonPressed,
                    (busy || !pairingCode.trim()) && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator color={colors.inverseText} /> : null}
                  <Text style={styles.connectText}>{busy ? 'Pairing…' : 'Pair this phone'}</Text>
                </Pressable>

                <View style={styles.trustRow}>
                  <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
                  <Text style={styles.trustText}>This phone stays paired until you forget or reset it.</Text>
                </View>

                {DEFAULT_RELAY ? (
                  <Pressable onPress={() => setShowRelay((current) => !current)} style={styles.relayToggle}>
                    <Text style={styles.relayToggleText}>{showRelay ? 'Hide relay settings' : 'Relay settings'}</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.large, padding: 22 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  logoGlyph: { color: colors.inverseText, fontWeight: '900', fontSize: 18 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: 34 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  input: { minHeight: 56, borderRadius: radii.medium, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  relayInput: { marginTop: 10, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: 12 },
  connectButton: { height: 56, borderRadius: radii.medium, backgroundColor: colors.primary, marginTop: 14, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center' },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.5 },
  connectText: { color: colors.inverseText, fontSize: 15, fontWeight: '800' },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 15 },
  check: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: colors.success, fontSize: 11, fontWeight: '900' },
  trustText: { color: colors.textMuted, flex: 1, fontSize: 11, lineHeight: 16 },
  relayToggle: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 8 },
  relayToggleText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  restoring: { minHeight: 210, alignItems: 'center', justifyContent: 'center', gap: 14 },
  restoringText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
});
