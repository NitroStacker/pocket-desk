import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeTouchEvent,
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

interface Size { width: number; height: number }
interface Point { x: number; y: number }
interface Viewport { scale: number; x: number; y: number }
interface PinchGesture {
  startDistance: number;
  contentX: number;
  contentY: number;
  startScale: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

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
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const viewportRef = useRef(viewport);
  const singleTouch = useRef<{ raw: Point; remote: Point } | null>(null);
  const remoteDragging = useRef(false);
  const pinch = useRef<PinchGesture | null>(null);
  const suppressSingleTouch = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const lastMoveAt = useRef(0);
  const aspect = meta ? meta.streamWidth / meta.streamHeight : 16 / 9;
  const canvasHeight = Math.min(300, Math.max(150, (window.width - 32) / aspect));

  useEffect(() => {
    updateViewport({ scale: 1, x: 0, y: 0 });
  }, [meta?.streamHeight, meta?.streamWidth, resizeMode]);

  const updateViewport = (next: Viewport) => {
    const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
    const maxX = layout.width * (scale - 1) / 2;
    const maxY = layout.height * (scale - 1) / 2;
    const bounded = {
      scale,
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
    viewportRef.current = bounded;
    setViewport(bounded);
  };

  const mapPoint = (locationX: number, locationY: number) => {
    const currentViewport = viewportRef.current;
    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    const untransformedX = centerX +
      (locationX - centerX - currentViewport.x) / currentViewport.scale;
    const untransformedY = centerY +
      (locationY - centerY - currentViewport.y) / currentViewport.scale;
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

    const x = (untransformedX - offsetX) / imageWidth;
    const y = (untransformedY - offsetY) / imageHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };

  const cancelRemoteDrag = () => {
    if (remoteDragging.current && lastPoint.current) {
      onInput({ kind: 'pointerUp', ...lastPoint.current });
    }
    remoteDragging.current = false;
    lastPoint.current = null;
    singleTouch.current = null;
  };

  const beginPinch = (touches: readonly NativeTouchEvent[]) => {
    if (touches.length < 2) return;
    cancelRemoteDrag();
    suppressSingleTouch.current = true;
    const centroid = touchCentroid(touches[0], touches[1]);
    const current = viewportRef.current;
    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    pinch.current = {
      startDistance: touchDistance(touches[0], touches[1]),
      startScale: current.scale,
      contentX: centerX + (centroid.x - centerX - current.x) / current.scale,
      contentY: centerY + (centroid.y - centerY - current.y) / current.scale,
    };
  };

  const updatePinch = (touches: readonly NativeTouchEvent[]) => {
    if (touches.length < 2) return;
    if (!pinch.current) beginPinch(touches);
    const gesture = pinch.current;
    if (!gesture || gesture.startDistance <= 0) return;
    const centroid = touchCentroid(touches[0], touches[1]);
    const scale = clamp(
      gesture.startScale * touchDistance(touches[0], touches[1]) / gesture.startDistance,
      MIN_SCALE,
      MAX_SCALE,
    );
    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    updateViewport({
      scale,
      x: centroid.x - centerX - scale * (gesture.contentX - centerX),
      y: centroid.y - centerY - scale * (gesture.contentY - centerY),
    });
  };

  const responder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => interactive,
      onMoveShouldSetPanResponder: () => interactive,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches;
        suppressSingleTouch.current = false;
        pinch.current = null;
        if (touches.length >= 2) {
          beginPinch(touches);
          return;
        }
        const remote = mapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
        if (!remote) return;
        singleTouch.current = {
          raw: { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
          remote,
        };
        lastPoint.current = remote;
      },
      onPanResponderStart: (event) => {
        if (event.nativeEvent.touches.length >= 2) beginPinch(event.nativeEvent.touches);
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          updatePinch(touches);
          return;
        }
        if (suppressSingleTouch.current || !singleTouch.current) return;
        const raw = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        const point = mapPoint(raw.x, raw.y);
        if (!point) return;
        const travel = Math.hypot(
          raw.x - singleTouch.current.raw.x,
          raw.y - singleTouch.current.raw.y,
        );
        if (!remoteDragging.current && travel >= 4) {
          remoteDragging.current = true;
          onInput({ kind: 'pointerDown', ...singleTouch.current.remote });
        }
        if (!remoteDragging.current) return;
        const now = Date.now();
        if (now - lastMoveAt.current < 24) return;
        lastMoveAt.current = now;
        lastPoint.current = point;
        onInput({ kind: 'pointerMove', ...point });
      },
      onPanResponderRelease: (event) => {
        if (!suppressSingleTouch.current && singleTouch.current) {
          const point = mapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)
            ?? lastPoint.current
            ?? singleTouch.current.remote;
          if (remoteDragging.current) onInput({ kind: 'pointerUp', ...point });
          else onInput({ kind: 'tap', ...point });
        }
        remoteDragging.current = false;
        singleTouch.current = null;
        lastPoint.current = null;
        pinch.current = null;
        suppressSingleTouch.current = false;
      },
      onPanResponderTerminate: () => {
        cancelRemoteDrag();
        pinch.current = null;
        suppressSingleTouch.current = false;
      },
    }),
    [interactive, layout.height, layout.width, meta, onInput, resizeMode],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const nextLayout = {
      width: Math.max(1, event.nativeEvent.layout.width),
      height: Math.max(1, event.nativeEvent.layout.height),
    };
    setLayout(nextLayout);
    viewportRef.current = { scale: 1, x: 0, y: 0 };
    setViewport(viewportRef.current);
  };

  return (
    <View
      style={[styles.canvas, fill ? styles.fillCanvas : { height: canvasHeight }]}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      {frameUri ? (
        <View style={[styles.imageTranslation, { transform: [{ translateX: viewport.x }, { translateY: viewport.y }] }]}>
          <Image
            source={{ uri: frameUri }}
            style={[styles.image, { transform: [{ scale: viewport.scale }] }]}
            resizeMode={resizeMode}
          />
        </View>
      ) : (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.primaryBright} />
          <Text style={styles.waitingTitle}>
            {hostOnline ? 'Waiting for the first frame' : 'Waiting for your desktop'}
          </Text>
          <Text style={styles.waitingBody}>PocketDesk will reconnect when the PC is available.</Text>
        </View>
      )}

      <View style={styles.liveBadge} pointerEvents="none">
        <View style={[styles.dot, !hostOnline && styles.dotOffline]} />
        <Text style={styles.liveText}>{hostOnline ? 'LIVE' : 'OFFLINE'}</Text>
      </View>

      {interactive && frameUri ? (
        <>
          <Pressable
            style={styles.zoomBadge}
            onPress={() => updateViewport({ scale: 1, x: 0, y: 0 })}
            accessibilityLabel="Reset desktop zoom"
          >
            <Text style={styles.zoomText}>{Math.round(viewport.scale * 100)}%</Text>
          </Pressable>
          <View pointerEvents="none" style={styles.hint}>
            <Text style={styles.hintText}>1 finger controls · 2 fingers pan · pinch to zoom</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function touchCentroid(first: NativeTouchEvent, second: NativeTouchEvent): Point {
  return { x: (first.locationX + second.locationX) / 2, y: (first.locationY + second.locationY) / 2 };
}

function touchDistance(first: NativeTouchEvent, second: NativeTouchEvent): number {
  return Math.hypot(first.locationX - second.locationX, first.locationY - second.locationY);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  canvas: { marginHorizontal: 16, backgroundColor: colors.black, borderRadius: radii.large, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  fillCanvas: { flex: 1, marginHorizontal: 0, borderRadius: 0, borderWidth: 0 },
  imageTranslation: { ...StyleSheet.absoluteFillObject },
  image: { width: '100%', height: '100%' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  waitingTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 12 },
  waitingBody: { color: colors.textMuted, fontSize: 12, marginTop: 5, textAlign: 'center' },
  liveBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.pill, backgroundColor: 'rgba(2,4,10,0.76)', paddingHorizontal: 9, paddingVertical: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.danger },
  liveText: { color: colors.text, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  zoomBadge: { position: 'absolute', top: 9, right: 9, minWidth: 48, alignItems: 'center', borderRadius: radii.pill, backgroundColor: 'rgba(2,4,10,0.78)', paddingHorizontal: 10, paddingVertical: 7 },
  zoomText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  hint: { position: 'absolute', bottom: 9, alignSelf: 'center', backgroundColor: 'rgba(2,4,10,0.78)', borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 6 },
  hintText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
});
