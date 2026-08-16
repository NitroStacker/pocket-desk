import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  iconKey: string;
  icons: Record<string, string>;
  size?: number;
  radius?: number;
  active?: boolean;
}

export function RemoteIcon({ iconKey, icons, size = 48, radius = 14, active = false }: Props) {
  const uri = icons[iconKey];
  if (uri) {
    return <Image source={{ uri }} resizeMode="contain" style={{ width: size, height: size, borderRadius: radius }} />;
  }

  return (
    <View style={[styles.placeholder, active && styles.placeholderActive, { width: size, height: size, borderRadius: radius }]}>
      <View style={styles.windowMark}>
        <View style={styles.pane} />
        <View style={styles.pane} />
        <View style={styles.pane} />
        <View style={styles.pane} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center' },
  placeholderActive: { backgroundColor: colors.surfaceRaised },
  windowMark: { width: 20, height: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  pane: { width: 9, height: 9, borderRadius: 2, backgroundColor: colors.textMuted },
});
