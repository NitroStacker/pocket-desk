import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii } from '../theme';
import type { InputCommand, SemanticControl, SemanticSnapshot } from '../types';

interface Props {
  snapshot: SemanticSnapshot;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

interface ZoneDefinition {
  name: string;
  shortName: string;
  detail: string;
  ledLabel: string;
}

const EFFECTS = ['Static', 'Breathe', 'Pulse', 'Spectrum'] as const;
const ZONES: ZoneDefinition[] = [
  { name: 'Internal chassis', shortName: 'Chassis', detail: 'Inside-case illumination', ledLabel: 'LED 73' },
  { name: 'Fan / liquid cooler', shortName: 'Fan / pump', detail: 'Internal fan or pump', ledLabel: 'LED 74' },
  { name: 'Alienware wordmark', shortName: 'Wordmark', detail: 'Side or front wordmark', ledLabel: 'LED 72' },
  { name: 'Power button', shortName: 'Power', detail: 'Alien-head power light', ledLabel: 'LEDs 29 + 35' },
  { name: 'Bezel inner ring', shortName: 'Inner ring', detail: 'Inner stadium segments', ledLabel: 'Inner ring' },
  { name: 'Bezel outer ring', shortName: 'Outer ring', detail: 'Outer stadium segments', ledLabel: 'Outer ring' },
  { name: 'Every mapped LED', shortName: 'Whole system', detail: 'Every mapped controller light', ledLabel: 'LEDs 0–74' },
];
const PRESET_COLORS = ['#51E5FF', '#7C5CFF', '#E54CFF', '#FF4D7D', '#FF6B35', '#FFD84D', '#53E37C', '#F5F5F2'];

export function AuroraFxApplication({ snapshot, onInput, onRefresh }: Props) {
  const controls = useMemo(
    () => snapshot.controls.filter((control) => control.source === 'accessibility'),
    [snapshot.controls],
  );
  const zoneControls = useMemo(() => resolveZoneControls(controls), [controls]);
  const colorControl = findControl(controls, 'Edit', /^(lighting color|colorhexbox)$/i);
  const effectControl = findControl(controls, 'ComboBox', /^(lighting effect|effectcombobox)$/i);
  const brightnessControl = findControl(controls, 'Slider', /^(brightness|brightnessslider)$/i);
  const speedControl = findControl(controls, 'Slider', /^(effect speed|speedslider)$/i);
  const applyControl = findControl(controls, 'Button', /^apply lighting$/i);
  const offControl = findControl(controls, 'Button', /^turn off$/i);
  const scanControl = findControl(controls, 'Button', /^scan$/i);
  const customToggle = findControl(controls, 'CheckBox', /^use custom led ids$/i);
  const customIdsControl = findControl(controls, 'Edit', /^custom led ids$/i);
  const deviceLabel = controls.find((control) => /AW-ELC connected|not connected|scanning/i.test(control.label))?.label ?? 'Checking controller';
  const status = controls.find((control) => /^(connected to|applied |turned off |lighting command failed|select at least|controller scan failed)/i.test(control.label))?.label
    ?? 'Ready for a lighting command.';
  const initialHsv = useMemo(() => hexToHsv(colorControl?.value || '#51E5FF'), [colorControl?.value]);
  const [hsv, setHsv] = useState<HsvColor>(initialHsv);
  const [effectIndex, setEffectIndex] = useState(() => readEffectIndex(effectControl, speedControl));
  const [brightness, setBrightness] = useState(() => readRange(brightnessControl, 80));
  const [speed, setSpeed] = useState(() => readRange(speedControl, 50));
  const [advancedVisible, setAdvancedVisible] = useState(false);
  const [customEnabled, setCustomEnabled] = useState(customToggle?.checked === true);
  const [customIds, setCustomIds] = useState(customIdsControl?.value || '73, 74');
  const colorHex = hsvToHex(hsv);
  const connected = /connected/i.test(deviceLabel) && !/not connected/i.test(deviceLabel);

  useEffect(() => setHsv(initialHsv), [initialHsv]);
  useEffect(() => setBrightness(readRange(brightnessControl, 80)), [brightnessControl?.value]);
  useEffect(() => setSpeed(readRange(speedControl, 50)), [speedControl?.value]);
  useEffect(() => {
    const next = readEffectIndex(effectControl, speedControl);
    if (next === 0 || effectControl?.description) setEffectIndex(next);
  }, [effectControl?.description, speedControl?.enabled]);
  useEffect(() => {
    if (customIdsControl?.value) setCustomIds(customIdsControl.value);
  }, [customIdsControl?.value]);
  useEffect(() => {
    if (customToggle?.checked !== null && customToggle?.checked !== undefined) setCustomEnabled(customToggle.checked);
  }, [customToggle?.checked]);

  const sendAurora = (command: Extract<InputCommand, { kind: 'aurora' }>, delay = 260) => {
    onInput(command);
    setTimeout(onRefresh, delay);
  };

  const setZone = (index: number) => {
    const entry = zoneControls[index];
    if (!entry?.control) return;
    sendAurora({ kind: 'aurora', action: 'setZone', zone: entry.definition.name, enabled: entry.control.checked !== true });
  };

  const selectEffect = (index: number) => {
    setEffectIndex(index);
    sendAurora({ kind: 'aurora', action: 'setEffect', effect: EFFECTS[index] });
  };

  const syncColor = (after?: () => void) => {
    onInput({ kind: 'aurora', action: 'setColor', color: colorHex });
    if (after) setTimeout(after, 120);
    else setTimeout(onRefresh, 260);
  };

  const applyLighting = () => {
    if (!applyControl?.enabled) return;
    syncColor(() => {
      onInput({ kind: 'aurora', action: 'apply' });
      setTimeout(onRefresh, 850);
    });
  };

  const showAdvanced = () => setAdvancedVisible((current) => !current);

  const updateCustomIds = () => {
    sendAurora({ kind: 'aurora', action: 'setCustomIds', text: customIds });
  };

  return (
    <View style={styles.surface}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>AURORA R15 LIGHTING</Text>
          <Text style={styles.title}>Design your lighting</Text>
          <Text style={styles.subtitle}>Tap a part of the case, choose its look, then apply it to the real AW-ELC controller.</Text>
        </View>
        <Pressable disabled={!scanControl} onPress={() => sendAurora({ kind: 'aurora', action: 'scan' }, 620)} style={[styles.connectionPill, !connected && styles.connectionPillOffline]}>
          <View style={[styles.connectionDot, !connected && styles.connectionDotOffline]} />
          <Text style={styles.connectionText}>{connected ? 'Connected' : 'Scan'}</Text>
        </Pressable>
      </View>

      <Card title="Lighting zones" subtitle="Tap the case drawing or a zone card">
        <TowerDiagram zones={zoneControls} color={colorHex} onToggle={setZone} />
        <View style={styles.zoneGrid}>
          {zoneControls.slice(0, 6).map(({ definition, control }, index) => (
            <ZoneCard key={definition.name} definition={definition} selected={control?.checked === true} color={colorHex} onPress={() => setZone(index)} />
          ))}
        </View>
        <Pressable
          disabled={!zoneControls[6]?.control}
          onPress={() => setZone(6)}
          style={[styles.allZone, zoneControls[6]?.control?.checked && { borderColor: colorHex, backgroundColor: `${colorHex}18` }]}
        >
          <View style={[styles.allZoneMark, zoneControls[6]?.control?.checked && { backgroundColor: colorHex }]} />
          <View style={styles.allZoneCopy}><Text style={styles.allZoneTitle}>Whole system</Text><Text style={styles.allZoneDetail}>Select every mapped LED from 0–74</Text></View>
          <Text style={styles.allZoneCount}>{zoneControls[6]?.control?.checked ? 'ON' : 'ALL'}</Text>
        </Pressable>
      </Card>

      <Card title="Color" subtitle="Drag anywhere in the spectrum">
        <ColorPicker value={hsv} onChange={setHsv} />
        <View style={styles.colorReadout}>
          <View style={[styles.colorPreview, { backgroundColor: colorHex, shadowColor: colorHex }]} />
          <View style={styles.colorCopy}><Text style={styles.colorHex}>{colorHex}</Text><Text style={styles.colorDetail}>Selected lighting color</Text></View>
          <Pressable disabled={!colorControl?.enabled} onPress={() => syncColor()} style={styles.useColorButton}><Text style={styles.useColorText}>Set color</Text></Pressable>
        </View>
        <View style={styles.swatches}>
          {PRESET_COLORS.map((preset) => (
            <Pressable key={preset} accessibilityLabel={`Select ${preset}`} onPress={() => setHsv(hexToHsv(preset))} style={[styles.swatch, { backgroundColor: preset }, preset === colorHex && styles.swatchSelected]} />
          ))}
        </View>
      </Card>

      <Card title="Effect" subtitle="Choose how the selected zones animate">
        <View style={styles.effectGrid}>
          {EFFECTS.map((effect, index) => {
            const selected = effectIndex === index;
            return (
              <Pressable key={effect} onPress={() => selectEffect(index)} style={[styles.effectButton, selected && styles.effectButtonSelected]}>
                <EffectGlyph index={index} selected={selected} color={colorHex} />
                <Text style={[styles.effectText, selected && styles.effectTextSelected]}>{effect}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card title="Intensity" subtitle="Fine-tune brightness and animation speed">
        <AuroraSlider
          label="Brightness"
          value={brightness}
          minimum={0}
          maximum={100}
          suffix="%"
          color={colorHex}
          enabled={brightnessControl?.enabled === true}
          onChange={setBrightness}
          onCommit={(value) => sendAurora({ kind: 'aurora', action: 'setBrightness', value })}
        />
        <AuroraSlider
          label="Effect speed"
          value={speed}
          minimum={1}
          maximum={100}
          color={colorHex}
          enabled={effectIndex !== 0 && speedControl?.enabled === true}
          hint={effectIndex === 0 ? 'Available for animated effects' : undefined}
          onChange={setSpeed}
          onCommit={(value) => sendAurora({ kind: 'aurora', action: 'setSpeed', value })}
        />
      </Card>

      <View style={styles.actionRow}>
        <Pressable disabled={!applyControl?.enabled} onPress={applyLighting} style={[styles.applyButton, !applyControl?.enabled && styles.disabled]}>
          <View style={[styles.applyGlow, { backgroundColor: colorHex }]} />
          <Text style={styles.applyText}>Apply lighting</Text>
        </Pressable>
        <Pressable disabled={!offControl?.enabled} onPress={() => sendAurora({ kind: 'aurora', action: 'off' }, 720)} style={[styles.offButton, !offControl?.enabled && styles.disabled]}>
          <Text style={styles.offGlyph}>○</Text><Text style={styles.offText}>All off</Text>
        </Pressable>
      </View>

      <Pressable onPress={showAdvanced} style={styles.advancedHeader}>
        <View><Text style={styles.advancedTitle}>Advanced LED addressing</Text><Text style={styles.advancedSubtitle}>Use controller IDs for custom hardware variants</Text></View>
        <Text style={styles.advancedChevron}>{advancedVisible ? '⌃' : '⌄'}</Text>
      </Pressable>
      {advancedVisible ? (
        <View style={styles.advancedBody}>
          <View style={styles.customToggleRow}>
            <View style={styles.customToggleCopy}><Text style={styles.customToggleTitle}>Use custom LED IDs</Text><Text style={styles.customToggleDetail}>Overrides the zone selection above</Text></View>
            <Switch
              value={customEnabled}
              onValueChange={(enabled) => { setCustomEnabled(enabled); sendAurora({ kind: 'aurora', action: 'setCustomEnabled', enabled }); }}
              trackColor={{ false: colors.borderStrong, true: colorHex }}
              thumbColor={colors.text}
            />
          </View>
          <View style={styles.customField}>
            <TextInput value={customIds} onChangeText={setCustomIds} onSubmitEditing={updateCustomIds} placeholder="73, 74 or 0-16" placeholderTextColor={colors.textDim} style={styles.customInput} autoCorrect={false} />
            <Pressable onPress={updateCustomIds} style={styles.customUpdate}><Text style={styles.customUpdateText}>Update</Text></Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.statusCard}>
        <View style={[styles.statusLight, { backgroundColor: connected ? colorHex : colors.danger }]} />
        <View style={styles.statusCopy}><Text style={styles.statusTitle}>{deviceLabel}</Text><Text style={styles.statusDetail}>{status}</Text></View>
      </View>
    </View>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}><View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSubtitle}>{subtitle}</Text></View></View>
      {children}
    </View>
  );
}

function ZoneCard({ definition, selected, color, onPress }: { definition: ZoneDefinition; selected: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.zoneCard, selected && { borderColor: color, backgroundColor: `${color}16` }]}>
      <View style={[styles.zoneCheck, selected && { backgroundColor: color, borderColor: color }]}>{selected ? <Text style={styles.zoneCheckText}>✓</Text> : null}</View>
      <Text style={styles.zoneName} numberOfLines={1}>{definition.shortName}</Text>
      <Text style={styles.zoneLed}>{definition.ledLabel}</Text>
    </Pressable>
  );
}

function TowerDiagram({ zones, color, onToggle }: { zones: ReturnType<typeof resolveZoneControls>; color: string; onToggle: (index: number) => void }) {
  const selected = (index: number) => zones[index]?.control?.checked === true || zones[6]?.control?.checked === true;
  const zoneColor = (index: number) => selected(index) ? color : '#30343B';
  return (
    <View style={styles.diagramStage}>
      <View style={styles.diagramGlow} />
      <View style={styles.towerTop} />
      <Pressable accessibilityLabel="Select internal chassis" onPress={() => onToggle(0)} style={[styles.sidePanel, selected(0) && { borderColor: color, backgroundColor: `${color}14` }]}>
        <View style={styles.sidePanelReflection} />
      </Pressable>
      <Pressable accessibilityLabel="Select fan or liquid cooler" onPress={() => onToggle(1)} style={[styles.fan, { borderColor: zoneColor(1), shadowColor: zoneColor(1) }]}>
        <View style={[styles.fanHub, { backgroundColor: zoneColor(1) }]} />
        <View style={styles.fanBladeOne} /><View style={styles.fanBladeTwo} />
      </Pressable>
      <Pressable accessibilityLabel="Select Alienware wordmark" onPress={() => onToggle(2)} style={[styles.wordmarkZone, { backgroundColor: zoneColor(2), shadowColor: zoneColor(2) }]} />
      <View style={styles.frontPanel} />
      <Pressable accessibilityLabel="Select bezel outer ring" onPress={() => onToggle(5)} style={[styles.outerRing, { borderColor: zoneColor(5), shadowColor: zoneColor(5) }]} />
      <Pressable accessibilityLabel="Select bezel inner ring" onPress={() => onToggle(4)} style={[styles.innerRing, { borderColor: zoneColor(4), shadowColor: zoneColor(4) }]} />
      <Pressable accessibilityLabel="Select power button" onPress={() => onToggle(3)} style={[styles.powerZone, { borderColor: zoneColor(3), shadowColor: zoneColor(3) }]}>
        <View style={[styles.powerCore, { backgroundColor: zoneColor(3) }]} />
      </Pressable>
      <View style={styles.towerFootLeft} /><View style={styles.towerFootRight} />
      <View style={styles.diagramCaption}><Text style={styles.diagramCaptionTitle}>AURORA R15</Text><Text style={styles.diagramCaptionDetail}>{zones.filter(({ control }) => control?.checked).length} zones selected</Text></View>
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: HsvColor; onChange: (value: HsvColor) => void }) {
  const [squareSize, setSquareSize] = useState({ width: 1, height: 1 });
  const [hueHeight, setHueHeight] = useState(1);
  const hueColor = hsvToHex({ h: value.h, s: 1, v: 1 });
  const updateSquare = (event: GestureResponderEvent) => {
    onChange({ ...value, s: clamp01(event.nativeEvent.locationX / squareSize.width), v: 1 - clamp01(event.nativeEvent.locationY / squareSize.height) });
  };
  const updateHue = (event: GestureResponderEvent) => {
    onChange({ ...value, h: clamp01(event.nativeEvent.locationY / hueHeight) * 360 });
  };
  return (
    <View style={styles.pickerRow}>
      <View
        style={styles.saturationSquare}
        onLayout={(event: LayoutChangeEvent) => setSquareSize(event.nativeEvent.layout)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={updateSquare}
        onResponderMove={updateSquare}
      >
        <LinearGradient colors={['#FFFFFF', hueColor] as const} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0)', '#000000'] as const} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[styles.pickerThumb, { left: clamp(value.s * squareSize.width - 9, 0, squareSize.width - 18), top: clamp((1 - value.v) * squareSize.height - 9, 0, squareSize.height - 18), backgroundColor: hsvToHex(value) }]} />
      </View>
      <View
        style={styles.hueRail}
        onLayout={(event: LayoutChangeEvent) => setHueHeight(event.nativeEvent.layout.height)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={updateHue}
        onResponderMove={updateHue}
      >
        <LinearGradient colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'] as const} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[styles.hueThumb, { top: clamp((value.h / 360) * hueHeight - 4, 0, hueHeight - 8) }]} />
      </View>
    </View>
  );
}

function EffectGlyph({ index, selected, color }: { index: number; selected: boolean; color: string }) {
  const active = selected ? color : colors.textDim;
  if (index === 0) return <View style={[styles.effectStatic, { backgroundColor: active }]} />;
  if (index === 1) return <View style={[styles.effectBreatheOuter, { borderColor: active }]}><View style={[styles.effectBreatheInner, { backgroundColor: active }]} /></View>;
  if (index === 2) return <View style={styles.effectPulse}><View style={[styles.effectPulseBar, { backgroundColor: active }]} /><View style={[styles.effectPulseBarTall, { backgroundColor: active }]} /><View style={[styles.effectPulseBar, { backgroundColor: active }]} /></View>;
  return <LinearGradient colors={['#51E5FF', '#E54CFF', '#FFD84D'] as const} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.effectSpectrum} />;
}

function AuroraSlider({ label, value, minimum, maximum, suffix = '', color, enabled, hint, onChange, onCommit }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  suffix?: string;
  color: string;
  enabled: boolean;
  hint?: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const valueFromEvent = (event: GestureResponderEvent) => Math.round(minimum + clamp01(event.nativeEvent.locationX / width) * (maximum - minimum));
  const update = (event: GestureResponderEvent) => onChange(valueFromEvent(event));
  const commit = (event: GestureResponderEvent) => {
    const next = valueFromEvent(event);
    onChange(next);
    onCommit(next);
  };
  const ratio = clamp01((value - minimum) / Math.max(1, maximum - minimum));
  return (
    <View style={[styles.sliderBlock, !enabled && styles.sliderDisabled]}>
      <View style={styles.sliderHeader}><Text style={styles.sliderLabel}>{label}</Text><Text style={[styles.sliderValue, enabled && { color }]}>{value}{suffix}</Text></View>
      <View
        style={styles.sliderTouch}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => enabled}
        onMoveShouldSetResponder={() => enabled}
        onResponderGrant={update}
        onResponderMove={update}
        onResponderRelease={commit}
      >
        <View style={styles.sliderTrack}><View style={[styles.sliderFill, { width: `${ratio * 100}%`, backgroundColor: color }]} /></View>
        <View style={[styles.sliderThumb, { left: clamp(ratio * width - 10, 0, width - 20), borderColor: color }]} />
      </View>
      <View style={styles.sliderScale}><Text style={styles.sliderScaleText}>{minimum}{suffix}</Text>{hint ? <Text style={styles.sliderHint}>{hint}</Text> : <View />}<Text style={styles.sliderScaleText}>{maximum}{suffix}</Text></View>
    </View>
  );
}

function resolveZoneControls(controls: SemanticControl[]) {
  const checkboxes = controls
    .filter((control) => control.kind === 'CheckBox' && !/custom led ids/i.test(control.label))
    .sort((a, b) => a.top - b.top || a.order - b.order);
  return ZONES.map((definition, index) => ({
    definition,
    control: checkboxes.find((control) => control.label.toLocaleLowerCase() === definition.name.toLocaleLowerCase()) ?? checkboxes[index],
  }));
}

function findControl(controls: SemanticControl[], kind: string, label: RegExp) {
  return controls.find((control) => control.kind === kind && label.test(control.label));
}

function readRange(control: SemanticControl | undefined, fallback: number) {
  const value = Number(control?.value);
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function readEffectIndex(effect: SemanticControl | undefined, speed: SemanticControl | undefined) {
  const reported = EFFECTS.findIndex((candidate) => effect?.description.toLocaleLowerCase().includes(candidate.toLocaleLowerCase()));
  if (reported >= 0) return reported;
  return speed?.enabled === false ? 0 : 1;
}

function hexToHsv(value: string): HsvColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { h: 187, s: 0.65, v: 1 };
  const number = Number.parseInt(match[1], 16);
  const r = ((number >> 16) & 0xff) / 255;
  const g = ((number >> 8) & 0xff) / 255;
  const b = (number & 0xff) / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: maximum === 0 ? 0 : delta / maximum, v: maximum };
}

function hsvToHex({ h, s, v }: HsvColor) {
  const chroma = v * s;
  const section = ((h % 360) + 360) % 360 / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const match = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (section < 1) [red, green] = [chroma, intermediate];
  else if (section < 2) [red, green] = [intermediate, chroma];
  else if (section < 3) [green, blue] = [chroma, intermediate];
  else if (section < 4) [green, blue] = [intermediate, chroma];
  else if (section < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

const styles = StyleSheet.create({
  surface: { backgroundColor: colors.background, paddingBottom: 30 },
  hero: { paddingHorizontal: 16, paddingTop: 19, paddingBottom: 18, flexDirection: 'row', alignItems: 'flex-start' },
  heroCopy: { flex: 1, paddingRight: 10 },
  eyebrow: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 1.35 },
  title: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -0.7, marginTop: 5 },
  subtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  connectionPill: { height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center' },
  connectionPillOffline: { borderColor: '#512525' },
  connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#54E38B', marginRight: 6 },
  connectionDotOffline: { backgroundColor: colors.danger },
  connectionText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  card: { marginHorizontal: 10, marginBottom: 10, borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13, overflow: 'hidden' },
  cardHeader: { minHeight: 45, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  diagramStage: { height: 286, borderRadius: 16, backgroundColor: '#07090C', borderWidth: 1, borderColor: '#20242A', overflow: 'hidden', position: 'relative' },
  diagramGlow: { position: 'absolute', left: 78, top: 44, width: 190, height: 200, borderRadius: 100, backgroundColor: '#11151C', opacity: 0.85 },
  towerTop: { position: 'absolute', left: 61, top: 29, width: 165, height: 23, borderRadius: 6, backgroundColor: '#252A32', transform: [{ skewX: '-29deg' }] },
  sidePanel: { position: 'absolute', left: 42, top: 44, width: 142, height: 211, borderRadius: 10, borderWidth: 2, borderColor: '#343A44', backgroundColor: '#11151A', overflow: 'hidden' },
  sidePanelReflection: { position: 'absolute', right: -25, top: -20, width: 64, height: 270, backgroundColor: 'rgba(255,255,255,0.035)', transform: [{ rotate: '18deg' }] },
  frontPanel: { position: 'absolute', left: 177, top: 40, width: 67, height: 220, borderRadius: 22, backgroundColor: '#161A20', borderWidth: 2, borderColor: '#353A43' },
  outerRing: { position: 'absolute', left: 184, top: 75, width: 53, height: 145, borderRadius: 27, borderWidth: 7, backgroundColor: 'transparent', shadowOpacity: 0.6, shadowRadius: 6 },
  innerRing: { position: 'absolute', left: 192, top: 88, width: 37, height: 119, borderRadius: 19, borderWidth: 5, backgroundColor: 'transparent', shadowOpacity: 0.65, shadowRadius: 5 },
  powerZone: { position: 'absolute', left: 198, top: 50, width: 26, height: 26, borderRadius: 13, borderWidth: 3, backgroundColor: '#0C0F13', alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.75, shadowRadius: 5 },
  powerCore: { width: 8, height: 8, borderRadius: 4 },
  fan: { position: 'absolute', left: 82, top: 83, width: 60, height: 60, borderRadius: 30, borderWidth: 5, backgroundColor: '#0A0D11', alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.75, shadowRadius: 8 },
  fanHub: { width: 13, height: 13, borderRadius: 7, zIndex: 2 },
  fanBladeOne: { position: 'absolute', width: 40, height: 5, borderRadius: 3, backgroundColor: '#2C3139', transform: [{ rotate: '45deg' }] },
  fanBladeTwo: { position: 'absolute', width: 40, height: 5, borderRadius: 3, backgroundColor: '#2C3139', transform: [{ rotate: '-45deg' }] },
  wordmarkZone: { position: 'absolute', left: 69, top: 181, width: 78, height: 6, borderRadius: 3, shadowOpacity: 0.8, shadowRadius: 5 },
  towerFootLeft: { position: 'absolute', left: 55, top: 254, width: 42, height: 7, borderRadius: 4, backgroundColor: '#2A2F37' },
  towerFootRight: { position: 'absolute', left: 189, top: 257, width: 42, height: 7, borderRadius: 4, backgroundColor: '#2A2F37' },
  diagramCaption: { position: 'absolute', right: 13, bottom: 10, alignItems: 'flex-end' },
  diagramCaptionTitle: { color: colors.text, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  diagramCaptionDetail: { color: colors.textDim, fontSize: 8, marginTop: 3 },
  zoneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  zoneCard: { width: '48.8%', minHeight: 65, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, padding: 9, justifyContent: 'center' },
  zoneCheck: { position: 'absolute', right: 8, top: 8, width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  zoneCheckText: { color: '#070707', fontSize: 9, fontWeight: '900' },
  zoneName: { maxWidth: '78%', color: colors.text, fontSize: 11, fontWeight: '700' },
  zoneLed: { color: colors.textDim, fontSize: 8, marginTop: 5 },
  allZone: { minHeight: 58, marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center' },
  allZoneMark: { width: 9, height: 32, borderRadius: 5, backgroundColor: colors.borderStrong, marginRight: 10 },
  allZoneCopy: { flex: 1 },
  allZoneTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  allZoneDetail: { color: colors.textDim, fontSize: 8, marginTop: 3 },
  allZoneCount: { color: colors.textMuted, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  pickerRow: { height: 166, flexDirection: 'row', gap: 10 },
  saturationSquare: { flex: 1, borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderStrong },
  hueRail: { width: 30, borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderStrong },
  pickerThumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: 0.7, shadowRadius: 3 },
  hueThumb: { position: 'absolute', left: -2, width: 32, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'transparent' },
  colorReadout: { minHeight: 58, marginTop: 10, flexDirection: 'row', alignItems: 'center' },
  colorPreview: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', shadowOpacity: 0.6, shadowRadius: 8 },
  colorCopy: { flex: 1, marginLeft: 10 },
  colorHex: { color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  colorDetail: { color: colors.textDim, fontSize: 8, marginTop: 3 },
  useColorButton: { minWidth: 78, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  useColorText: { color: colors.inverseText, fontSize: 9, fontWeight: '800' },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  swatch: { width: 29, height: 29, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#FFFFFF', transform: [{ scale: 1.08 }] },
  effectGrid: { flexDirection: 'row', gap: 6 },
  effectButton: { flex: 1, minHeight: 76, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  effectButtonSelected: { backgroundColor: colors.surfaceSoft, borderColor: colors.borderStrong },
  effectText: { color: colors.textMuted, fontSize: 8, fontWeight: '700', marginTop: 8 },
  effectTextSelected: { color: colors.text },
  effectStatic: { width: 22, height: 22, borderRadius: 7 },
  effectBreatheOuter: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  effectBreatheInner: { width: 11, height: 11, borderRadius: 6 },
  effectPulse: { height: 26, flexDirection: 'row', alignItems: 'center', gap: 3 },
  effectPulseBar: { width: 4, height: 10, borderRadius: 2 },
  effectPulseBarTall: { width: 4, height: 25, borderRadius: 2 },
  effectSpectrum: { width: 28, height: 22, borderRadius: 7 },
  sliderBlock: { minHeight: 92, paddingVertical: 8 },
  sliderDisabled: { opacity: 0.4 },
  sliderHeader: { flexDirection: 'row', alignItems: 'center' },
  sliderLabel: { flex: 1, color: colors.text, fontSize: 11, fontWeight: '700' },
  sliderValue: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
  sliderTouch: { height: 38, justifyContent: 'center', marginTop: 3 },
  sliderTrack: { height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, overflow: 'hidden' },
  sliderFill: { height: '100%', borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 4, backgroundColor: colors.text, shadowColor: '#000000', shadowOpacity: 0.7, shadowRadius: 4 },
  sliderScale: { minHeight: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderScaleText: { color: colors.textDim, fontSize: 7 },
  sliderHint: { color: colors.textDim, fontSize: 8 },
  actionRow: { marginHorizontal: 10, marginBottom: 10, flexDirection: 'row', gap: 8 },
  applyButton: { flex: 1, height: 58, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  applyGlow: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 7 },
  applyText: { color: colors.inverseText, fontSize: 13, fontWeight: '800' },
  offButton: { width: 100, height: 58, borderRadius: 17, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  offGlyph: { color: colors.danger, fontSize: 18, marginRight: 5 },
  offText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  disabled: { opacity: 0.42 },
  advancedHeader: { minHeight: 66, marginHorizontal: 10, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  advancedTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  advancedSubtitle: { color: colors.textDim, fontSize: 8, marginTop: 4 },
  advancedChevron: { color: colors.textMuted, fontSize: 17 },
  advancedBody: { marginHorizontal: 10, marginTop: -8, marginBottom: 10, padding: 12, paddingTop: 18, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderTopWidth: 0, borderColor: colors.border },
  customToggleRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center' },
  customToggleCopy: { flex: 1 },
  customToggleTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  customToggleDetail: { color: colors.textDim, fontSize: 8, marginTop: 3 },
  loadingAdvanced: { color: colors.textMuted, fontSize: 10, paddingVertical: 10 },
  customField: { minHeight: 48, marginTop: 8, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', padding: 4 },
  customInput: { flex: 1, minHeight: 40, color: colors.text, fontSize: 12, paddingHorizontal: 9 },
  customUpdate: { height: 38, minWidth: 70, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  customUpdateText: { color: colors.inverseText, fontSize: 9, fontWeight: '800' },
  statusCard: { minHeight: 67, margin: 10, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center' },
  statusLight: { width: 7, height: 34, borderRadius: 4, marginRight: 11 },
  statusCopy: { flex: 1 },
  statusTitle: { color: colors.text, fontSize: 10, fontWeight: '700' },
  statusDetail: { color: colors.textMuted, fontSize: 8, lineHeight: 12, marginTop: 4 },
});
