import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutAnimation,
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
import type { AppVisual, CameraControlCommand, CameraPtzStatus, FileBrowserSnapshot, FileDownloadState, FileOperationRequest, FileOperationState, InputCommand, SemanticControl, SemanticSnapshot } from '../types';
import { getAppAdapterKind, SpecializedApplication } from './AppAdapters';
import { FileExplorerApplication } from './FileExplorerApplication';
import { RemoteIcon } from './RemoteIcon';

interface Props {
  snapshot: SemanticSnapshot | null;
  visual: AppVisual | null;
  cameraStatus: CameraPtzStatus | null;
  hostOnline: boolean;
  icons: Record<string, string>;
  fileSnapshot: FileBrowserSnapshot | null;
  fileThumbnails: Record<string, string>;
  fileLoading: boolean;
  fileError: string | null;
  fileOperation: FileOperationState | null;
  fileDownload: FileDownloadState | null;
  onInput: (command: InputCommand) => void;
  onCameraControl: (command: CameraControlCommand) => void;
  onRefresh: () => void;
  onBrowseFiles: (directoryId: string | null) => void;
  onRequestFileThumbnails: (ids: string[]) => void;
  onFileOperation: (operation: FileOperationRequest) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onShareDownloadedFile: () => Promise<void>;
  onClearFileOperation: () => void;
  onClearFileDownload: () => void;
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
  fileSnapshot,
  fileThumbnails,
  fileLoading,
  fileError,
  fileOperation,
  fileDownload,
  onInput,
  onCameraControl,
  onRefresh,
  onBrowseFiles,
  onRequestFileThumbnails,
  onFileOperation,
  onOpenFile,
  onDownloadFile,
  onShareDownloadedFile,
  onClearFileOperation,
  onClearFileDownload,
}: Props) {
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const activeWindow = snapshot?.windows.find((window) => window.windowHandle === snapshot.activeWindowHandle)
    ?? snapshot?.windows.find((window) => window.active)
    ?? null;
  const model = useMemo(() => buildInterfaceModel(snapshot), [snapshot]);
  const currentVisual = visual?.windowHandle === snapshot?.activeWindowHandle ? visual : null;
  const adapterKind = activeWindow ? getAppAdapterKind(activeWindow.process, activeWindow.title) : null;

  useEffect(() => setActionsExpanded(false), [snapshot?.activeWindowHandle]);

  const activate = (control: SemanticControl) => {
    if (!control.interactive && control.source !== 'vision') return;
    onInput({ kind: 'tap', x: control.x, y: control.y });
    setTimeout(onRefresh, 420);
  };

  const toggleActions = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActionsExpanded((current) => !current);
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
        <View style={styles.titleActions}>
          <Pressable onPress={onRefresh} style={styles.syncButton} accessibilityLabel="Refresh application interface">
            <Text style={styles.syncText}>↻</Text>
          </Pressable>
          <Pressable onPress={toggleActions} style={[styles.syncButton, actionsExpanded && styles.syncButtonActive]} accessibilityLabel="Show application controls" accessibilityState={{ expanded: actionsExpanded }}>
            <Text style={[styles.moreText, actionsExpanded && styles.moreTextActive]}>•••</Text>
          </Pressable>
        </View>
      </View>

      {actionsExpanded ? (
        <View style={styles.quickMenu}>
          <View style={styles.quickMenuHeader}><Text style={styles.quickMenuTitle}>Application controls</Text><Text style={styles.quickMenuHint}>Tap outside the app menu to collapse</Text></View>
          <Pressable onPress={onRefresh} style={styles.quickRefresh}><Text style={styles.quickRefreshGlyph}>↻</Text><Text style={styles.quickRefreshText}>Refresh interface</Text><Text style={styles.quickRefreshChevron}>›</Text></Pressable>
          {model.menus.length ? <MenuStrip controls={model.menus} onActivate={activate} /> : null}
          {model.toolbar.length ? <Toolbar controls={model.toolbar} onActivate={activate} /> : null}
        </View>
      ) : null}

      {adapterKind === 'file-explorer' ? (
        <FileExplorerApplication
          snapshot={fileSnapshot}
          thumbnails={fileThumbnails}
          loading={fileLoading}
          error={fileError}
          operation={fileOperation}
          download={fileDownload}
          onBrowse={onBrowseFiles}
          onRequestThumbnails={onRequestFileThumbnails}
          onOperate={onFileOperation}
          onOpen={onOpenFile}
          onDownload={onDownloadFile}
          onShareDownload={onShareDownloadedFile}
          onClearOperation={onClearFileOperation}
          onClearDownload={onClearFileDownload}
        />
      ) : adapterKind ? (
        <SpecializedApplication kind={adapterKind} snapshot={snapshot} visual={currentVisual} cameraStatus={cameraStatus} onInput={onInput} onCameraControl={onCameraControl} onRefresh={onRefresh} />
      ) : model.useVisualLayout ? (
        <VisualApplication snapshot={snapshot} visual={currentVisual} onInput={onInput} onRefresh={onRefresh} />
      ) : (
        <>
          {model.tabs.length ? <TabStrip controls={model.tabs} onActivate={activate} /> : null}
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

function LegacyFileExplorerApplication({ snapshot, onInput, onRefresh }: {
  snapshot: SemanticSnapshot;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
}) {
  const [locationExpanded, setLocationExpanded] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
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
  const folderName = explorerFolderName(snapshot.activeTitle, address?.value || address?.label || '');
  const location = (address?.value || address?.label || folderName).replace(/^address bar,?\s*/i, '').trim();

  const activate = (control: SemanticControl, kind: 'tap' | 'doubleClick' = 'tap') => {
    onInput({ kind, x: control.x, y: control.y });
    setTimeout(onRefresh, kind === 'doubleClick' ? 700 : 420);
  };

  const toggleLocation = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLocationExpanded((current) => !current);
  };

  const toggleActions = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActionsExpanded((current) => !current);
  };

  return (
    <View style={styles.explorerSurface}>
      <View style={styles.explorerHero}>
        <View style={styles.explorerHeroCopy}>
          <Text style={styles.explorerEyebrow}>Browse</Text>
          <Text style={styles.explorerTitle} numberOfLines={1}>{folderName}</Text>
        </View>
        <Pressable onPress={toggleActions} style={[styles.explorerMore, actionsExpanded && styles.explorerMoreActive]} accessibilityLabel="Show file actions" accessibilityState={{ expanded: actionsExpanded }}>
          <Text style={[styles.explorerMoreText, actionsExpanded && styles.explorerMoreTextActive]}>•••</Text>
        </Pressable>
      </View>

      <View style={styles.explorerNavRow}>
        {navigation.map((control) => (
          <Pressable key={control.id} disabled={!control.enabled} onPress={() => activate(control)} style={[styles.explorerNavButton, !control.enabled && styles.disabled]} accessibilityLabel={explorerNavLabel(control.label)}>
            <Text style={styles.explorerNavText}>{explorerNavGlyph(control.label)}</Text>
          </Pressable>
        ))}
        {address ? (
          <Pressable onPress={toggleLocation} style={[styles.explorerLocation, locationExpanded && styles.explorerLocationActive]} accessibilityState={{ expanded: locationExpanded }}>
            <Text style={styles.explorerLocationGlyph}>⌂</Text>
            <Text style={[styles.explorerLocationText, locationExpanded && styles.explorerLocationTextActive]} numberOfLines={1}>{location || folderName}</Text>
            <Text style={[styles.explorerLocationChevron, locationExpanded && styles.explorerLocationChevronActive]}>⌄</Text>
          </Pressable>
        ) : null}
      </View>

      {locationExpanded && address ? <ExplorerField key={address.id} control={address} placeholder="Enter a folder path" action="Go" onInput={onInput} onRefresh={onRefresh} /> : null}
      {search ? <ExplorerField key={search.id} control={search} placeholder={`Search ${folderName}`} action="Go" onInput={onInput} onRefresh={onRefresh} submit searchMode /> : null}

      {actionsExpanded && commands.length ? (
        <View style={styles.explorerActionsPanel}>
          <Text style={styles.explorerActionsTitle}>File actions</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.explorerCommands} contentContainerStyle={styles.explorerCommandsContent}>
            {commands.map((control) => (
              <Pressable key={control.id} disabled={!control.enabled} onPress={() => activate(control)} style={[styles.explorerCommand, !control.enabled && styles.disabled]}>
                <Text style={styles.explorerCommandGlyph}>{explorerCommandGlyph(control.label)}</Text>
                <Text style={styles.explorerCommandText} numberOfLines={1}>{control.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {contentTabs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.explorerTabsRail} contentContainerStyle={styles.explorerTabs}>
          {contentTabs.map((control) => (
              <Pressable key={control.id} onPress={() => activate(control)} style={[styles.explorerTab, control.selected && styles.explorerTabSelected]}>
                <Text style={[styles.explorerTabText, control.selected && styles.explorerTabTextSelected]}>{control.label}</Text>
              </Pressable>
            ))}
        </ScrollView>
      ) : null}

      <View style={styles.explorerListHeader}>
        <Text style={styles.explorerListTitle}>{explorerSectionTitle(items)}</Text>
        <Text style={styles.explorerCount}>{status?.label ?? `${items.length} items`}</Text>
      </View>
      {items.length ? (
        <View style={styles.explorerListGroup}>
          {items.map((item, index) => {
            const detail = explorerItemDetail(item, controls);
            const isFile = /\.[a-z0-9]{1,8}$/i.test(item.label);
            return (
              <Pressable
                key={item.id}
                onPress={() => activate(item, 'doubleClick')}
                onLongPress={() => activate(item)}
                style={[styles.explorerItem, index < items.length - 1 && styles.explorerItemDivider, item.selected && styles.explorerItemSelected]}
              >
                <View style={[styles.explorerItemIcon, isFile && styles.explorerFileIcon]}><Text style={[styles.explorerItemIconText, isFile && styles.explorerFileIconText]}>{explorerItemMark(item.label)}</Text></View>
                <View style={styles.explorerItemCopy}>
                  <Text style={styles.explorerItemTitle} numberOfLines={1}>{item.label}</Text>
                  <Text style={styles.explorerItemDetail} numberOfLines={1}>{detail || (isFile ? explorerFileType(item.label) : 'Folder')}</Text>
                </View>
                <Text style={styles.explorerOpen}>›</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.explorerEmpty}><Text style={styles.explorerEmptyText}>This folder has no exposed items.</Text></View>
      )}
      <Text style={styles.explorerHint}>Tap to open · Press and hold to select</Text>
    </View>
  );
}

function ExplorerField({ control, placeholder, action, onInput, onRefresh, submit = false, searchMode = false }: {
  control: SemanticControl;
  placeholder: string;
  action: string;
  onInput: (command: InputCommand) => void;
  onRefresh: () => void;
  submit?: boolean;
  searchMode?: boolean;
}) {
  const [value, setValue] = useState(control.value.trim());
  const update = () => {
    if (!value.trim()) return;
    onInput({ kind: 'replaceText', x: control.x, y: control.y, text: value.trim() });
    if (submit) setTimeout(() => onInput({ kind: 'key', key: 'Enter' }), 180);
    setTimeout(onRefresh, 700);
  };
  return (
    <View style={[styles.explorerField, searchMode && styles.explorerSearchField]}>
      {searchMode ? <Text style={styles.explorerSearchGlyph}>⌕</Text> : <Text style={styles.explorerPathGlyph}>⌘</Text>}
      <TextInput value={value} onChangeText={setValue} onSubmitEditing={update} placeholder={placeholder} placeholderTextColor={colors.textDim} style={styles.explorerFieldInput} autoCorrect={false} returnKeyType={submit ? 'search' : 'go'} />
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

function explorerNavGlyph(label: string): string {
  if (/^back/i.test(label)) return '‹';
  if (/^forward/i.test(label)) return '›';
  if (/^up to /i.test(label)) return '↑';
  if (/^refresh/i.test(label)) return '↻';
  return '·';
}

function explorerCommandGlyph(label: string): string {
  if (/^new/i.test(label)) return '+';
  if (/^(copy|paste)/i.test(label)) return '□';
  if (/^(cut|delete)/i.test(label)) return '−';
  if (/^share/i.test(label)) return '↑';
  if (/^(sort|filter)/i.test(label)) return '≡';
  if (/^(view|details)/i.test(label)) return '▦';
  if (/^rename/i.test(label)) return '✎';
  return '•••';
}

function explorerFolderName(title: string, location: string): string {
  const normalizedLocation = location.replace(/^address bar,?\s*/i, '').trim().replace(/[\\/]+$/, '');
  const pathPart = normalizedLocation.split(/[\\/]/).filter(Boolean).pop();
  if (pathPart && !/address bar/i.test(pathPart)) return pathPart;
  return title.replace(/\s*[-–]\s*file explorer\s*$/i, '').trim() || 'Files';
}

function explorerItemMark(label: string): string {
  const match = label.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].slice(0, 4).toLocaleUpperCase() : '▰';
}

function explorerFileType(label: string): string {
  const match = label.match(/\.([a-z0-9]{1,8})$/i);
  return match ? `${match[1].toLocaleUpperCase()} file` : 'File';
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
      <TextInput value={draft} onChangeText={(value) => { setDraft(value); setDirty(value !== initial); }} multiline textAlignVertical="top" autoCorrect={false} spellCheck={false} style={styles.editorInput} placeholder="This application has not exposed its current text yet." placeholderTextColor={colors.textDim} />
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
      <Switch value={control.checked ?? control.selected} onValueChange={() => onActivate(control)} trackColor={{ false: colors.borderStrong, true: colors.primary }} thumbColor={control.checked ?? control.selected ? colors.inverseText : colors.textMuted} />
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
  scroll: { flex: 1, backgroundColor: colors.background },
  document: { paddingBottom: 28 },
  titleBar: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  titleCopy: { flex: 1, marginLeft: 10 },
  applicationName: { color: colors.textMuted, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.7 },
  windowTitle: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: 3 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  syncButtonActive: { backgroundColor: colors.primary },
  syncText: { color: colors.textMuted, fontSize: 20, fontWeight: '500', marginTop: -2 },
  moreText: { color: colors.textMuted, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  moreTextActive: { color: colors.inverseText },
  quickMenu: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: 13, paddingBottom: 8 },
  quickMenuHeader: { paddingHorizontal: 14, marginBottom: 8 },
  quickMenuTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  quickMenuHint: { color: colors.textDim, fontSize: 9, marginTop: 3 },
  quickRefresh: { minHeight: 48, marginHorizontal: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11 },
  quickRefreshGlyph: { width: 32, color: colors.textMuted, fontSize: 19 },
  quickRefreshText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  quickRefreshChevron: { color: colors.textDim, fontSize: 21 },
  centerState: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 34 },
  chooseIcon: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  chooseMark: { color: colors.text, fontSize: 13, fontWeight: '800' },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center', marginTop: 14 },
  stateBody: { color: colors.textMuted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7, maxWidth: 310 },
  tabStrip: { backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabStripContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  appTab: { maxWidth: 230, minHeight: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  appTabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  appTabText: { color: colors.textMuted, fontSize: 10, fontWeight: '600', maxWidth: 190 },
  appTabTextActive: { color: colors.inverseText, fontWeight: '700' },
  modifiedDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.inverseText, marginLeft: 7 },
  menuStrip: { minHeight: 44, paddingHorizontal: 8, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  menuItem: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center' },
  menuText: { color: colors.text, fontSize: 12, fontWeight: '500' },
  menuChevron: { color: colors.textMuted, fontSize: 11, marginLeft: 5 },
  toolbar: { backgroundColor: colors.surface },
  toolbarContent: { paddingHorizontal: 9, paddingVertical: 8, gap: 7 },
  toolButton: { minWidth: 52, maxWidth: 116, minHeight: 42, borderRadius: 12, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  toolButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toolText: { color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '600', textAlign: 'center' },
  toolTextActive: { color: colors.inverseText },
  navigation: { backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  navigationContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 7 },
  navigationItem: { minHeight: 36, borderRadius: 18, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 14 },
  navigationItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  navigationText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  navigationTextActive: { color: colors.inverseText },
  editorSurface: { flex: 1, minHeight: 520, backgroundColor: colors.background },
  editorHeader: { height: 50, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center' },
  editorLabel: { flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  applyButton: { height: 36, borderRadius: 18, backgroundColor: colors.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: colors.inverseText, fontSize: 11, fontWeight: '800' },
  editorInput: { minHeight: 468, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, lineHeight: 24, fontFamily: 'monospace' },
  readerSurface: { minHeight: 300, backgroundColor: colors.background, paddingHorizontal: 17, paddingVertical: 18 },
  readerText: { color: colors.text, fontSize: 16, lineHeight: 25 },
  fieldSurface: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 13 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 7 },
  fieldLine: { flexDirection: 'row', gap: 8 },
  fieldInput: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 12, fontSize: 14 },
  fieldAction: { minHeight: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  fieldActionText: { color: colors.inverseText, fontSize: 11, fontWeight: '700' },
  interfaceRow: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  interfaceRowContent: { padding: 10, gap: 8 },
  rowAction: { width: 142, minHeight: 72, borderRadius: 12, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, padding: 11, justifyContent: 'center' },
  rowActionText: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  rowActionValue: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5 },
  optionRow: { minHeight: 64, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  optionCopy: { flex: 1, marginRight: 12 },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  optionDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  contentGroup: { backgroundColor: colors.surface },
  contentBlock: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  contentBlockCompact: { paddingVertical: 8 },
  contentBlockInteractive: { paddingRight: 32 },
  contentText: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  contentHeading: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  contentDescription: { color: colors.textDim, fontSize: 11, lineHeight: 16, marginTop: 5 },
  listRow: { minHeight: 62, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center' },
  listRowSelected: { backgroundColor: colors.surfaceSoft },
  listBullet: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.surfaceRaised, marginRight: 11 },
  listCopy: { flex: 1 },
  listTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  listValue: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  listChevron: { color: colors.textDim, fontSize: 24, marginLeft: 8 },
  primaryAction: { minHeight: 52, marginHorizontal: 12, marginVertical: 7, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  primaryActionText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  statusBar: { backgroundColor: colors.surfaceRaised, borderTopWidth: 1, borderTopColor: colors.border },
  statusContent: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', gap: 16 },
  statusText: { color: colors.textMuted, fontSize: 10, fontWeight: '500' },
  visualLoading: { minHeight: 360, margin: 12, borderRadius: radii.large, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 30 },
  visualDocument: { paddingHorizontal: 12, paddingTop: 12, gap: 12 },
  visualCrop: { backgroundColor: colors.black, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  explorerSurface: { backgroundColor: colors.background, paddingBottom: 28 },
  explorerHero: { minHeight: 76, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' },
  explorerHeroCopy: { flex: 1 },
  explorerEyebrow: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  explorerTitle: { color: colors.text, fontSize: 27, lineHeight: 31, fontWeight: '800', letterSpacing: -0.9, marginTop: 2 },
  explorerMore: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  explorerMoreActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  explorerMoreText: { color: colors.textMuted, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  explorerMoreTextActive: { color: colors.inverseText },
  explorerNavRow: { minHeight: 50, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', gap: 6, backgroundColor: colors.background, alignItems: 'center' },
  explorerNavButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  explorerNavText: { color: colors.text, fontSize: 22, lineHeight: 24, fontWeight: '400' },
  explorerLocation: { flex: 1, height: 38, borderRadius: 19, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11 },
  explorerLocationActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  explorerLocationGlyph: { color: colors.textMuted, fontSize: 13, marginRight: 7 },
  explorerLocationText: { flex: 1, color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  explorerLocationTextActive: { color: colors.inverseText },
  explorerLocationChevron: { color: colors.textDim, fontSize: 12, marginLeft: 5 },
  explorerLocationChevronActive: { color: colors.inverseText, transform: [{ rotate: '180deg' }] },
  explorerField: { minHeight: 52, marginHorizontal: 12, marginTop: 7, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 5, flexDirection: 'row', alignItems: 'center' },
  explorerSearchField: { backgroundColor: colors.surfaceRaised, borderColor: 'transparent' },
  explorerSearchGlyph: { width: 26, color: colors.textMuted, fontSize: 20, textAlign: 'center' },
  explorerPathGlyph: { width: 27, color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  explorerFieldInput: { flex: 1, minHeight: 40, color: colors.text, fontSize: 13, paddingHorizontal: 8 },
  explorerFieldButton: { height: 36, minWidth: 44, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11 },
  explorerFieldButtonText: { color: colors.inverseText, fontSize: 10, fontWeight: '700' },
  explorerActionsPanel: { marginHorizontal: 12, marginTop: 10, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingTop: 12, overflow: 'hidden' },
  explorerActionsTitle: { color: colors.text, fontSize: 12, fontWeight: '700', paddingHorizontal: 13 },
  explorerCommands: { marginTop: 7 },
  explorerCommandsContent: { paddingHorizontal: 9, paddingVertical: 9, gap: 7 },
  explorerCommand: { width: 70, minHeight: 62, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  explorerCommandGlyph: { color: colors.text, fontSize: 17, lineHeight: 20 },
  explorerCommandText: { color: colors.textMuted, fontSize: 8, lineHeight: 11, fontWeight: '600', textAlign: 'center', marginTop: 5 },
  explorerTabsRail: { marginTop: 10 },
  explorerTabs: { paddingHorizontal: 12, gap: 7 },
  explorerTab: { minHeight: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  explorerTabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  explorerTabText: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  explorerTabTextSelected: { color: colors.inverseText, fontWeight: '700' },
  explorerListHeader: { paddingHorizontal: 16, paddingTop: 23, paddingBottom: 9, flexDirection: 'row', alignItems: 'center' },
  explorerListTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  explorerCount: { color: colors.textMuted, fontSize: 9, fontWeight: '500' },
  explorerListGroup: { marginHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  explorerItem: { minHeight: 68, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center' },
  explorerItemDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  explorerItemSelected: { backgroundColor: colors.surfaceSoft },
  explorerItemIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  explorerFileIcon: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  explorerItemIconText: { color: colors.inverseText, fontSize: 10, fontWeight: '800' },
  explorerFileIconText: { color: colors.textMuted },
  explorerItemCopy: { flex: 1, marginHorizontal: 11 },
  explorerItemTitle: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  explorerItemDetail: { color: colors.textMuted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  explorerOpen: { color: colors.textDim, fontSize: 22, fontWeight: '400', marginRight: 2 },
  explorerEmpty: { minHeight: 130, marginHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  explorerEmptyText: { color: colors.textMuted, fontSize: 11 },
  explorerHint: { color: colors.textDim, fontSize: 8, textAlign: 'center', marginTop: 11 },
  disabled: { opacity: 0.36 },
});
