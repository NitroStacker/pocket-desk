import { useState } from 'react';
import {
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
  onConnect: (relayUrl: string, pairingCode: string) => void;
}

const DEFAULT_RELAY = process.env.EXPO_PUBLIC_RELAY_URL ?? '';

export function ConnectionScreen({ status, error, onConnect }: Props) {
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY);
  const [pairingCode, setPairingCode] = useState('');
  const busy = status === 'connecting';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Text style={styles.logoGlyph}>P</Text>
            </View>
            <Text style={styles.brand}>PocketDesk</Text>
          </View>

          <View style={styles.hero}>
            <View style={styles.eyebrow}>
              <View style={styles.liveDot} />
              <Text style={styles.eyebrowText}>YOUR PC, REFITTED FOR MOBILE</Text>
            </View>
            <Text style={styles.title}>Your desktop.{`\n`}Now thumb-friendly.</Text>
            <Text style={styles.subtitle}>
              Direct control when you need every pixel. Smart controls when you want
              apps, menus, and actions shaped for your phone.
            </Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.step}>1  RELAY</Text>
            <Text style={styles.label}>Cloudflare relay URL</Text>
            <TextInput
              value={relayUrl}
              onChangeText={setRelayUrl}
              placeholder="https://pocketdesk-relay…workers.dev"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              accessibilityLabel="Cloudflare relay URL"
            />

            <View style={styles.divider} />

            <Text style={styles.step}>2  PAIR</Text>
            <Text style={styles.label}>One-time pairing code</Text>
            <TextInput
              value={pairingCode}
              onChangeText={setPairingCode}
              placeholder="Paste the code shown on your PC"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              accessibilityLabel="Pairing code"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              disabled={busy}
              onPress={() => onConnect(relayUrl, pairingCode)}
              style={({ pressed }) => [
                styles.connectButton,
                pressed && styles.buttonPressed,
                busy && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.connectText}>{busy ? 'Connecting…' : 'Connect securely'}</Text>
              <Text style={styles.arrow}>→</Text>
            </Pressable>

            <View style={styles.securityRow}>
              <Text style={styles.lock}>◆</Text>
              <Text style={styles.securityText}>
                Session keys expire. Your PC is never opened directly to the internet.
              </Text>
            </View>
          </View>

          <View style={styles.featureRow}>
            <Feature glyph="◎" title="Direct" body="Pixel-perfect touch" />
            <Feature glyph="⌁" title="Trackpad" body="Precise cursor control" />
            <Feature glyph="✦" title="Smart" body="Mobile-sized actions" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Feature({ glyph, title, body }: { glyph: string; title: string; body: string }) {
  return (
    <View style={styles.feature}>
      <Text style={styles.featureGlyph}>{glyph}</Text>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 36 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    transform: [{ rotate: '-8deg' }],
  },
  logoGlyph: { color: colors.text, fontWeight: '900', fontSize: 19 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  hero: { marginTop: 44, marginBottom: 30 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  eyebrowText: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: {
    color: colors.text,
    fontSize: 42,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: -1.8,
  },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 24, marginTop: 16 },
  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 18,
  },
  step: { color: colors.primaryBright, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 7, marginBottom: 9 },
  input: {
    minHeight: 54,
    borderRadius: radii.medium,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 18 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: 12 },
  connectButton: {
    height: 58,
    borderRadius: radii.medium,
    backgroundColor: colors.primary,
    marginTop: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  buttonDisabled: { opacity: 0.55 },
  connectText: { color: colors.text, fontSize: 16, fontWeight: '800' },
  arrow: { color: colors.text, fontSize: 24, fontWeight: '400' },
  securityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 14 },
  lock: { color: colors.accent, fontSize: 10, marginTop: 3 },
  securityText: { color: colors.textMuted, flex: 1, fontSize: 12, lineHeight: 17 },
  featureRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  feature: {
    flex: 1,
    minHeight: 112,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    padding: 12,
  },
  featureGlyph: { color: colors.primaryBright, fontSize: 21, marginBottom: 9 },
  featureTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  featureBody: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 4 },
});
