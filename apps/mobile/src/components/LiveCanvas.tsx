import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, radii } from '../theme';
import type { DesktopMeta, InputCommand } from '../types';

interface Props {
  frameUri: string | null;
  meta: DesktopMeta | null;
  interactive: boolean;
  hostOnline: boolean;
  onInput: (command: InputCommand) => void;
  fill?: boolean;
  resizeMode?: 'contain' | 'cover';
}

interface Size {
  width: number;
  height: number;
}

export function LiveCanvas({
  frameUri,
  meta,
  interactive,
  hostOnline,
  onInput,
  fill = false,
  resizeMode = 'contain',
}: Props) {
  const window = useWindowDimensions();
  const [layout, setLayout] = useState<Size>({ width: 1, height: 1 });
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const lastMoveAt = useRef(0);
  const aspect = meta ? meta.streamWidth / meta.streamHeight : 16 / 9;
  const canvasHeight = Math.min(300, Math.max(150, (window.width - 32) / aspect));

  const mapPoint = (locationX: number, locationY: number) => {
    const sourceAspect = meta ? meta.streamWidth / meta.streamHeight : 16 / 9;
    const boxAspect = layout.width / layout.height;
    let imageWidth = layout.width;
    let imageHeight = layout.height;
    let offsetX = 0;
    let offsetY = 0;

    if (resizeMode === 'cover') {
      if (sourceAspect > boxAspect) {
        imageWidth = layout.height * sourceAspect;
        offsetX = (layout.width - imageWidth) / 2;
      } else {
        imageHeight = layout.width / sourceAspect;
        offsetY = (layout.height - imageHeight) / 2;
      }
    } else if (sourceAspect > boxAspect) {
      imageHeight = layout.width / sourceAspect;
      offsetY = (layout.height - imageHeight) / 2;
    } else {
      imageWidth = layout.height * sourceAspect;
      offsetX = (layout.width - imageWidth) / 2;
    }

    const x = (locationX - offsetX) / imageWidth;
    const y = (locationY - offsetY) / imageHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: () => interactive,
        onPanResponderGrant: (event) => {
          const point = mapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (!point) return;
          lastPoint.current = point;
          onInput({ kind: 'pointerDown', ...point });
        },
        onPanResponderMove: (event) => {
          const now = Date.now();
          if (now - lastMoveAt.current < 32) return;
          const point = mapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (!point) return;
          lastMoveAt.current = now;
          lastPoint.current = point;
          onInput({ kind: 'pointerMove', ...point });
        },
        onPanResponderRelease: (event) => {
          const point =
            mapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY) ??
            lastPoint.current;
          if (point) onInput({ kind: 'pointerUp', ...point });
          lastPoint.current = null;
        },
        onPanResponderTerminate: () => {
          if (lastPoint.current) onInput({ kind: 'pointerUp', ...lastPoint.current });
          lastPoint.current = null;
        },
      }),
    [interactive, layout.height, layout.width, meta, onInput, resizeMode],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    setLayout({
      width: Math.max(1, event.nativeEvent.layout.width),
      height: Math.max(1, event.nativeEvent.layout.height),
    });
  };

  return (
    <View
      style={[styles.canvas, fill ? styles.fillCanvas : { height: canvasHeight }]}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      {frameUri ? (
        <Image source={{ uri: frameUri }} style={styles.image} resizeMode={resizeMode} />
      ) : (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.primaryBright} />
          <Text style={styles.waitingTitle}>
            {hostOnline ? 'Waiting for the first frame' : 'Waiting for your desktop'}
          </Text>
          <Text style={styles.waitingBody}>Keep PocketDesk Host running on the PC.</Text>
        </View>
      )}

      <View style={styles.liveBadge}>
        <View style={[styles.dot, !hostOnline && styles.dotOffline]} />
        <Text style={styles.liveText}>{hostOnline ? 'LIVE' : 'OFFLINE'}</Text>
      </View>

      {interactive && frameUri ? (
        <View pointerEvents="none" style={styles.hint}>
          <Text style={styles.hintText}>Touch = mouse · drag = drag</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    marginHorizontal: 16,
    backgroundColor: colors.black,
    borderRadius: radii.large,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fillCanvas: {
    flex: 1,
    marginHorizontal: 0,
    borderRadius: 0,
    borderWidth: 0,
  },
  image: { width: '100%', height: '100%' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  waitingTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 12 },
  waitingBody: { color: colors.textMuted, fontSize: 12, marginTop: 5, textAlign: 'center' },
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(2,4,10,0.76)',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.danger },
  liveText: { color: colors.text, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  hint: {
    position: 'absolute',
    bottom: 9,
    alignSelf: 'center',
    backgroundColor: 'rgba(2,4,10,0.78)',
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  hintText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
});
