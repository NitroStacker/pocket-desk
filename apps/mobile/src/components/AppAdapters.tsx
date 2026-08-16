import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { colors } from '../theme';
import type { AppVisual, CameraControlCommand, CameraPtzStatus, InputCommand, SemanticControl, SemanticSnapshot } from '../types';

export type AppAdapterKind =
  | 'file-explorer'
  | 'bezi'
  | 'chrome'
  | 'chatgpt'
  | 'settings'
  | 'document'
  | 'camera';

interface AdapterProps {
  kind: Exclude<AppAdapterKind, 'file-explorer'>;
  snapshot: SemanticSnapshot;
  visual: AppVisual | null;
  cameraStatus: CameraPtzStatus | null;
  onInput: (command: InputCommand) => void;
  onCameraControl: (command: CameraControlCommand) => void;
  onRefresh: () => void;
}

interface AppProps {
  snapshot: SemanticSnapshot;
  visual: AppVisual | null;
  cameraStatus: CameraPtzStatus | null;
  onInput: (command: InputCommand) => void;
  onCameraControl: (command: CameraControlCommand) => void;
  onRefresh: () => void;
}

interface VisualRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

const WINDOW_CHROME = /^(minimize|maximize|restore|close)\b/i;
const GENERIC_LABEL = /^(accessibilitytext|button|text|image|window|pane|group|custom|document)$/i;

export function getAppAdapterKind(process: string, title: string): AppAdapterKind | null {
  const identity = `${process} ${title}`.toLocaleLowerCase();
  if (/\bexplorer\b/.test(process.toLocaleLowerCase()) || /file explorer/.test(identity)) return 'file-explorer';
  if (/windowscamera|\bcamera\b/.test(identity)) return 'camera';
  if (/systemsettings|\bsettings\b/.test(identity)) return 'settings';
  if (/\bbezi\b/.test(identity)) return 'bezi';
  if (/chrome/.test(identity)) return 'chrome';
  if (/chatgpt|\bcodex\b/.test(identity)) return 'chatgpt';
  if (/notepad|winword|wordpad|excel|powerpnt|powerpoint|soffice|swriter|scalc|libreoffice/.test(identity)) return 'document';
  return null;
}

export function adapterNeedsVisual(process: string, title: string): boolean {
  const kind = getAppAdapterKind(process, title);
  return kind === 'camera' || kind === 'chrome' || kind === 'document';
}

export function SpecializedApplication({ kind, ...props }: AdapterProps) {
  if (kind === 'bezi') return <BeziApplication {...props} />;
  if (kind === 'chrome') return <ChromeApplication {...props} />;
  if (kind === 'chatgpt') return <ChatGptApplication {...props} />;
  if (kind === 'settings') return <SettingsApplication {...props} />;
  if (kind === 'document') return <DocumentApplication {...props} />;
  return <CameraApplication {...props} />;
}

function BeziApplication({ snapshot, onInput, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const navigation = unique(controls.filter((control) =>
    ['TreeItem', 'DataItem', 'ListItem'].includes(control.kind) && !GENERIC_LABEL.test(control.label),
  )).slice(0, 22);
  const quickActions = unique(controls.filter((control) =>
    control.interactive && /^(debug an issue|build a tool|write a script|new thread)$/i.test(control.label),
  ));
  const topActions = unique(controls.filter((control) =>
    control.interactive && /^(home|workspace|settings|your rules|plans|canvases|shared pages|private pages|your connections)$/i.test(control.label),
  ));
  const prompt = controls.find((control) => control.editable && control.width > 0.2)
    ?? controls.find((control) => /\/ for skills|what do you want to build/i.test(control.label));
  const promptActions = unique(controls.filter((control) =>
    control.interactive && /add to prompt|model|context|permission|attach|voice|send/i.test(control.label),
  )).slice(0, 8);
  const primaryCopy = unique(controls.filter((control) =>
    control.kind === 'Text' && control.top > 0.08 && control.label.length > 12 && control.label.length < 260 &&
    !GENERIC_LABEL.test(control.label) && !/\/ for skills|what do you want to build/i.test(control.label),
  )).slice(-6);

  return (
    <View style={styles.appSurface}>
      <AppHeading eyebrow="BEZI WORKSPACE" title="Build from your phone" subtitle="Your live Bezi workspace, rearranged into touch-friendly projects, actions, and a full prompt composer." />
      <ControlRail controls={topActions} onPress={(control) => activate(control, onInput, onRefresh)} />
      {navigation.length ? (
        <Section title="Workspace" count={navigation.length}>
          {navigation.map((control) => <MobileRow key={control.id} control={control} onPress={() => activate(control, onInput, onRefresh)} />)}
        </Section>
      ) : null}
      {primaryCopy.length ? (
        <Section title="Current canvas">
          <View style={styles.copyCard}>{primaryCopy.map((control) => <Text key={control.id} style={styles.copyText}>{readable(control)}</Text>)}</View>
        </Section>
      ) : null}
      {quickActions.length ? <ActionGrid controls={quickActions} onPress={(control) => activate(control, onInput, onRefresh)} /> : null}
      {prompt ? <Composer control={prompt} placeholder="Tell Bezi what you want to build..." onInput={onInput} onRefresh={onRefresh} /> : (
        <Notice title="Prompt is loading" body="Refresh after Bezi finishes opening its current workspace." />
      )}
      <ControlRail controls={promptActions} onPress={(control) => activate(control, onInput, onRefresh)} compact />
    </View>
  );
}

function ChromeApplication({ snapshot, visual, onInput, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const tabs = unique(controls.filter((control) => control.kind === 'TabItem'));
  const browserButtons = unique(controls.filter((control) =>
    control.kind === 'Button' && control.top < 0.18 && /^(back|forward|reload|refresh|home|new tab|downloads|history|bookmarks|extensions)/i.test(control.label),
  ));
  const address = controls.find((control) => control.editable && /address and search|address bar|search.*address/i.test(control.label));
  const bookmarks = unique(controls.filter((control) =>
    control.interactive && control.top < 0.26 && control.top > 0.07 &&
    !browserButtons.includes(control) && control !== address && !WINDOW_CHROME.test(control.label) && control.label.length < 90,
  )).slice(0, 16);
  const pageControls = unique(controls.filter((control) =>
    control.top > 0.15 && !WINDOW_CHROME.test(control.label) && !GENERIC_LABEL.test(control.label) &&
    (control.interactive || control.editable || ['Text', 'Document', 'Hyperlink', 'ListItem'].includes(control.kind)),
  )).slice(0, 40);
  const meaningfulPage = pageControls.filter((control) => control.interactive || control.editable || readable(control).length > 20);

  return (
    <View style={styles.appSurface}>
      {tabs.length ? <ControlRail controls={tabs} onPress={(control) => activate(control, onInput, onRefresh)} selected /> : null}
      <View style={styles.browserBar}>
        <ControlRail controls={browserButtons} onPress={(control) => activate(control, onInput, onRefresh)} compact />
        {address ? <CommandField control={address} placeholder="Search or enter an address" action="Go" submit onInput={onInput} onRefresh={onRefresh} /> : null}
      </View>
      {bookmarks.length ? <ControlRail controls={bookmarks} onPress={(control) => activate(control, onInput, onRefresh)} compact /> : null}
      <Section title="Web page">
        {meaningfulPage.length >= 4 ? meaningfulPage.map((control) => (
          control.editable
            ? <CommandField key={control.id} control={control} placeholder={control.label} action="Submit" submit onInput={onInput} onRefresh={onRefresh} />
            : control.interactive
              ? <MobileRow key={control.id} control={control} onPress={() => activate(control, onInput, onRefresh)} />
              : <View key={control.id} style={styles.copyCard}><Text style={styles.copyText}>{readable(control)}</Text></View>
        )) : visual ? (
          <View style={styles.visualStack}>
            <InteractiveVisualCrop snapshot={snapshot} visual={visual} region={{ left: 0, top: 0.16, width: 0.54, height: 0.84, label: 'Left side of the current web page' }} onInput={onInput} onRefresh={onRefresh} />
            <InteractiveVisualCrop snapshot={snapshot} visual={visual} region={{ left: 0.46, top: 0.16, width: 0.54, height: 0.84, label: 'Right side of the current web page' }} onInput={onInput} onRefresh={onRefresh} />
          </View>
        ) : <VisualLoading />}
      </Section>
    </View>
  );
}

function ChatGptApplication({ snapshot, onInput, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const mainNavLabels = /^(search|activity|pull requests|sites|scheduled|plugins|new chat|quick chat|projects)$/i;
  const mainNavigation = unique(controls.filter((control) => control.interactive && mainNavLabels.test(control.label)));
  const listItems = unique(controls.filter((control) =>
    ['ListItem', 'TreeItem'].includes(control.kind) && !GENERIC_LABEL.test(control.label),
  )).slice(0, 24);
  const composer = controls.find((control) => control.editable && /do anything|message|ask|prompt/i.test(`${control.label} ${control.description}`))
    ?? [...controls].filter((control) => control.editable).sort((a, b) => b.top - a.top)[0];
  const composerActions = unique(controls.filter((control) =>
    control.interactive && /add files|permissions|model|dictate|voice|stop|send/i.test(control.label),
  )).slice(0, 10);
  const messages = unique(controls.filter((control) =>
    control.kind === 'Text' && control.left > 0.18 && control.top > 0.06 && control.top < 0.91 &&
    control.label.length > 18 && !GENERIC_LABEL.test(control.label) &&
    !/^(codex|chatgpt|do anything|thinking|working)$/i.test(control.label),
  )).slice(-28);

  return (
    <View style={[styles.appSurface, styles.chatSurface]}>
      <ControlRail controls={mainNavigation} onPress={(control) => activate(control, onInput, onRefresh)} />
      {listItems.length ? (
        <Section title="Projects and conversations" count={listItems.length}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardRail}>
            {listItems.map((control) => (
              <Pressable key={control.id} onPress={() => activate(control, onInput, onRefresh)} style={[styles.projectCard, control.selected && styles.projectCardSelected]}>
                <Text style={styles.projectTitle} numberOfLines={3}>{control.label}</Text>
                <Text style={styles.projectOpen}>OPEN</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Section>
      ) : null}
      <Section title="Current conversation">
        {messages.length ? messages.map((control) => (
          <View key={control.id} style={[styles.messageBubble, control.left > 0.5 && styles.messageBubbleUser]}>
            <Text style={styles.messageText} selectable>{readable(control)}</Text>
          </View>
        )) : <Notice title="Conversation is loading" body="The desktop app has not exposed the current messages yet." />}
      </Section>
      {composer ? <Composer control={composer} placeholder="Do anything..." onInput={onInput} onRefresh={onRefresh} /> : null}
      <ControlRail controls={composerActions} onPress={(control) => activate(control, onInput, onRefresh)} compact />
    </View>
  );
}

function SettingsApplication({ snapshot, onInput, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const search = controls.find((control) => control.editable && /find a setting|search box/i.test(control.label));
  const categories = unique(controls.filter((control) =>
    control.kind === 'ListItem' && control.left < 0.2 && control.label.length < 60,
  )).slice(0, 18);
  const selectedCategory = categories.find((control) => control.selected)?.label ?? 'Settings';
  const pageActions = unique(controls.filter((control) =>
    control.left >= 0.2 && control.top > 0.04 && !WINDOW_CHROME.test(control.label) &&
    !GENERIC_LABEL.test(control.label) && (control.interactive || control.editable) && control !== search,
  )).slice(0, 40);
  const pageCopy = unique(controls.filter((control) =>
    control.left >= 0.2 && control.top > 0.04 && control.kind === 'Text' &&
    control.label.length > 2 && control.label.length < 220 && !GENERIC_LABEL.test(control.label),
  )).slice(0, 12);

  return (
    <View style={styles.appSurface}>
      <AppHeading eyebrow="WINDOWS SETTINGS" title={selectedCategory} subtitle="Search, move between categories, and change the same live Windows settings with mobile-sized controls." />
      {search ? <CommandField control={search} placeholder="Find a setting" action="Search" submit onInput={onInput} onRefresh={onRefresh} /> : null}
      <ControlRail controls={categories} onPress={(control) => activate(control, onInput, onRefresh)} selected />
      <Section title={selectedCategory} count={pageActions.length}>
        {pageActions.length ? pageActions.map((control) => (
          control.category === 'option' || control.checked !== null
            ? <ToggleRow key={control.id} control={control} onPress={() => activate(control, onInput, onRefresh)} />
            : control.editable
              ? <CommandField key={control.id} control={control} placeholder={control.label} action="Update" onInput={onInput} onRefresh={onRefresh} />
              : <MobileRow key={control.id} control={control} onPress={() => activate(control, onInput, onRefresh)} />
        )) : pageCopy.map((control) => <View key={control.id} style={styles.copyCard}><Text style={styles.copyText}>{readable(control)}</Text></View>)}
      </Section>
    </View>
  );
}

function DocumentApplication({ snapshot, visual, onInput, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const tabs = unique(controls.filter((control) => control.kind === 'TabItem'));
  const menus = unique(controls.filter((control) => control.kind === 'MenuItem' && control.top < 0.24));
  const editor = [...controls].filter((control) => control.editable && ['Document', 'Edit'].includes(control.kind))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const toolbar = unique(controls.filter((control) =>
    control.interactive && control.top < (editor?.top ?? 0.35) &&
    !tabs.includes(control) && !menus.includes(control) && !WINDOW_CHROME.test(control.label) && !GENERIC_LABEL.test(control.label),
  )).slice(0, 28);
  const status = unique(controls.filter((control) =>
    control.kind === 'Text' && control.top > 0.86 && !GENERIC_LABEL.test(control.label),
  )).slice(0, 10);

  return (
    <View style={styles.appSurface}>
      <View style={styles.documentTopRow}>
        <Text style={styles.documentTitle}>{snapshot.activeTitle}</Text>
        <Pressable onPress={() => { onInput({ kind: 'shortcut', keys: ['CTRL', 'S'] }); setTimeout(onRefresh, 500); }} style={styles.saveButton}><Text style={styles.saveText}>Save</Text></Pressable>
      </View>
      <ControlRail controls={tabs} onPress={(control) => activate(control, onInput, onRefresh)} selected />
      <ControlRail controls={menus} onPress={(control) => activate(control, onInput, onRefresh)} compact />
      <ControlRail controls={toolbar} onPress={(control) => activate(control, onInput, onRefresh)} compact />
      {editor ? <DocumentEditor control={editor} onInput={onInput} onRefresh={onRefresh} /> : visual ? (
        <InteractiveVisualCrop snapshot={snapshot} visual={visual} region={{ left: 0, top: 0.16, width: 1, height: 0.84, label: 'Current document' }} onInput={onInput} onRefresh={onRefresh} />
      ) : <VisualLoading />}
      {status.length ? <View style={styles.statusRail}>{status.map((control) => <Text key={control.id} style={styles.statusCopy}>{readable(control)}</Text>)}</View> : null}
    </View>
  );
}

function CameraApplication({ snapshot, visual, cameraStatus, onInput, onCameraControl, onRefresh }: AppProps) {
  const controls = accessible(snapshot);
  const primary = controls.find((control) => control.kind === 'Button' && /^take (photo|video)$/i.test(control.label));
  const settings = controls.find((control) => control.kind === 'Button' && /open settings/i.test(control.label));
  const adjustments = unique(controls.filter((control) =>
    control.kind === 'Button' && /focus at|brightness at|switch to|camera roll|prevscene|nextscene|timer|flash|hdr/i.test(control.label),
  ));
  const mode = primary?.label.replace(/^take /i, '') ?? 'camera';

  return (
    <View style={[styles.appSurface, styles.cameraSurface]}>
      <View style={styles.cameraHeader}>
        <View><Text style={styles.cameraEyebrow}>LIVE CAMERA</Text><Text style={styles.cameraTitle}>{mode} mode</Text></View>
        {settings ? <Pressable onPress={() => activate(settings, onInput, onRefresh)} style={styles.cameraSettings}><Text style={styles.cameraSettingsText}>Settings</Text></Pressable> : null}
      </View>
      {visual ? (
        <InteractiveVisualCrop snapshot={snapshot} visual={visual} region={{ left: 0.07, top: 0.055, width: 0.8, height: 0.9, label: 'Live camera preview' }} onInput={onInput} onRefresh={onRefresh} dark />
      ) : <VisualLoading label="Opening the live camera preview" />}
      <CameraPtzPanel status={cameraStatus} onControl={onCameraControl} />
      <ControlRail controls={adjustments} onPress={(control) => activate(control, onInput, onRefresh)} compact dark />
      {primary ? (
        <Pressable onPress={() => activate(primary, onInput, onRefresh, 800)} style={styles.shutterButton} accessibilityLabel={primary.label}>
          <View style={styles.shutterInner} />
          <Text style={styles.shutterLabel}>{primary.label}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.cameraPrivacy}>The preview and controls stay inside your authenticated PocketDesk session.</Text>
    </View>
  );
}

function CameraPtzPanel({ status, onControl }: {
  status: CameraPtzStatus | null;
  onControl: (command: CameraControlCommand) => void;
}) {
  if (!status) {
    return <View style={styles.ptzPanel}><View style={styles.ptzLoadingRow}><ActivityIndicator color="#42D8C4" /><Text style={styles.ptzLoadingText}>Connecting to the camera motor...</Text></View></View>;
  }
  if (!status.ptz) {
    return (
      <View style={styles.ptzPanel}>
        <Text style={styles.ptzTitle}>Motor control</Text>
        <Text style={styles.ptzError}>{status.error || 'Pan and tilt are not currently available.'}</Text>
        <Pressable onPress={() => onControl({ kind: 'query' })} style={styles.ptzRetry}><Text style={styles.ptzRetryText}>Retry</Text></Pressable>
      </View>
    );
  }

  const move = (direction: 'Left' | 'Right' | 'Up' | 'Down', amount = 5) =>
    onControl({ kind: 'move', direction, amount });
  const zoom = (direction: 'ZoomIn' | 'ZoomOut', amount = 3) =>
    onControl({ kind: 'move', direction, amount });

  return (
    <View style={styles.ptzPanel}>
      <View style={styles.ptzHeader}>
        <View><Text style={styles.ptzEyebrow}>UVC MOTOR CONTROL</Text><Text style={styles.ptzTitle}>{status.device}</Text></View>
        <View style={styles.ptzLiveBadge}><View style={styles.ptzLiveDot} /><Text style={styles.ptzLiveText}>READY</Text></View>
      </View>
      <View style={styles.ptzReadout}>
        <Text style={styles.ptzReadoutText}>Pan {status.pan.current}°</Text>
        <Text style={styles.ptzReadoutText}>Tilt {status.tilt.current}°</Text>
        {status.zoom.supported ? <Text style={styles.ptzReadoutText}>Zoom {status.zoom.current}</Text> : null}
      </View>
      <View style={styles.ptzControlArea}>
        <View style={styles.ptzPad}>
          <PtzButton label="Up" symbol="↑" onPress={() => move('Up')} onLongPress={() => move('Up', 15)} />
          <View style={styles.ptzMiddleRow}>
            <PtzButton label="Left" symbol="←" onPress={() => move('Left')} onLongPress={() => move('Left', 15)} />
            <PtzButton label="Center" symbol="●" accent onPress={() => onControl({ kind: 'home' })} />
            <PtzButton label="Right" symbol="→" onPress={() => move('Right')} onLongPress={() => move('Right', 15)} />
          </View>
          <PtzButton label="Down" symbol="↓" onPress={() => move('Down')} onLongPress={() => move('Down', 15)} />
        </View>
        {status.zoom.supported ? (
          <View style={styles.zoomColumn}>
            <PtzButton label="Zoom in" symbol="+" onPress={() => zoom('ZoomIn')} onLongPress={() => zoom('ZoomIn', 10)} />
            <Text style={styles.zoomLabel}>ZOOM</Text>
            <PtzButton label="Zoom out" symbol="−" onPress={() => zoom('ZoomOut')} onLongPress={() => zoom('ZoomOut', 10)} />
          </View>
        ) : null}
      </View>
      <Text style={styles.ptzHint}>Tap for a precise step. Hold for a larger move.</Text>
      <View style={styles.presets}>
        {([1, 2, 3] as const).map((slot) => {
          const saved = status.presets.find((preset) => preset.slot === slot)?.saved === true;
          return (
            <View key={slot} style={styles.presetCard}>
              <Text style={styles.presetTitle}>Preset {slot}</Text>
              <Pressable disabled={!saved} onPress={() => onControl({ kind: 'presetRecall', slot })} style={[styles.presetRecall, !saved && styles.disabled]}><Text style={styles.presetRecallText}>{saved ? 'Go' : 'Empty'}</Text></Pressable>
              <Pressable onPress={() => onControl({ kind: 'presetSave', slot })} style={styles.presetSave}><Text style={styles.presetSaveText}>Save here</Text></Pressable>
            </View>
          );
        })}
      </View>
      {status.error ? <Text style={styles.ptzError}>{status.error}</Text> : null}
    </View>
  );
}

function PtzButton({ label, symbol, onPress, onLongPress, accent = false }: {
  label: string;
  symbol: string;
  onPress: () => void;
  onLongPress?: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} delayLongPress={360} style={({ pressed }) => [styles.ptzButton, accent && styles.ptzButtonAccent, pressed && styles.ptzButtonPressed]}>
      <Text style={[styles.ptzButtonSymbol, accent && styles.ptzButtonSymbolAccent]}>{symbol}</Text>
      <Text style={[styles.ptzButtonLabel, accent && styles.ptzButtonLabelAccent]}>{label}</Text>
    </Pressable>
  );
}

function AppHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <View style={styles.heading}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.headingTitle}>{title}</Text><Text style={styles.headingBody}>{subtitle}</Text></View>;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text>{typeof count === 'number' ? <Text style={styles.sectionCount}>{count}</Text> : null}</View>{children}</View>;
}

function ControlRail({ controls, onPress, selected = false, compact = false, dark = false }: {
  controls: SemanticControl[];
  onPress: (control: SemanticControl) => void;
  selected?: boolean;
  compact?: boolean;
  dark?: boolean;
}) {
  if (!controls.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.controlRail, dark && styles.controlRailDark]} contentContainerStyle={styles.controlRailContent}>
      {controls.map((control) => (
        <Pressable key={control.id} disabled={!control.enabled} onPress={() => onPress(control)} style={[
          styles.controlChip,
          compact && styles.controlChipCompact,
          dark && styles.controlChipDark,
          selected && (control.selected || control.focused) && styles.controlChipSelected,
          !control.enabled && styles.disabled,
        ]}>
          <Text style={[styles.controlChipText, dark && styles.controlChipTextDark, selected && (control.selected || control.focused) && styles.controlChipTextSelected]} numberOfLines={2}>{friendlyLabel(control.label)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ActionGrid({ controls, onPress }: { controls: SemanticControl[]; onPress: (control: SemanticControl) => void }) {
  return <View style={styles.actionGrid}>{controls.map((control) => <Pressable key={control.id} onPress={() => onPress(control)} style={styles.actionCard}><Text style={styles.actionTitle}>{control.label}</Text><Text style={styles.actionOpen}>RUN</Text></Pressable>)}</View>;
}

function MobileRow({ control, onPress }: { control: SemanticControl; onPress: () => void }) {
  const detail = control.value && control.value !== control.label ? control.value : control.description;
  return (
    <Pressable disabled={!control.enabled} onPress={onPress} style={[styles.mobileRow, control.selected && styles.mobileRowSelected, !control.enabled && styles.disabled]}>
      <View style={[styles.rowGlyph, control.selected && styles.rowGlyphSelected]}><Text style={styles.rowGlyphText}>{glyph(control.label)}</Text></View>
      <View style={styles.mobileRowCopy}><Text style={styles.mobileRowTitle}>{friendlyLabel(control.label)}</Text>{detail ? <Text style={styles.mobileRowDetail} numberOfLines={3}>{detail}</Text> : null}</View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function ToggleRow({ control, onPress }: { control: SemanticControl; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.toggleRow}><View style={styles.mobileRowCopy}><Text style={styles.mobileRowTitle}>{control.label}</Text>{control.description ? <Text style={styles.mobileRowDetail}>{control.description}</Text> : null}</View><Switch value={control.checked ?? control.selected} onValueChange={onPress} trackColor={{ false: '#CBD1DA', true: colors.primary }} /></Pressable>;
}

function CommandField({ control, placeholder, action, submit = false, onInput, onRefresh }: {
  control: SemanticControl;
  placeholder: string;
  action: string;
  submit?: boolean;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}) {
  const initial = control.value.trim();
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [control.id, initial]);
  const apply = () => {
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: value });
    if (submit) setTimeout(() => onInput({ kind: 'key', key: 'Enter' }), 160);
    setTimeout(onRefresh, 650);
  };
  return <View style={styles.commandField}><TextInput value={value} onChangeText={setValue} onSubmitEditing={apply} placeholder={placeholder} placeholderTextColor="#798496" style={styles.commandInput} autoCorrect={false} returnKeyType={submit ? 'go' : 'done'} /><Pressable onPress={apply} style={styles.commandButton}><Text style={styles.commandButtonText}>{action}</Text></Pressable></View>;
}

function Composer({ control, placeholder, onInput, onRefresh }: {
  control: SemanticControl;
  placeholder: string;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState('');
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text });
    setTimeout(() => onInput({ kind: 'key', key: 'Enter' }), 180);
    setDraft('');
    setTimeout(onRefresh, 850);
  };
  return <View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} multiline placeholder={placeholder} placeholderTextColor="#8A93A4" style={styles.composerInput} /><Pressable disabled={!draft.trim()} onPress={send} style={[styles.sendButton, !draft.trim() && styles.disabled]}><Text style={styles.sendText}>Send</Text></Pressable></View>;
}

function DocumentEditor({ control, onInput, onRefresh }: { control: SemanticControl; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  const initial = readable(control);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(initial); }, [control.id, dirty, initial]);
  const apply = () => {
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: draft });
    setDirty(false);
    setTimeout(onRefresh, 700);
  };
  return <View style={styles.documentEditor}><View style={styles.editorHeader}><Text style={styles.editorHeaderText}>{friendlyLabel(control.label)}</Text><Pressable disabled={!dirty} onPress={apply} style={[styles.applyButton, !dirty && styles.disabled]}><Text style={styles.applyText}>Apply</Text></Pressable></View><TextInput value={draft} onChangeText={(text) => { setDraft(text); setDirty(text !== initial); }} multiline textAlignVertical="top" autoCorrect style={styles.documentInput} /></View>;
}

function InteractiveVisualCrop({ snapshot, visual, region, onInput, onRefresh, dark = false }: {
  snapshot: SemanticSnapshot;
  visual: AppVisual;
  region: VisualRegion;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
  dark?: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.max(280, screenWidth - 24);
  const scale = width / Math.max(1, region.width * visual.width);
  const imageWidth = visual.width * scale;
  const imageHeight = visual.height * scale;
  const cropHeight = Math.max(110, region.height * visual.height * scale);
  const press = (event: GestureResponderEvent) => {
    const localX = clamp01(event.nativeEvent.locationX / width);
    const localY = clamp01(event.nativeEvent.locationY / cropHeight);
    const windowX = region.left + localX * region.width;
    const windowY = region.top + localY * region.height;
    onInput({
      kind: 'tap',
      x: clamp01(snapshot.windowFrame.x + windowX * snapshot.windowFrame.width),
      y: clamp01(snapshot.windowFrame.y + windowY * snapshot.windowFrame.height),
    });
    setTimeout(onRefresh, 420);
  };
  return <Pressable onPress={press} style={[styles.visualCrop, dark && styles.visualCropDark, { width, height: cropHeight }]} accessibilityLabel={region.label}><Image source={{ uri: visual.dataUri }} style={{ position: 'absolute', width: imageWidth, height: imageHeight, left: -region.left * visual.width * scale, top: -region.top * visual.height * scale }} resizeMode="stretch" /></Pressable>;
}

function VisualLoading({ label = 'Reflowing the live application view' }: { label?: string }) {
  return <View style={styles.visualLoading}><ActivityIndicator color={colors.primaryBright} /><Text style={styles.visualLoadingText}>{label}</Text></View>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return <View style={styles.notice}><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.noticeBody}>{body}</Text></View>;
}

function activate(control: SemanticControl, onInput: (command: InputCommand) => void, onRefresh: () => void, delay = 450) {
  if (!control.enabled || (!control.interactive && control.source !== 'vision')) return;
  onInput({ kind: 'tap', x: control.x, y: control.y });
  setTimeout(onRefresh, delay);
}

function accessible(snapshot: SemanticSnapshot): SemanticControl[] {
  return snapshot.controls.filter((control) => control.source === 'accessibility' && !WINDOW_CHROME.test(control.label));
}

function unique(controls: SemanticControl[]): SemanticControl[] {
  const labels = new Set<string>();
  return [...controls].sort((a, b) => a.top - b.top || a.left - b.left || a.order - b.order).filter((control) => {
    const label = readable(control).toLocaleLowerCase();
    if (!label || labels.has(label)) return false;
    labels.add(label);
    return true;
  });
}

function readable(control: SemanticControl): string {
  const value = control.value.trim();
  return (value && value !== control.label.trim() ? value : control.label).replace(/\r\n?/g, '\n').trim();
}

function friendlyLabel(label: string): string {
  if (/^prevscenebutton$/i.test(label)) return 'Previous mode';
  return label.replace(/\. (?:Unmodified|Modified)\.?$/i, '').replace(/\s+/g, ' ').trim();
}

function glyph(label: string): string {
  return label.trim().slice(0, 1).toLocaleUpperCase() || '•';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const styles = StyleSheet.create({
  appSurface: { backgroundColor: '#F3F5F8', paddingBottom: 28 },
  heading: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E1E5EB' },
  eyebrow: { color: '#7559E8', fontSize: 9, letterSpacing: 1.4, fontWeight: '900' },
  headingTitle: { color: '#101828', fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 5 },
  headingBody: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 6 },
  section: { paddingTop: 14 },
  sectionHeader: { paddingHorizontal: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { flex: 1, color: '#101828', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  sectionCount: { color: '#667085', fontSize: 10, fontWeight: '800' },
  controlRail: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E1E5EB' },
  controlRailDark: { backgroundColor: '#080D16', borderBottomColor: '#202B3B' },
  controlRailContent: { paddingHorizontal: 10, paddingVertical: 9, gap: 7 },
  controlChip: { minHeight: 42, maxWidth: 180, borderRadius: 21, backgroundColor: '#F0F2F6', borderWidth: 1, borderColor: '#DDE2EA', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  controlChipCompact: { minHeight: 38, borderRadius: 12, paddingHorizontal: 12 },
  controlChipDark: { backgroundColor: '#131D2C', borderColor: '#29364B' },
  controlChipSelected: { backgroundColor: '#201A3A', borderColor: '#201A3A' },
  controlChipText: { color: '#344054', fontSize: 11, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
  controlChipTextDark: { color: '#E6EAF1' },
  controlChipTextSelected: { color: '#FFFFFF' },
  browserBar: { backgroundColor: '#FFFFFF', paddingBottom: 8 },
  cardRail: { paddingHorizontal: 10, gap: 9 },
  projectCard: { width: 148, minHeight: 104, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDE2EA', padding: 13, justifyContent: 'space-between' },
  projectCardSelected: { backgroundColor: '#F0EDFF', borderColor: colors.primary },
  projectTitle: { color: '#202939', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  projectOpen: { color: '#6941C6', fontSize: 8, letterSpacing: 1, fontWeight: '900', marginTop: 13 },
  actionGrid: { paddingHorizontal: 10, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  actionCard: { flexGrow: 1, flexBasis: '44%', minHeight: 92, borderRadius: 16, backgroundColor: '#201A3A', padding: 14, justifyContent: 'space-between' },
  actionTitle: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, fontWeight: '900' },
  actionOpen: { color: '#B9ACFF', fontSize: 8, letterSpacing: 1, fontWeight: '900', marginTop: 10 },
  mobileRow: { minHeight: 68, marginHorizontal: 10, marginBottom: 7, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE3E9', padding: 10, flexDirection: 'row', alignItems: 'center' },
  mobileRowSelected: { backgroundColor: '#F0EDFF', borderColor: colors.primary },
  rowGlyph: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#E9EDF3', alignItems: 'center', justifyContent: 'center' },
  rowGlyphSelected: { backgroundColor: '#DDD5FF' },
  rowGlyphText: { color: '#535E6E', fontSize: 15, fontWeight: '900' },
  mobileRowCopy: { flex: 1, marginHorizontal: 11 },
  mobileRowTitle: { color: '#202939', fontSize: 14, lineHeight: 18, fontWeight: '800' },
  mobileRowDetail: { color: '#667085', fontSize: 10, lineHeight: 14, marginTop: 3 },
  chevron: { color: '#98A2B3', fontSize: 24 },
  toggleRow: { minHeight: 68, marginHorizontal: 10, marginBottom: 7, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE3E9', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  copyCard: { marginHorizontal: 10, marginBottom: 7, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E4EA', padding: 14 },
  copyText: { color: '#344054', fontSize: 13, lineHeight: 20, marginBottom: 5 },
  commandField: { minHeight: 58, marginHorizontal: 10, marginTop: 9, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DBE4', padding: 6, flexDirection: 'row', alignItems: 'center' },
  commandInput: { flex: 1, minHeight: 44, color: '#101828', fontSize: 14, paddingHorizontal: 11 },
  commandButton: { height: 42, minWidth: 66, borderRadius: 10, backgroundColor: '#202939', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  commandButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  composer: { margin: 10, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D5DAE3', padding: 8, flexDirection: 'row', alignItems: 'flex-end' },
  composerInput: { flex: 1, minHeight: 72, maxHeight: 180, color: '#101828', fontSize: 15, lineHeight: 21, paddingHorizontal: 10, paddingVertical: 10 },
  sendButton: { minWidth: 70, height: 46, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  sendText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  chatSurface: { backgroundColor: '#EEF1F5' },
  messageBubble: { marginHorizontal: 10, marginBottom: 8, marginRight: 28, borderRadius: 16, borderTopLeftRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E4EA', padding: 13 },
  messageBubbleUser: { marginLeft: 28, marginRight: 10, borderTopLeftRadius: 16, borderTopRightRadius: 5, backgroundColor: '#EDE9FF', borderColor: '#D8CFFF' },
  messageText: { color: '#202939', fontSize: 13, lineHeight: 20 },
  documentTopRow: { minHeight: 58, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E1E5EB', flexDirection: 'row', alignItems: 'center' },
  documentTitle: { flex: 1, color: '#101828', fontSize: 15, fontWeight: '900' },
  saveButton: { minWidth: 70, height: 38, borderRadius: 11, backgroundColor: '#202939', alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  documentEditor: { minHeight: 530, backgroundColor: '#FFFFFF' },
  editorHeader: { height: 50, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' },
  editorHeaderText: { flex: 1, color: '#667085', fontSize: 10, letterSpacing: 0.7, fontWeight: '900', textTransform: 'uppercase' },
  applyButton: { minWidth: 72, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  documentInput: { minHeight: 480, color: '#101828', backgroundColor: '#FFFFFF', fontSize: 16, lineHeight: 24, padding: 16, fontFamily: 'monospace' },
  statusRail: { minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, backgroundColor: '#E9EDF3' },
  statusCopy: { color: '#596273', fontSize: 9, fontWeight: '700' },
  visualStack: { gap: 10 },
  visualCrop: { alignSelf: 'center', backgroundColor: '#101828', borderRadius: 14, borderWidth: 1, borderColor: '#CBD2DC', overflow: 'hidden' },
  visualCropDark: { borderColor: '#2D3C51', backgroundColor: '#000000' },
  visualLoading: { minHeight: 260, margin: 10, borderRadius: 18, backgroundColor: '#101828', alignItems: 'center', justifyContent: 'center', padding: 24 },
  visualLoadingText: { color: '#D5DBE7', fontSize: 12, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  notice: { margin: 10, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E4EA', padding: 15 },
  noticeTitle: { color: '#202939', fontSize: 14, fontWeight: '900' },
  noticeBody: { color: '#667085', fontSize: 11, lineHeight: 17, marginTop: 5 },
  cameraSurface: { backgroundColor: '#05080D' },
  cameraHeader: { minHeight: 68, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#080D16' },
  cameraEyebrow: { color: '#42D8C4', fontSize: 8, letterSpacing: 1.4, fontWeight: '900' },
  cameraTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', textTransform: 'capitalize', marginTop: 3 },
  cameraSettings: { height: 40, borderRadius: 12, backgroundColor: '#172335', borderWidth: 1, borderColor: '#2C3B51', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  cameraSettingsText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  ptzPanel: { marginHorizontal: 10, marginTop: 12, borderRadius: 20, backgroundColor: '#0D1522', borderWidth: 1, borderColor: '#26354A', padding: 14 },
  ptzLoadingRow: { minHeight: 90, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  ptzLoadingText: { color: '#A8B3C4', fontSize: 11, fontWeight: '700' },
  ptzHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ptzEyebrow: { color: '#42D8C4', fontSize: 8, letterSpacing: 1.2, fontWeight: '900' },
  ptzTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', marginTop: 3 },
  ptzLiveBadge: { height: 26, borderRadius: 13, backgroundColor: '#142A2A', paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center' },
  ptzLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#42D8C4', marginRight: 5 },
  ptzLiveText: { color: '#78E6D7', fontSize: 7, letterSpacing: 0.7, fontWeight: '900' },
  ptzReadout: { minHeight: 36, marginTop: 10, borderRadius: 10, backgroundColor: '#080D16', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  ptzReadoutText: { color: '#9EABBD', fontSize: 9, fontWeight: '800' },
  ptzControlArea: { marginTop: 13, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  ptzPad: { width: 216, alignItems: 'center', gap: 7 },
  ptzMiddleRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoomColumn: { alignItems: 'center', gap: 8 },
  zoomLabel: { color: '#718096', fontSize: 7, letterSpacing: 1, fontWeight: '900' },
  ptzButton: { width: 64, height: 64, borderRadius: 18, backgroundColor: '#172335', borderWidth: 1, borderColor: '#304159', alignItems: 'center', justifyContent: 'center' },
  ptzButtonAccent: { backgroundColor: '#42D8C4', borderColor: '#42D8C4' },
  ptzButtonPressed: { opacity: 0.65, transform: [{ scale: 0.96 }] },
  ptzButtonSymbol: { color: '#FFFFFF', fontSize: 23, lineHeight: 25, fontWeight: '700' },
  ptzButtonSymbolAccent: { color: '#07110F', fontSize: 16 },
  ptzButtonLabel: { color: '#94A2B6', fontSize: 7, fontWeight: '800', marginTop: 2 },
  ptzButtonLabelAccent: { color: '#173832' },
  ptzHint: { color: '#718096', fontSize: 8, textAlign: 'center', marginTop: 11 },
  presets: { marginTop: 13, flexDirection: 'row', gap: 7 },
  presetCard: { flex: 1, minHeight: 96, borderRadius: 13, backgroundColor: '#111C2B', borderWidth: 1, borderColor: '#27374E', padding: 8, alignItems: 'center' },
  presetTitle: { color: '#DCE2EB', fontSize: 9, fontWeight: '900' },
  presetRecall: { width: '100%', height: 31, borderRadius: 9, backgroundColor: '#263650', alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  presetRecallText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  presetSave: { minHeight: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  presetSaveText: { color: '#42D8C4', fontSize: 7, fontWeight: '900' },
  ptzRetry: { alignSelf: 'flex-start', height: 38, borderRadius: 11, backgroundColor: '#263650', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  ptzRetryText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  ptzError: { color: '#FDA4AF', fontSize: 10, lineHeight: 15, marginTop: 9 },
  shutterButton: { alignSelf: 'center', width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 12 },
  shutterInner: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#FFFFFF' },
  shutterLabel: { position: 'absolute', bottom: -24, color: '#D9E0EA', fontSize: 10, fontWeight: '800' },
  cameraPrivacy: { color: '#8290A4', fontSize: 9, lineHeight: 14, textAlign: 'center', paddingHorizontal: 38, marginTop: 24, marginBottom: 12 },
  disabled: { opacity: 0.42 },
});
