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
type ControlMode = 'trackpad' | 'touch';

interface SingleGesture {
  kind: 'single';
  mode: ControlMode;
  start: Point;
  last: Point;
  remoteStart: Point | null;
  lastRemote: Point | null;
  moved: boolean;
  dragCandidate: boolean;
  buttonDown: boolean;
  pendingDx: number;
  pendingDy: number;
  lastMoveAt: number;
}

interface TwoFingerGesture {
  kind: 'two';
  mode: ControlMode;
  intent: 'pending' | 'scroll' | 'pan' | 'pinch';
  startedAt: number;
  startDistance: number;
  startCentroid: Point;
  lastCentroid: Point;
  startViewport: Viewport;
  contentX: number;
  contentY: number;
  smoothedScale: number;
  maximumCentroidTravel: number;
  maximumDistanceTravel: number;
  maximumTouches: number;
  pendingScroll: number;
  lastScrollAt: number;
  remoteCentroid: Point | null;
}

type DesktopGesture = SingleGesture | TwoFingerGesture;

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SINGLE_MOVE_THRESHOLD = 5;
const TWO_FINGER_LOCK_THRESHOLD = 10;
const DOUBLE_TAP_DELAY = 320;
const DOUBLE_TAP_DISTANCE = 32;
const MOVE_INTERVAL = 18;
const SCROLL_INTERVAL = 24;
const SCROLL_MULTIPLIER = 10;

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
  const [controlMode, setControlMode] = useState<ControlMode>('trackpad');
  const viewportRef = useRef(viewport);
  const gesture = useRef<DesktopGesture | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
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

  const flushTrackpadMove = (session: SingleGesture, force = false) => {
    if (session.mode !== 'trackpad') return;
    const now = Date.now();
    if (!force && now - session.lastMoveAt < MOVE_INTERVAL) return;
    if (Math.abs(session.pendingDx) + Math.abs(session.pendingDy) < 0.1) return;
    onInput({ kind: 'moveRelative', dx: session.pendingDx, dy: session.pendingDy });
    session.pendingDx = 0;
    session.pendingDy = 0;
    session.lastMoveAt = now;
  };

  const releaseSingleButton = (session: SingleGesture) => {
    if (!session.buttonDown) return;
    if (session.mode === 'trackpad') {
      onInput({ kind: 'leftUp' });
    } else {
      const releasePoint = session.lastRemote ?? session.remoteStart;
      if (releasePoint) onInput({ kind: 'pointerUp', ...releasePoint });
    }
    session.buttonDown = false;
  };

  const flushScroll = (session: TwoFingerGesture, force = false) => {
    const now = Date.now();
    if (!force && now - session.lastScrollAt < SCROLL_INTERVAL) return;
    const delta = Math.round(session.pendingScroll);
    if (Math.abs(delta) < 1) return;
    onInput({ kind: 'scroll', delta });
    session.pendingScroll = 0;
    session.lastScrollAt = now;
  };

  const finishGesture = (commitTap: boolean) => {
    const session = gesture.current;
    if (!session) return;

    if (session.kind === 'single') {
      flushTrackpadMove(session, true);
      if (session.buttonDown) {
        releaseSingleButton(session);
        lastTap.current = null;
      } else if (commitTap && !session.moved) {
        if (session.mode === 'trackpad') {
          onInput({ kind: 'leftClick' });
          lastTap.current = session.dragCandidate
            ? null
            : { at: Date.now(), point: session.start };
        } else if (session.remoteStart) {
          onInput({ kind: 'tap', ...session.remoteStart });
        }
      } else if (session.dragCandidate) {
        lastTap.current = null;
      }
    } else {
      if (session.intent === 'scroll') flushScroll(session, true);
      const twoFingerTap = commitTap &&
        session.intent === 'pending' &&
        session.maximumTouches === 2 &&
        Date.now() - session.startedAt <= 360 &&
        session.maximumCentroidTravel < TWO_FINGER_LOCK_THRESHOLD &&
        session.maximumDistanceTravel < TWO_FINGER_LOCK_THRESHOLD;
      if (twoFingerTap) {
        if (controlMode === 'touch' && session.remoteCentroid) {
          onInput({ kind: 'pointerMove', ...session.remoteCentroid });
        }
        onInput({ kind: 'rightClick' });
      }
      if (session.intent === 'pinch' && viewportRef.current.scale < 1.025) {
        updateViewport({ scale: 1, x: 0, y: 0 });
      }
    }

    gesture.current = null;
  };

  const beginSingle = (point: Point) => {
    const previousTap = lastTap.current;
    const dragCandidate = controlMode === 'trackpad' && !!previousTap &&
      Date.now() - previousTap.at <= DOUBLE_TAP_DELAY &&
      pointDistance(previousTap.point, point) <= DOUBLE_TAP_DISTANCE;
    gesture.current = {
      kind: 'single',
      mode: controlMode,
      start: point,
      last: point,
      remoteStart: controlMode === 'touch' ? mapPoint(point.x, point.y) : null,
      lastRemote: null,
      moved: false,
      dragCandidate,
      buttonDown: false,
      pendingDx: 0,
      pendingDy: 0,
      lastMoveAt: 0,
    };
  };

  const beginTwoFinger = (touches: readonly NativeTouchEvent[]) => {
    const existing = gesture.current;
    if (existing?.kind === 'single') {
      flushTrackpadMove(existing, true);
      releaseSingleButton(existing);
    }
    lastTap.current = null;
    const points = trackedTouches(touches);
    if (points.length < 2) return;
    const centroid = pointCentroid(points[0], points[1]);
    const current = viewportRef.current;
    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    gesture.current = {
      kind: 'two',
      mode: controlMode,
      intent: 'pending',
      startedAt: Date.now(),
      startDistance: Math.max(1, pointDistance(points[0], points[1])),
      startCentroid: centroid,
      lastCentroid: centroid,
      startViewport: current,
      contentX: centerX + (centroid.x - centerX - current.x) / current.scale,
      contentY: centerY + (centroid.y - centerY - current.y) / current.scale,
      smoothedScale: current.scale,
      maximumCentroidTravel: 0,
      maximumDistanceTravel: 0,
      maximumTouches: touches.length,
      pendingScroll: 0,
      lastScrollAt: 0,
      remoteCentroid: mapPoint(centroid.x, centroid.y),
    };
  };

  const updateSingle = (point: Point) => {
    const session = gesture.current;
    if (!session || session.kind !== 'single') return;
    const dx = point.x - session.last.x;
    const dy = point.y - session.last.y;
    session.last = point;
    const travel = pointDistance(session.start, point);
    if (!session.moved && travel < SINGLE_MOVE_THRESHOLD) return;
    session.moved = true;
    if (!session.dragCandidate) lastTap.current = null;

    if (session.mode === 'trackpad') {
      if (session.dragCandidate && !session.buttonDown) {
        onInput({ kind: 'leftDown' });
        session.buttonDown = true;
      }
      session.pendingDx += dx;
      session.pendingDy += dy;
      flushTrackpadMove(session);
      return;
    }

    const remote = mapPoint(point.x, point.y);
    if (!remote || !session.remoteStart) return;
    if (!session.buttonDown) {
      onInput({ kind: 'pointerDown', ...session.remoteStart });
      session.buttonDown = true;
    }
    const now = Date.now();
    if (now - session.lastMoveAt < MOVE_INTERVAL) return;
    session.lastMoveAt = now;
    session.lastRemote = remote;
    onInput({ kind: 'pointerMove', ...remote });
  };

  const updateTwoFinger = (touches: readonly NativeTouchEvent[]) => {
    const session = gesture.current;
    if (!session || session.kind !== 'two') return;
    const points = trackedTouches(touches);
    if (points.length < 2) return;
    session.maximumTouches = Math.max(session.maximumTouches, touches.length);
    const centroid = pointCentroid(points[0], points[1]);
    const distance = pointDistance(points[0], points[1]);
    const centroidTravel = pointDistance(session.startCentroid, centroid);
    const distanceTravel = Math.abs(distance - session.startDistance);
    session.maximumCentroidTravel = Math.max(session.maximumCentroidTravel, centroidTravel);
    session.maximumDistanceTravel = Math.max(session.maximumDistanceTravel, distanceTravel);

    if (session.intent === 'pending') {
      const clearPinch = distanceTravel >= TWO_FINGER_LOCK_THRESHOLD &&
        distanceTravel > centroidTravel * 1.15;
      const clearTranslation = centroidTravel >= TWO_FINGER_LOCK_THRESHOLD &&
        centroidTravel >= distanceTravel;
      if (clearPinch) session.intent = 'pinch';
      else if (clearTranslation) session.intent = session.mode === 'touch' ? 'pan' : 'scroll';
      else return;
    }

    if (session.intent === 'scroll') {
      session.pendingScroll += (centroid.y - session.lastCentroid.y) * SCROLL_MULTIPLIER;
      session.lastCentroid = centroid;
      flushScroll(session);
      return;
    }

    if (session.intent === 'pan') {
      updateViewport({
        scale: session.startViewport.scale,
        x: session.startViewport.x + centroid.x - session.startCentroid.x,
        y: session.startViewport.y + centroid.y - session.startCentroid.y,
      });
      return;
    }

    const targetScale = clamp(
      session.startViewport.scale * distance / session.startDistance,
      MIN_SCALE,
      MAX_SCALE,
    );
    session.smoothedScale += (targetScale - session.smoothedScale) * 0.55;
    const centerX = layout.width / 2;
    const centerY = layout.height / 2;
    updateViewport({
      scale: session.smoothedScale,
      x: session.startCentroid.x - centerX - session.smoothedScale * (session.contentX - centerX),
      y: session.startCentroid.y - centerY - session.smoothedScale * (session.contentY - centerY),
    });
  };

  const responder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => interactive,
      onMoveShouldSetPanResponder: () => interactive,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          beginTwoFinger(touches);
          return;
        }
        beginSingle({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
      },
      onPanResponderStart: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2 && gesture.current?.kind !== 'two') beginTwoFinger(touches);
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          if (gesture.current?.kind !== 'two') beginTwoFinger(touches);
          updateTwoFinger(touches);
          return;
        }
        if (gesture.current?.kind === 'two') return;
        updateSingle({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
      },
      onPanResponderRelease: () => finishGesture(true),
      onPanResponderTerminate: () => finishGesture(false),
    }),
    [controlMode, interactive, layout.height, layout.width, meta, onInput, resizeMode],
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

  const changeControlMode = (next: ControlMode) => {
    if (next === controlMode) return;
    finishGesture(false);
    lastTap.current = null;
    setControlMode(next);
  };

  const resetZoom = () => {
    finishGesture(false);
    updateViewport({ scale: 1, x: 0, y: 0 });
  };

  return (
    <View
      style={[styles.canvas, fill ? styles.fillCanvas : { height: canvasHeight }]}
      onLayout={onLayout}
    >
      <View style={styles.gestureSurface} {...responder.panHandlers}>
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
      </View>

      <View style={styles.liveBadge} pointerEvents="none">
        <View style={[styles.dot, !hostOnline && styles.dotOffline]} />
        <Text style={styles.liveText}>{hostOnline ? 'LIVE' : 'OFFLINE'}</Text>
      </View>

      {interactive && frameUri ? (
        <>
          <View style={styles.modeSwitcher} accessibilityRole="radiogroup">
            <ModeButton label="Trackpad" active={controlMode === 'trackpad'} onPress={() => changeControlMode('trackpad')} />
            <ModeButton label="Touch" active={controlMode === 'touch'} onPress={() => changeControlMode('touch')} />
          </View>
          <Pressable
            style={styles.zoomBadge}
            onPress={resetZoom}
            accessibilityLabel="Reset desktop zoom"
          >
            <Text style={styles.zoomText}>{Math.round(viewport.scale * 100)}%</Text>
          </Pressable>
          <View pointerEvents="none" style={styles.hint}>
            <Text style={styles.hintText}>
              {controlMode === 'trackpad'
                ? 'Swipe to move · tap to click · two fingers scroll or right-click · pinch to zoom'
                : 'Tap directly · drag to drag · two fingers pan or right-click · pinch to zoom'}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function trackedTouches(touches: readonly NativeTouchEvent[]): Point[] {
  return [...touches].map((touch) => ({
    x: touch.locationX,
    y: touch.locationY,
  }));
}

function pointCentroid(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function pointDistance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  canvas: { marginHorizontal: 16, backgroundColor: colors.black, borderRadius: radii.large, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  fillCanvas: { flex: 1, marginHorizontal: 0, borderRadius: 0, borderWidth: 0 },
  gestureSurface: { ...StyleSheet.absoluteFillObject },
  imageTranslation: { ...StyleSheet.absoluteFillObject },
  image: { width: '100%', height: '100%' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  waitingTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 12 },
  waitingBody: { color: colors.textMuted, fontSize: 12, marginTop: 5, textAlign: 'center' },
  liveBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.pill, backgroundColor: 'rgba(2,4,10,0.82)', paddingHorizontal: 9, paddingVertical: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.danger },
  liveText: { color: colors.text, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  modeSwitcher: { position: 'absolute', top: 8, alignSelf: 'center', height: 32, flexDirection: 'row', borderRadius: radii.pill, backgroundColor: 'rgba(2,4,10,0.86)', borderWidth: 1, borderColor: colors.border, padding: 3 },
  modeButton: { minWidth: 57, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  modeButtonActive: { backgroundColor: colors.primary },
  modeButtonText: { color: colors.textMuted, fontSize: 8, fontWeight: '800' },
  modeButtonTextActive: { color: colors.inverseText },
  zoomBadge: { position: 'absolute', top: 9, right: 9, minWidth: 48, alignItems: 'center', borderRadius: radii.pill, backgroundColor: 'rgba(2,4,10,0.82)', paddingHorizontal: 10, paddingVertical: 7 },
  zoomText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  hint: { position: 'absolute', bottom: 9, left: 12, right: 12, alignItems: 'center' },
  hintText: { maxWidth: '96%', color: colors.textMuted, fontSize: 9, lineHeight: 13, fontWeight: '600', textAlign: 'center', backgroundColor: 'rgba(2,4,10,0.82)', borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 6 },
});
