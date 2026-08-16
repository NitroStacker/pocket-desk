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
import { colors, radii } from '../theme';
import type { AppVisual, CameraControlCommand, CameraPtzStatus, InputCommand, SemanticControl, SemanticSnapshot } from '../types';
import { getAppAdapterKind, SpecializedApplication } from './AppAdapters';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  snapshot: SemanticSnapshot | null;
  visual: AppVisual | null;
  cameraStatus: CameraPtzStatus | null;
  hostOnline: boolean;
  icons: Record<string, string>;
  onInput: (command: InputCommand) => void;
  onCameraControl: (command: CameraControlCommand) => void;
  onRefresh: () => void;
}

interface InterfaceModel {
  title: string;
  tabs: SemanticControl[];
  menus: SemanticControl[];
  toolbar: SemanticControl[];
  sideNavigation: SemanticControl[];
  mainSurface: SemanticControl | null;
  rows: SemanticControl[][];
  status: SemanticControl[];
  useVisualLayout: boolean;
}

interface VisualRegion {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

export function SemanticWorkspace({
  snapshot,
  visual,
  cameraStatus,
  hostOnline,
  icons,
  onInput,
  onCameraControl,
  onRefresh,
}: Props) {
  const activeWindow = snapshot?.windows.find((window) => window.windowHandle === snapshot.activeWindowHandle)
    ?? snapshot?.windows.find((window) => window.active)
    ?? null;
  const model = useMemo(() => buildInterfaceModel(snapshot), [snapshot]);
  const currentVisual = visual?.windowHandle === snapshot?.activeWindowHandle ? visual : null;
  const adapterKind = activeWindow ? getAppAdapterKind(activeWindow.process, activeWindow.title) : null;

  const activate = (control: SemanticControl) => {
    if (!control.interactive && control.source !== 'vision') return;
    onInput({ kind: 'tap', x: control.x, y: control.y });
    setTimeout(onRefresh, 420);
  };

  if (!snapshot) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.primaryBright} />
        <Text style={styles.stateTitle}>Reading the selected application</Text>
      </View>
    );
  }

  if (!snapshot.activeProcessId || !activeWindow) {
    return (
      <View style={styles.centerState}>
        <View style={styles.chooseIcon}><Text style={styles.chooseMark}>Apps</Text></View>
        <Text style={styles.stateTitle}>{hostOnline ? 'Choose an application' : 'Your PC is offline'}</Text>
        <Text style={styles.stateBody}>
          Open Apps above and select the Windows application you want transformed for your phone.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.document}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleBar}>
        <RemoteIcon iconKey={activeWindow.iconKey} icons={icons} size={38} radius={10} active />
        <View style={styles.titleCopy}>
          <Text style={styles.applicationName}>{friendlyProcess(activeWindow.process)}</Text>
          <Text style={styles.windowTitle} numberOfLines={2}>{model.title}</Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.syncButton} accessibilityLabel="Refresh application interface">
          <Text style={styles.syncText}>↻</Text>
        </Pressable>
      </View>

      {adapterKind === 'file-explorer' ? (
        <FileExplorerApplication snapshot={snapshot} onInput={onInput} onRefresh={onRefresh} />
      ) : adapterKind ? (
        <SpecializedApplication kind={adapterKind} snapshot={snapshot} visual={currentVisual} cameraStatus={cameraStatus} onInput={onInput} onCameraControl={onCameraControl} onRefresh={onRefresh} />
      ) : model.useVisualLayout ? (
        <VisualApplication snapshot={snapshot} visual={currentVisual} onInput={onInput} onRefresh={onRefresh} />
      ) : (
        <>
          {model.tabs.length ? <TabStrip controls={model.tabs} onActivate={activate} /> : null}
          {model.menus.length ? <MenuStrip controls={model.menus} onActivate={activate} /> : null}
          {model.toolbar.length ? <Toolbar controls={model.toolbar} onActivate={activate} /> : null}
          {model.sideNavigation.length ? <NavigationStrip controls={model.sideNavigation} onActivate={activate} /> : null}
          {model.mainSurface ? <MainSurface control={model.mainSurface} onInput={onInput} onRefresh={onRefresh} /> : null}
          {model.rows.map((row, index) => (
            <InterfaceRow key={`${row[0]?.id ?? 'row'}:${index}`} controls={row} onActivate={activate} onInput={onInput} onRefresh={onRefresh} />
          ))}
          {model.status.length ? <StatusBar controls={model.status} /> : null}
        </>
      )}
    </ScrollView>
  );
}

function FileExplorerApplication({ snapshot, onInput, onRefresh }: {
  snapshot: SemanticSnapshot;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}) {
  const controls = snapshot.controls.filter((control) => control.source === 'accessibility');
  const address = controls.find((control) => control.kind === 'Edit' && /address bar/i.test(control.label));
  const search = controls.find((control) => control.kind === 'Edit' && /^search/i.test(control.label));
  const navigation = uniqueByLabel(controls.filter((control) =>
    control.kind === 'Button' && control.top < 0.13 && /^(back|forward|up to |refresh)/i.test(control.label),
  ));
  const commands = uniqueByLabel(controls.filter((control) =>
    control.kind === 'Button' && control.top >= 0.12 && control.top < 0.23 &&
    /^(new|cut|copy|paste|rename|share|delete|sort|view|filter|more options|details)$/i.test(control.label),
  ));
  const contentTabs = uniqueByLabel(controls.filter((control) => control.kind === 'TabItem' && control.top > 0.2));
  const items = uniqueByLabel(controls.filter((control) => control.kind === 'ListItem' && control.top > 0.2));
  const status = controls.find((control) => control.kind === 'Text' && control.top > 0.92 && /\d+\s+items?/i.test(control.label));

  const activate = (control: SemanticControl, kind: 'tap' | 'doubleClick' = 'tap') => {
    onInput({ kind, x: control.x, y: control.y });
    setTimeout(onRefresh, kind === 'doubleClick' ? 700 : 420);
  };

  return (
    <View style={styles.explorerSurface}>
      <View style={styles.explorerNavRow}>
        {navigation.map((control) => (
          <Pressable key={control.id} disabled={!control.enabled} onPress={() => activate(control)} style={[styles.explorerNavButton, !control.enabled && styles.disabled]}>
            <Text style={styles.explorerNavText}>{explorerNavLabel(control.label)}</Text>
          </Pressable>
        ))}
      </View>

      {address ? <ExplorerField key={address.id} control={address} placeholder="Type a folder path" action="Go" onInput={onInput} onRefresh={onRefresh} /> : null}
      {search ? <ExplorerField key={search.id} control={search} placeholder={search.label} action="Search" onInput={onInput} onRefresh={onRefresh} submit /> : null}

      {commands.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.explorerCommands} contentContainerStyle={styles.explorerCommandsContent}>
          {commands.map((control) => (
            <Pressable key={control.id} disabled={!control.enabled} onPress={() => activate(control)} style={[styles.explorerCommand, !control.enabled && styles.disabled]}>
              <Text style={styles.explorerCommandText}>{control.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {contentTabs.length ? (
        <View style={styles.explorerTabs}>
          {contentTabs.map((control) => (
            <Pressable key={control.id} onPress={() => activate(control)} style={[styles.explorerTab, control.selected && styles.explorerTabSelected]}>
              <Text style={[styles.explorerTabText, control.selected && styles.explorerTabTextSelected]}>{control.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.explorerListHeader}>
        <Text style={styles.explorerListTitle}>{explorerSectionTitle(items)}</Text>
        {status ? <Text style={styles.explorerCount}>{status.label}</Text> : null}
      </View>
      {items.length ? items.map((item) => {
        const detail = explorerItemDetail(item, controls);
        return (
          <Pressable
            key={item.id}
            onPress={() => activate(item, 'doubleClick')}
            onLongPress={() => activate(item)}
            style={[styles.explorerItem, item.selected && styles.explorerItemSelected]}
          >
            <View style={styles.explorerItemIcon}><Text style={styles.explorerItemIconText}>{/\.[a-z0-9]{1,8}$/i.test(item.label) ? 'F' : 'D'}</Text></View>
            <View style={styles.explorerItemCopy}>
              <Text style={styles.explorerItemTitle} numberOfLines={2}>{item.label}</Text>
              {detail ? <Text style={styles.explorerItemDetail} numberOfLines={2}>{detail}</Text> : null}
            </View>
            <Text style={styles.explorerOpen}>OPEN</Text>
          </Pressable>
        );
      }) : (
        <View style={styles.explorerEmpty}><Text style={styles.explorerEmptyText}>This folder has no exposed items.</Text></View>
      )}
      <Text style={styles.explorerHint}>Tap to open. Press and hold to select.</Text>
    </View>
  );
}

function ExplorerField({ control, placeholder, action, onInput, onRefresh, submit = false }: {
  control: SemanticControl;
  placeholder: string;
  action: string;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
  submit?: boolean;
}) {
  const [value, setValue] = useState(control.value.trim());
  const update = () => {
    if (!value.trim()) return;
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: value.trim() });
    if (submit) setTimeout(() => onInput({ kind: 'key', key: 'Enter' }), 180);
    setTimeout(onRefresh, 700);
  };
  return (
    <View style={styles.explorerField}>
      <TextInput value={value} onChangeText={setValue} onSubmitEditing={update} placeholder={placeholder} placeholderTextColor="#7C8798" style={styles.explorerFieldInput} autoCorrect={false} returnKeyType={submit ? 'search' : 'go'} />
      <Pressable onPress={update} style={styles.explorerFieldButton}><Text style={styles.explorerFieldButtonText}>{action}</Text></Pressable>
    </View>
  );
}

function uniqueByLabel(controls: SemanticControl[]): SemanticControl[] {
  const labels = new Set<string>();
  return controls.filter((control) => {
    const label = control.label.trim().toLocaleLowerCase();
    if (!label || labels.has(label)) return false;
    labels.add(label);
    return true;
  }).sort(verticalOrder);
}

function explorerNavLabel(label: string): string {
  if (/^up to /i.test(label)) return 'Up';
  if (/^refresh/i.test(label)) return 'Refresh';
  return label;
}

function explorerSectionTitle(items: SemanticControl[]): string {
  const section = items.find((item) => item.section && !/shell folder view/i.test(item.section))?.section;
  return section || 'Files and folders';
}

function explorerItemDetail(item: SemanticControl, controls: SemanticControl[]): string {
  return controls.find((control) =>
    control.kind === 'Text' && control.section === item.label && control.label !== item.label &&
    !/^(text|name|activity|account|stored locally)$/i.test(control.label),
  )?.label ?? controls.find((control) =>
    control.kind === 'Text' && control.section === item.label && /stored locally/i.test(control.label),
  )?.label ?? '';
}

function TabStrip({ controls, onActivate }: { controls: SemanticControl[]; onActivate: (control: SemanticControl) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabStrip} contentContainerStyle={styles.tabStripContent}>
      {controls.map((control) => {
        const tab = tabParts(control.label);
        return (
          <Pressable key={control.id} onPress={() => onActivate(control)} style={[styles.appTab, (control.selected || control.focused) && styles.appTabActive]}>
            <Text style={[styles.appTabText, (control.selected || control.focused) && styles.appTabTextActive]} numberOfLines={1}>{tab.title}</Text>
            {tab.modified ? <View style={styles.modifiedDot} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function MenuStrip({ controls, onActivate }: { controls: SemanticControl[]; onActivate: (control: SemanticControl) => void }) {
  return (
    <View style={styles.menuStrip}>
      {controls.map((control) => (
        <Pressable key={control.id} onPress={() => onActivate(control)} style={styles.menuItem}>
          <Text style={styles.menuText}>{control.label}</Text>
          {control.expanded !== null ? <Text style={styles.menuChevron}>⌄</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function Toolbar({ controls, onActivate }: { controls: SemanticControl[]; onActivate: (control: SemanticControl) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
      {controls.map((control) => (
        <Pressable key={control.id} disabled={!control.enabled} onPress={() => onActivate(control)} style={[styles.toolButton, (control.checked || control.selected) && styles.toolButtonActive, !control.enabled && styles.disabled]}>
          <Text style={[styles.toolText, (control.checked || control.selected) && styles.toolTextActive]} numberOfLines={2}>{shortActionLabel(control.label)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function NavigationStrip({ controls, onActivate }: { controls: SemanticControl[]; onActivate: (control: SemanticControl) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navigation} contentContainerStyle={styles.navigationContent}>
      {controls.map((control) => (
        <Pressable key={control.id} onPress={() => onActivate(control)} style={[styles.navigationItem, control.selected && styles.navigationItemActive]}>
          <Text style={[styles.navigationText, control.selected && styles.navigationTextActive]} numberOfLines={1}>{control.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function MainSurface({ control, onInput, onRefresh }: { control: SemanticControl; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  if (control.editable) return <EditorSurface control={control} onInput={onInput} onRefresh={onRefresh} />;
  const content = readableValue(control);
  if (!content) return null;
  return <View style={styles.readerSurface}><Text style={styles.readerText} selectable>{content}</Text></View>;
}

function EditorSurface({ control, onInput, onRefresh }: { control: SemanticControl; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  const initial = readableValue(control);
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setDraft(initial); }, [dirty, initial]);

  const apply = () => {
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: draft });
    setDirty(false);
    setTimeout(onRefresh, 650);
  };

  return (
    <View style={styles.editorSurface}>
      <View style={styles.editorHeader}>
        <Text style={styles.editorLabel}>{friendlyEditorLabel(control.label)}</Text>
        <Pressable disabled={!dirty} onPress={apply} style={[styles.applyButton, !dirty && styles.disabled]}><Text style={styles.applyText}>Apply</Text></Pressable>
      </View>
      <TextInput value={draft} onChangeText={(value) => { setDraft(value); setDirty(value !== initial); }} multiline textAlignVertical="top" autoCorrect={false} spellCheck={false} style={styles.editorInput} placeholder="This application has not exposed its current text yet." placeholderTextColor="#7C8492" />
    </View>
  );
}

function InterfaceRow({ controls, onActivate, onInput, onRefresh }: {
  controls: SemanticControl[];
  onActivate: (control: SemanticControl) => void;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}) {
  if (controls.length === 1) {
    const control = controls[0];
    if (control.category === 'field') return <InlineField control={control} onInput={onInput} onRefresh={onRefresh} />;
    if (control.category === 'option') return <OptionRow control={control} onActivate={onActivate} />;
    if (control.category === 'content') return <ContentBlock control={control} onActivate={onActivate} />;
    if (control.category === 'navigation') return <ListRow control={control} onActivate={onActivate} />;
    return <PrimaryAction control={control} onActivate={onActivate} />;
  }

  if (controls.every((control) => control.category === 'content')) {
    return <View style={styles.contentGroup}>{controls.map((control) => <ContentBlock key={control.id} control={control} onActivate={onActivate} compact />)}</View>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.interfaceRow} contentContainerStyle={styles.interfaceRowContent}>
      {controls.map((control) => (
        <Pressable key={control.id} disabled={!control.enabled} onPress={() => onActivate(control)} style={[styles.rowAction, !control.enabled && styles.disabled]}>
          <Text style={styles.rowActionText} numberOfLines={3}>{control.label}</Text>
          {control.value && control.value !== control.label ? <Text style={styles.rowActionValue} numberOfLines={2}>{control.value}</Text> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function InlineField({ control, onInput, onRefresh }: { control: SemanticControl; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  const initial = readableValue(control);
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [control.id, initial]);
  const update = () => {
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: value });
    setTimeout(onRefresh, 500);
  };
  return (
    <View style={styles.fieldSurface}>
      <Text style={styles.fieldLabel}>{friendlyEditorLabel(control.label)}</Text>
      <View style={styles.fieldLine}>
        <TextInput value={value} onChangeText={setValue} onSubmitEditing={update} style={styles.fieldInput} placeholder={control.description || control.label} placeholderTextColor={colors.textMuted} />
        <Pressable onPress={update} style={styles.fieldAction}><Text style={styles.fieldActionText}>Update</Text></Pressable>
      </View>
    </View>
  );
}

function OptionRow({ control, onActivate }: { control: SemanticControl; onActivate: (control: SemanticControl) => void }) {
  return (
    <Pressable onPress={() => onActivate(control)} style={styles.optionRow}>
      <View style={styles.optionCopy}><Text style={styles.optionTitle}>{control.label}</Text>{control.description ? <Text style={styles.optionDescription}>{control.description}</Text> : null}</View>
      <Switch value={control.checked ?? control.selected} onValueChange={() => onActivate(control)} trackColor={{ false: '#B4BAC4', true: colors.primary }} />
    </Pressable>
  );
}

function ContentBlock({ control, onActivate, compact = false }: { control: SemanticControl; onActivate: (control: SemanticControl) => void; compact?: boolean }) {
  const content = readableValue(control);
  if (!content) return null;
  return (
    <Pressable disabled={!control.interactive} onPress={() => onActivate(control)} style={[styles.contentBlock, compact && styles.contentBlockCompact, control.interactive && styles.contentBlockInteractive]}>
      <Text style={[styles.contentText, isHeading(control) && styles.contentHeading]} selectable={!control.interactive}>{content}</Text>
      {control.description && control.description !== 'Detected on screen' ? <Text style={styles.contentDescription}>{control.description}</Text> : null}
    </Pressable>
  );
}

function ListRow({ control, onActivate }: { control: SemanticControl; onActivate: (control: SemanticControl) => void }) {
  return (
    <Pressable onPress={() => onActivate(control)} style={[styles.listRow, control.selected && styles.listRowSelected]}>
      <View style={styles.listBullet} />
      <View style={styles.listCopy}><Text style={styles.listTitle}>{control.label}</Text>{control.value && control.value !== control.label ? <Text style={styles.listValue}>{control.value}</Text> : null}</View>
      <Text style={styles.listChevron}>›</Text>
    </Pressable>
  );
}

function PrimaryAction({ control, onActivate }: { control: SemanticControl; onActivate: (control: SemanticControl) => void }) {
  return <Pressable disabled={!control.enabled} onPress={() => onActivate(control)} style={[styles.primaryAction, !control.enabled && styles.disabled]}><Text style={styles.primaryActionText}>{control.label}</Text></Pressable>;
}

function StatusBar({ controls }: { controls: SemanticControl[] }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusBar} contentContainerStyle={styles.statusContent}>{controls.map((control) => <Text key={control.id} style={styles.statusText}>{readableValue(control)}</Text>)}</ScrollView>;
}

function VisualApplication({ snapshot, visual, onInput, onRefresh }: { snapshot: SemanticSnapshot; visual: AppVisual | null; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  const { width: screenWidth } = useWindowDimensions();
  const regions = useMemo(() => buildVisualRegions(snapshot.controls, visual), [snapshot.controls, visual]);
  const contentWidth = Math.max(280, screenWidth - 24);

  if (!visual) {
    return (
      <View style={styles.visualLoading}>
        <ActivityIndicator color={colors.primaryBright} />
        <Text style={styles.stateTitle}>Reflowing the application interface</Text>
        <Text style={styles.stateBody}>Capturing the selected window and arranging its real visual regions for this screen.</Text>
      </View>
    );
  }

  return <View style={styles.visualDocument}>{regions.map((region) => <VisualCrop key={region.id} visual={visual} region={region} width={contentWidth} snapshot={snapshot} onInput={onInput} onRefresh={onRefresh} />)}</View>;
}

function VisualCrop({ visual, region, width, snapshot, onInput, onRefresh }: { visual: AppVisual; region: VisualRegion; width: number; snapshot: SemanticSnapshot; onInput: (command: InputCommand) => void; onRefresh: () => void }) {
  const scale = width / Math.max(1, region.width * visual.width);
  const imageWidth = visual.width * scale;
  const imageHeight = visual.height * scale;
  const cropHeight = Math.max(72, region.height * visual.height * scale);
  const imageLeft = -region.left * visual.width * scale;
  const imageTop = -region.top * visual.height * scale;

  const press = (event: GestureResponderEvent) => {
    const regionX = clamp01(event.nativeEvent.locationX / width);
    const regionY = clamp01(event.nativeEvent.locationY / cropHeight);
    const windowX = region.left + regionX * region.width;
    const windowY = region.top + regionY * region.height;
    onInput({ kind: 'tap', x: clamp01(snapshot.windowFrame.x + windowX * snapshot.windowFrame.width), y: clamp01(snapshot.windowFrame.y + windowY * snapshot.windowFrame.height) });
    setTimeout(onRefresh, 420);
  };

  return (
    <Pressable onPress={press} style={[styles.visualCrop, { width, height: cropHeight }]} accessibilityLabel={region.label}>
      <Image source={{ uri: visual.dataUri }} style={{ position: 'absolute', width: imageWidth, height: imageHeight, left: imageLeft, top: imageTop }} resizeMode="stretch" />
    </Pressable>
  );
}

function buildInterfaceModel(snapshot: SemanticSnapshot | null): InterfaceModel {
  if (!snapshot) return emptyModel('Application');
  const controls = snapshot.controls.filter((control) => control.source === 'accessibility' && useful(control));
  const meaningful = controls.filter((control) => control.interactive || control.editable || readableValue(control));
  const useVisualLayout = snapshot.adapter === 'vision' || snapshot.adapter === 'basic' ||
    (snapshot.adapter === 'hybrid' && snapshot.accessibilityCount < 12) || meaningful.length < 4;
  if (useVisualLayout) return { ...emptyModel(snapshot.activeTitle), useVisualLayout: true };

  const mainSurface = [...controls].filter((control) => ['Document', 'Edit'].includes(control.kind) && control.width * control.height > 0.07).sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
  const mainTop = mainSurface?.top ?? 0.52;
  const mainBottom = mainSurface ? mainSurface.top + mainSurface.height : 0.82;
  const tabs = controls.filter((control) => control.kind === 'TabItem').sort(horizontalOrder);
  const menus = controls.filter((control) => control.kind === 'MenuItem' && control.top < Math.max(0.38, mainTop)).sort(horizontalOrder);
  const reserved = new Set([...tabs, ...menus].map((control) => control.id));
  if (mainSurface) reserved.add(mainSurface.id);

  const toolbar = controls.filter((control) => !reserved.has(control.id) && control.interactive && ['Button', 'SplitButton', 'ComboBox', 'CheckBox', 'RadioButton', 'Slider', 'Spinner'].includes(control.kind) && control.top < mainTop + 0.015).sort(horizontalOrder);
  toolbar.forEach((control) => reserved.add(control.id));
  const sideNavigation = controls.filter((control) => !reserved.has(control.id) && ['TreeItem', 'ListItem', 'DataItem', 'Hyperlink'].includes(control.kind) && (!mainSurface || control.left + control.width <= mainSurface.left + 0.04)).sort(verticalOrder);
  sideNavigation.forEach((control) => reserved.add(control.id));
  const status = controls.filter((control) => !reserved.has(control.id) && control.category === 'content' && (control.top >= mainBottom - 0.015 || control.top > 0.86) && control.height < 0.08).sort(horizontalOrder);
  status.forEach((control) => reserved.add(control.id));
  const remaining = controls.filter((control) => !reserved.has(control.id) && (!mainSurface || !contains(mainSurface, control)));

  return { title: snapshot.activeTitle, tabs, menus, toolbar, sideNavigation, mainSurface, rows: groupRows(remaining), status, useVisualLayout: false };
}

function emptyModel(title: string): InterfaceModel {
  return { title, tabs: [], menus: [], toolbar: [], sideNavigation: [], mainSurface: null, rows: [], status: [], useVisualLayout: false };
}

function groupRows(controls: SemanticControl[]): SemanticControl[][] {
  const sorted = [...controls].sort(verticalOrder);
  const rows: SemanticControl[][] = [];
  for (const control of sorted) {
    const last = rows[rows.length - 1];
    if (!last) { rows.push([control]); continue; }
    const averageTop = last.reduce((sum, item) => sum + item.top + item.height / 2, 0) / last.length;
    const center = control.top + control.height / 2;
    const tolerance = Math.max(0.018, Math.min(0.06, control.height * 0.7));
    if (Math.abs(center - averageTop) <= tolerance) last.push(control);
    else rows.push([control]);
  }
  return rows.map((row) => row.sort(horizontalOrder)).filter((row) => row.some(useful)).slice(0, 90);
}

function buildVisualRegions(controls: SemanticControl[], visual: AppVisual | null): VisualRegion[] {
  const vision = controls.filter((control) => control.source === 'vision' && useful(control)).sort(verticalOrder);
  const groups: SemanticControl[][] = [];
  for (const control of vision) {
    const last = groups[groups.length - 1];
    if (!last) { groups.push([control]); continue; }
    const bounds = union(last);
    const verticalGap = control.top - (bounds.top + bounds.height);
    const sameColumn = horizontalOverlap(bounds, control) > 0.18 || Math.abs(control.left - bounds.left) < 0.08;
    if (verticalGap < 0.035 && sameColumn) last.push(control);
    else groups.push([control]);
  }

  const regions = groups.map((group, index) => {
    const bounds = union(group);
    const horizontalPadding = Math.max(0.025, Math.min(0.08, (0.62 - bounds.width) / 2));
    const left = clamp01(bounds.left - horizontalPadding);
    const right = clamp01(bounds.left + bounds.width + horizontalPadding);
    const top = clamp01(bounds.top - 0.022);
    const bottom = clamp01(bounds.top + bounds.height + 0.028);
    return { id: `visual:${index}`, left, top, width: Math.max(0.12, right - left), height: Math.max(0.055, bottom - top), label: group.map((control) => control.label).join(' ').slice(0, 180) || 'Application region' };
  });

  if (regions.length >= 2) return mergeRegions(regions).slice(0, 24);
  if (!visual) return [];
  if (visual.width / visual.height > 1.3) {
    return [
      { id: 'visual:grid:0', left: 0, top: 0, width: 0.54, height: 0.5, label: 'Upper-left application region' },
      { id: 'visual:grid:1', left: 0.46, top: 0, width: 0.54, height: 0.5, label: 'Upper-right application region' },
      { id: 'visual:grid:2', left: 0, top: 0.46, width: 0.54, height: 0.54, label: 'Lower-left application region' },
      { id: 'visual:grid:3', left: 0.46, top: 0.46, width: 0.54, height: 0.54, label: 'Lower-right application region' },
    ];
  }
  return [
    { id: 'visual:top', left: 0, top: 0, width: 1, height: 0.52, label: 'Upper application region' },
    { id: 'visual:bottom', left: 0, top: 0.48, width: 1, height: 0.52, label: 'Lower application region' },
  ];
}

function mergeRegions(regions: VisualRegion[]): VisualRegion[] {
  const merged: VisualRegion[] = [];
  for (const region of regions) {
    const previous = merged[merged.length - 1];
    if (previous && region.top <= previous.top + previous.height + 0.018 && horizontalOverlap(previous, region) > 0.25) {
      const left = Math.min(previous.left, region.left);
      const top = Math.min(previous.top, region.top);
      const right = Math.max(previous.left + previous.width, region.left + region.width);
      const bottom = Math.max(previous.top + previous.height, region.top + region.height);
      previous.left = left;
      previous.top = top;
      previous.width = right - left;
      previous.height = bottom - top;
      previous.label = `${previous.label} ${region.label}`.slice(0, 180);
    } else merged.push({ ...region });
  }
  return merged;
}

function union(items: SemanticControl[]): { left: number; top: number; width: number; height: number } {
  const left = Math.min(...items.map((item) => item.left));
  const top = Math.min(...items.map((item) => item.top));
  const right = Math.max(...items.map((item) => item.left + item.width));
  const bottom = Math.max(...items.map((item) => item.top + item.height));
  return { left, top, width: right - left, height: bottom - top };
}

function horizontalOverlap(a: { left: number; width: number }, b: { left: number; width: number }): number {
  const intersection = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  return intersection / Math.max(0.001, Math.min(a.width, b.width));
}

function contains(container: SemanticControl, item: SemanticControl): boolean {
  const centerX = item.left + item.width / 2;
  const centerY = item.top + item.height / 2;
  return centerX >= container.left && centerX <= container.left + container.width && centerY >= container.top && centerY <= container.top + container.height;
}

function useful(control: SemanticControl): boolean {
  const label = readableValue(control);
  if (control.kind === 'Image' && !control.interactive) return false;
  if (control.category === 'action' && !control.interactive && !control.editable) return false;
  return label.length > 0 && !/^(pane|group|custom|window|image|text|control)$/i.test(label);
}

function readableValue(control: SemanticControl): string {
  const value = control.value.trim();
  if (value && value !== control.label.trim()) return value.replace(/\r\n?/g, '\n').trim();
  return control.label.replace(/\s+/g, ' ').trim();
}

function isHeading(control: SemanticControl): boolean {
  return control.kind === 'HeaderItem' || control.height > 0.05 || (control.label.length < 60 && control.depth < 4);
}

function horizontalOrder(a: SemanticControl, b: SemanticControl): number { return a.left - b.left || a.top - b.top || a.order - b.order; }
function verticalOrder(a: SemanticControl, b: SemanticControl): number { return a.top - b.top || a.left - b.left || a.order - b.order; }

function tabParts(label: string): { title: string; modified: boolean } {
  const modified = /\. Modified\.?$/i.test(label);
  return { title: label.replace(/\. (?:Unmodified|Modified)\.?$/i, '').trim(), modified };
}

function shortActionLabel(label: string): string { return label.replace(/\s*\([^)]*(?:Ctrl|Alt|Shift|⌘)[^)]*\)\s*$/i, '').trim(); }
function friendlyEditorLabel(label: string): string { return /^(text editor|document|edit)$/i.test(label.trim()) ? 'Document' : label; }
function friendlyProcess(process: string): string { return process.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F3F5F8' },
  document: { paddingBottom: 36 },
  titleBar: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#D9DEE7', flexDirection: 'row', alignItems: 'center' },
  titleCopy: { flex: 1, marginLeft: 10 },
  applicationName: { color: '#667085', fontSize: 10, fontWeight: '700' },
  windowTitle: { color: '#101828', fontSize: 14, lineHeight: 18, fontWeight: '800', marginTop: 2 },
  syncButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF1F6', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  syncText: { color: '#344054', fontSize: 22, fontWeight: '700', marginTop: -2 },
  centerState: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 34 },
  chooseIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  chooseMark: { color: colors.primaryBright, fontSize: 14, fontWeight: '900' },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  stateBody: { color: colors.textMuted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7, maxWidth: 310 },
  tabStrip: { backgroundColor: '#E9EDF3', borderBottomWidth: 1, borderBottomColor: '#D3D9E3' },
  tabStripContent: { paddingHorizontal: 8, paddingTop: 7, gap: 5 },
  appTab: { maxWidth: 230, minHeight: 42, borderTopLeftRadius: 10, borderTopRightRadius: 10, paddingHorizontal: 13, backgroundColor: '#DDE2EA', flexDirection: 'row', alignItems: 'center' },
  appTabActive: { backgroundColor: '#FFFFFF' },
  appTabText: { color: '#596273', fontSize: 11, fontWeight: '700', maxWidth: 190 },
  appTabTextActive: { color: '#101828' },
  modifiedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginLeft: 7 },
  menuStrip: { minHeight: 48, paddingHorizontal: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E6ED', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  menuItem: { minHeight: 40, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  menuText: { color: '#202939', fontSize: 13, fontWeight: '600' },
  menuChevron: { color: '#667085', fontSize: 12, marginLeft: 5 },
  toolbar: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#DDE2EA' },
  toolbarContent: { paddingHorizontal: 9, paddingVertical: 8, gap: 7 },
  toolButton: { minWidth: 48, maxWidth: 112, minHeight: 44, borderRadius: 10, backgroundColor: '#F3F5F8', borderWidth: 1, borderColor: '#E1E6ED', paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  toolButtonActive: { backgroundColor: '#E9E5FF', borderColor: colors.primary },
  toolText: { color: '#344054', fontSize: 10, lineHeight: 13, fontWeight: '700', textAlign: 'center' },
  toolTextActive: { color: '#593FD1' },
  navigation: { backgroundColor: '#F8F9FB', borderBottomWidth: 1, borderBottomColor: '#DDE2EA' },
  navigationContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 7 },
  navigationItem: { minHeight: 38, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D9DEE7', justifyContent: 'center', paddingHorizontal: 14 },
  navigationItemActive: { backgroundColor: '#201A3A', borderColor: '#201A3A' },
  navigationText: { color: '#344054', fontSize: 11, fontWeight: '700' },
  navigationTextActive: { color: '#FFFFFF' },
  editorSurface: { flex: 1, minHeight: 520, backgroundColor: '#FFFFFF' },
  editorHeader: { height: 52, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', flexDirection: 'row', alignItems: 'center' },
  editorLabel: { flex: 1, color: '#475467', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  applyButton: { height: 36, borderRadius: 10, backgroundColor: colors.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  editorInput: { minHeight: 468, backgroundColor: '#FFFFFF', color: '#101828', paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, lineHeight: 24, fontFamily: 'monospace' },
  readerSurface: { minHeight: 300, backgroundColor: '#FFFFFF', paddingHorizontal: 17, paddingVertical: 18 },
  readerText: { color: '#101828', fontSize: 16, lineHeight: 25 },
  fieldSurface: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', padding: 13 },
  fieldLabel: { color: '#344054', fontSize: 12, fontWeight: '800', marginBottom: 7 },
  fieldLine: { flexDirection: 'row', gap: 8 },
  fieldInput: { flex: 1, minHeight: 46, borderRadius: 10, backgroundColor: '#F8F9FB', borderWidth: 1, borderColor: '#D6DBE4', color: '#101828', paddingHorizontal: 12, fontSize: 14 },
  fieldAction: { minHeight: 46, borderRadius: 10, backgroundColor: '#202939', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  fieldActionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  interfaceRow: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E7EAF0' },
  interfaceRowContent: { padding: 10, gap: 8 },
  rowAction: { width: 142, minHeight: 72, borderRadius: 12, backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: '#E0E4EA', padding: 11, justifyContent: 'center' },
  rowActionText: { color: '#202939', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  rowActionValue: { color: '#667085', fontSize: 10, lineHeight: 14, marginTop: 5 },
  optionRow: { minHeight: 64, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  optionCopy: { flex: 1, marginRight: 12 },
  optionTitle: { color: '#202939', fontSize: 14, fontWeight: '700' },
  optionDescription: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 3 },
  contentGroup: { backgroundColor: '#FFFFFF' },
  contentBlock: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#ECEEF2' },
  contentBlockCompact: { paddingVertical: 8 },
  contentBlockInteractive: { paddingRight: 32 },
  contentText: { color: '#344054', fontSize: 14, lineHeight: 21 },
  contentHeading: { color: '#101828', fontSize: 18, lineHeight: 24, fontWeight: '800' },
  contentDescription: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 5 },
  listRow: { minHeight: 62, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E7EAF0', paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center' },
  listRowSelected: { backgroundColor: '#F0EDFF' },
  listBullet: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#E9EDF3', marginRight: 11 },
  listCopy: { flex: 1 },
  listTitle: { color: '#202939', fontSize: 14, fontWeight: '700' },
  listValue: { color: '#667085', fontSize: 11, marginTop: 3 },
  listChevron: { color: '#98A2B3', fontSize: 24, marginLeft: 8 },
  primaryAction: { minHeight: 54, marginHorizontal: 12, marginVertical: 7, borderRadius: 12, backgroundColor: '#202939', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  primaryActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  statusBar: { backgroundColor: '#EEF1F5', borderTopWidth: 1, borderTopColor: '#D8DDE5' },
  statusContent: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', gap: 16 },
  statusText: { color: '#5D6675', fontSize: 10, fontWeight: '600' },
  visualLoading: { minHeight: 360, margin: 12, borderRadius: radii.large, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 30 },
  visualDocument: { paddingHorizontal: 12, paddingTop: 12, gap: 12 },
  visualCrop: { backgroundColor: '#111827', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#CBD2DC' },
  explorerSurface: { backgroundColor: '#F3F5F8', paddingBottom: 28 },
  explorerNavRow: { minHeight: 54, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', gap: 7, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E6ED' },
  explorerNavButton: { minWidth: 64, minHeight: 40, borderRadius: 11, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  explorerNavText: { color: '#344054', fontSize: 11, fontWeight: '800' },
  explorerField: { minHeight: 58, marginHorizontal: 10, marginTop: 9, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6DBE4', padding: 6, flexDirection: 'row', alignItems: 'center' },
  explorerFieldInput: { flex: 1, minHeight: 44, color: '#101828', fontSize: 14, paddingHorizontal: 11 },
  explorerFieldButton: { height: 42, minWidth: 66, borderRadius: 10, backgroundColor: '#202939', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  explorerFieldButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  explorerCommands: { marginTop: 10, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#E1E5EB' },
  explorerCommandsContent: { paddingHorizontal: 10, paddingVertical: 9, gap: 7 },
  explorerCommand: { minHeight: 43, minWidth: 64, maxWidth: 116, borderRadius: 11, backgroundColor: '#F2F4F7', borderWidth: 1, borderColor: '#E0E4EA', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  explorerCommandText: { color: '#344054', fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' },
  explorerTabs: { paddingHorizontal: 10, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  explorerTab: { minHeight: 38, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D8DDE6', paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  explorerTabSelected: { backgroundColor: '#201A3A', borderColor: '#201A3A' },
  explorerTabText: { color: '#475467', fontSize: 11, fontWeight: '800' },
  explorerTabTextSelected: { color: '#FFFFFF' },
  explorerListHeader: { paddingHorizontal: 14, paddingTop: 20, paddingBottom: 9, flexDirection: 'row', alignItems: 'center' },
  explorerListTitle: { flex: 1, color: '#101828', fontSize: 18, fontWeight: '900' },
  explorerCount: { color: '#667085', fontSize: 10, fontWeight: '700' },
  explorerItem: { minHeight: 74, marginHorizontal: 10, marginBottom: 8, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE3E9', padding: 10, flexDirection: 'row', alignItems: 'center' },
  explorerItemSelected: { backgroundColor: '#F0EDFF', borderColor: colors.primary },
  explorerItemIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E9EDF3', alignItems: 'center', justifyContent: 'center' },
  explorerItemIconText: { color: '#5B6472', fontSize: 13, fontWeight: '900' },
  explorerItemCopy: { flex: 1, marginHorizontal: 11 },
  explorerItemTitle: { color: '#202939', fontSize: 14, lineHeight: 18, fontWeight: '800' },
  explorerItemDetail: { color: '#667085', fontSize: 10, lineHeight: 14, marginTop: 3 },
  explorerOpen: { color: '#6941C6', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  explorerEmpty: { minHeight: 120, marginHorizontal: 10, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  explorerEmptyText: { color: '#667085', fontSize: 12 },
  explorerHint: { color: '#7A8493', fontSize: 9, textAlign: 'center', marginTop: 8 },
  disabled: { opacity: 0.42 },
});
