import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OpenAppGroup } from '../lib/windowApp';
import { colors, radii } from '../theme';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  group: OpenAppGroup | null;
  icons: Record<string, string>;
  closingWindowHandles: number[];
  onDismiss: () => void;
  onOpenWindow: (processId: number, windowHandle: number) => void;
  onCloseWindow: (processId: number, windowHandle: number) => void;
}

export function AppWindowsModal({ group, icons, closingWindowHandles, onDismiss, onOpenWindow, onCloseWindow }: Props) {
  const insets = useSafeAreaInsets();
  if (!group) return null;
  const topInset = Math.max(insets.top, initialWindowMetrics?.insets.top ?? 0, Platform.OS === 'ios' ? 54 : 0);
  const bottomInset = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0, Platform.OS === 'ios' ? 12 : 0);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onDismiss}>
      <View style={[styles.safeArea, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <View style={styles.header}>
          <RemoteIcon iconKey={group.iconKey} icons={icons} size={42} radius={12} active={group.windows.some((window) => window.active)} />
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>OPEN WINDOWS</Text>
            <Text style={styles.title} numberOfLines={1}>{group.name}</Text>
          </View>
          <Pressable onPress={onDismiss} style={styles.doneButton} accessibilityLabel="Close window chooser">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.introTitle}>Choose a window</Text>
          <Text style={styles.introBody}>{group.windows.length} {group.windows.length === 1 ? 'window is' : 'windows are'} open on your PC.</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {group.windows.map((window, index) => {
            const title = window.title.trim() || `${group.name} window ${index + 1}`;
            const closing = closingWindowHandles.includes(window.windowHandle);
            return (
              <View key={window.windowHandle} style={[styles.windowCard, window.active && styles.windowCardActive]}>
                <Pressable
                  onPress={() => onOpenWindow(window.processId, window.windowHandle)}
                  disabled={closing}
                  style={({ pressed }) => [styles.windowOpen, closing && styles.disabled, pressed && styles.pressed]}
                  accessibilityLabel={`Open ${title}`}
                >
                  <View style={[styles.windowNumber, window.active && styles.windowNumberActive]}>
                    <Text style={[styles.windowNumberText, window.active && styles.windowNumberTextActive]}>{index + 1}</Text>
                  </View>
                  <View style={styles.windowCopy}>
                    <Text style={styles.windowTitle} numberOfLines={2}>{title}</Text>
                    <Text style={styles.windowDetail} numberOfLines={1}>{window.active ? 'Active now' : window.process}</Text>
                  </View>
                  <Text style={styles.openAction}>Open</Text>
                </Pressable>
                <Pressable
                  onPress={() => onCloseWindow(window.processId, window.windowHandle)}
                  disabled={closing}
                  style={({ pressed }) => [styles.closeButton, closing && styles.disabled, pressed && styles.closeButtonPressed]}
                  accessibilityLabel={`Close ${title}`}
                >
                  {closing ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.closeGlyph}>×</Text>}
                  <Text style={styles.closeLabel}>{closing ? 'Closing…' : 'Close'}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Close asks Windows to close the selected window normally. Apps can still prompt you to save unsaved work.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 72, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { flex: 1, marginLeft: 11 },
  eyebrow: { color: colors.textDim, fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  doneButton: { height: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  intro: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 13 },
  introTitle: { color: colors.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.7 },
  introBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  windowCard: { minHeight: 82, borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'stretch', marginBottom: 9, overflow: 'hidden' },
  windowCardActive: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceSoft },
  windowOpen: { flex: 1, minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingVertical: 9 },
  windowNumber: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  windowNumberActive: { backgroundColor: colors.primary },
  windowNumberText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  windowNumberTextActive: { color: colors.inverseText },
  windowCopy: { flex: 1, marginHorizontal: 10 },
  windowTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  windowDetail: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  openAction: { color: colors.text, fontSize: 9, fontWeight: '800', marginRight: 11 },
  closeButton: { width: 58, borderLeftWidth: 1, borderLeftColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  closeButtonPressed: { opacity: 0.65 },
  disabled: { opacity: 0.48 },
  closeGlyph: { color: colors.danger, fontSize: 21, lineHeight: 23 },
  closeLabel: { color: colors.danger, fontSize: 8, fontWeight: '700', marginTop: 1 },
  footer: { minHeight: 66, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 18, justifyContent: 'center' },
  footerText: { color: colors.textDim, fontSize: 9, lineHeight: 14, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
