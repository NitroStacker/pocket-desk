import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
} from 'react-native';
import { colors, radii } from '../theme';
import type {
  FileBrowserSnapshot,
  FileDownloadState,
  FileOperationRequest,
  FileOperationState,
  RemoteFileEntry,
} from '../types';
import { MotionPressable } from './MotionPressable';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Clipboard = { mode: 'copy' | 'move'; items: RemoteFileEntry[] };

interface Props {
  snapshot: FileBrowserSnapshot | null;
  thumbnails: Record<string, string>;
  loading: boolean;
  error: string | null;
  operation: FileOperationState | null;
  download: FileDownloadState | null;
  onBrowse: (directoryId: string | null) => void;
  onRequestThumbnails: (ids: string[]) => void;
  onOperate: (operation: FileOperationRequest) => void;
  onOpen: (id: string) => void;
  onDownload: (id: string) => void;
  onShareDownload: () => Promise<void>;
  onClearOperation: () => void;
  onClearDownload: () => void;
}

export function FileExplorerApplication({
  snapshot,
  thumbnails,
  loading,
  error,
  operation,
  download,
  onBrowse,
  onRequestThumbnails,
  onOperate,
  onOpen,
  onDownload,
  onShareDownload,
  onClearOperation,
  onClearDownload,
}: Props) {
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [focusedItem, setFocusedItem] = useState<RemoteFileEntry | null>(null);
  const [nameDialog, setNameDialog] = useState<{ kind: 'mkdir' | 'rename'; item?: RemoteFileEntry } | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    if (!snapshot && !loading) onBrowse(null);
  }, [loading, onBrowse, snapshot]);

  useEffect(() => {
    const ids = snapshot?.items.filter((item) => item.thumbnailAvailable).map((item) => item.id) ?? [];
    if (ids.length) onRequestThumbnails(ids);
  }, [onRequestThumbnails, snapshot]);

  useEffect(() => {
    setSelected([]);
    setFocusedItem(null);
    setQuery('');
  }, [snapshot?.directoryId]);

  useEffect(() => {
    if (!pasting || !operation || operation.status === 'running') return;
    if (operation.status === 'success') setClipboard(null);
    setPasting(false);
  }, [operation, pasting]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const items = useMemo(() => {
    if (!normalizedQuery) return snapshot?.items ?? [];
    return (snapshot?.items ?? []).filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, snapshot]);
  const selectedItems = useMemo(
    () => (snapshot?.items ?? []).filter((item) => selected.includes(item.id)),
    [selected, snapshot],
  );

  const browse = (directoryId: string | null) => {
    setSelected([]);
    onBrowse(directoryId);
  };

  const toggleSelected = (item: RemoteFileEntry) => {
    if (item.locationKind) return;
    setSelected((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : [...current, item.id]);
  };

  const startClipboard = (mode: Clipboard['mode'], sourceItems = selectedItems) => {
    if (!sourceItems.length) return;
    setClipboard({ mode, items: sourceItems });
    setSelected([]);
    setFocusedItem(null);
  };

  const pasteHere = () => {
    if (!clipboard || !snapshot?.directoryId) return;
    setPasting(true);
    onOperate({
      kind: clipboard.mode,
      sourceIds: clipboard.items.map((item) => item.id),
      destinationId: snapshot.directoryId,
    });
  };

  const openNameDialog = (kind: 'mkdir' | 'rename', item?: RemoteFileEntry) => {
    setNameValue(kind === 'rename' ? item?.name ?? '' : 'New Folder');
    setNameDialog({ kind, item });
    setFocusedItem(null);
  };

  const submitName = () => {
    const name = nameValue.trim();
    if (!name || !snapshot?.directoryId || !nameDialog) return;
    if (nameDialog.kind === 'mkdir') {
      onOperate({ kind: 'mkdir', destinationId: snapshot.directoryId, name });
    } else if (nameDialog.item) {
      onOperate({ kind: 'rename', sourceIds: [nameDialog.item.id], name });
    }
    setNameDialog(null);
  };

  const confirmDelete = (targets: RemoteFileEntry[]) => {
    if (!targets.length) return;
    Alert.alert(
      targets.length === 1 ? `Delete “${targets[0].name}”?` : `Delete ${targets.length} items?`,
      'This removes the selected item from the PC and cannot be undone from PocketDesk.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onOperate({ kind: 'delete', sourceIds: targets.map((item) => item.id) });
            setSelected([]);
            setFocusedItem(null);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.surface}>
      <View style={styles.navigationBar}>
        <MotionPressable
          onPress={() => browse(snapshot?.parentId ?? null)}
          disabled={!snapshot || snapshot.directoryId === null || loading}
          style={[styles.roundButton, (!snapshot || snapshot.directoryId === null) && styles.invisible]}
          accessibilityLabel="Back to parent folder"
        >
          <View style={styles.roundButtonInner}><Ionicons name="chevron-back" size={22} color={colors.text} /></View>
        </MotionPressable>
        <View style={styles.navigationTitleCopy}>
          <Text style={styles.navigationEyebrow}>{selected.length ? `${selected.length} selected` : 'Files on your PC'}</Text>
          <Text style={styles.navigationTitle} numberOfLines={1}>{snapshot?.name ?? 'Browse'}</Text>
        </View>
        <MotionPressable onPress={() => setGrid((current) => !current)} style={styles.roundButton} accessibilityLabel={grid ? 'Use list view' : 'Use grid view'}>
          <View style={styles.roundButtonInner}><Ionicons name={grid ? 'list' : 'grid-outline'} size={19} color={colors.text} /></View>
        </MotionPressable>
        <MotionPressable onPress={() => openNameDialog('mkdir')} disabled={!snapshot?.directoryId} style={[styles.roundButton, !snapshot?.directoryId && styles.disabled]} accessibilityLabel="Create folder">
          <View style={styles.roundButtonInner}><Ionicons name="folder-open-outline" size={20} color={colors.text} /></View>
        </MotionPressable>
      </View>

      {snapshot?.breadcrumbs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbs}>
          {snapshot.breadcrumbs.map((crumb, index) => (
            <View key={`${crumb.id ?? 'root'}:${index}`} style={styles.breadcrumbGroup}>
              {index ? <Ionicons name="chevron-forward" size={12} color={colors.textDim} /> : null}
              <Pressable onPress={() => browse(crumb.id)} hitSlop={8}>
                <Text style={[styles.breadcrumb, index === snapshot.breadcrumbs.length - 1 && styles.breadcrumbCurrent]} numberOfLines={1}>{crumb.name}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.searchBox}>
        <Ionicons name="search" size={17} color={colors.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={`Search ${snapshot?.name ?? 'files'}`} placeholderTextColor={colors.textDim} style={styles.searchInput} autoCorrect={false} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}
      </View>

      {clipboard ? (
        <View style={styles.clipboardBanner}>
          <View style={styles.clipboardIcon}><Ionicons name={clipboard.mode === 'copy' ? 'copy-outline' : 'move-outline'} size={18} color={colors.inverseText} /></View>
          <View style={styles.clipboardCopy}>
            <Text style={styles.clipboardTitle}>{clipboard.mode === 'copy' ? 'Copying' : 'Moving'} {clipboard.items.length} {clipboard.items.length === 1 ? 'item' : 'items'}</Text>
            <Text style={styles.clipboardDetail} numberOfLines={1}>Navigate to a destination, then paste here.</Text>
          </View>
          <Pressable onPress={() => setClipboard(null)} hitSlop={8}><Ionicons name="close" size={18} color={colors.inverseText} /></Pressable>
          {snapshot?.directoryId ? (
            <Pressable onPress={pasteHere} disabled={operation?.status === 'running'} style={styles.pasteButton}>
              <Text style={styles.pasteButtonText}>{operation?.status === 'running' && pasting ? 'Pasting…' : 'Paste here'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {selectedItems.length ? (
        <SelectionBar
          items={selectedItems}
          onCopy={() => startClipboard('copy')}
          onMove={() => startClipboard('move')}
          onDownload={() => selectedItems.length === 1 && selectedItems[0].kind === 'file' ? onDownload(selectedItems[0].id) : undefined}
          onRename={() => selectedItems.length === 1 && openNameDialog('rename', selectedItems[0])}
          onDelete={() => confirmDelete(selectedItems)}
          onCancel={() => setSelected([])}
        />
      ) : null}

      {operation ? (
        <NoticeBanner
          tone={operation.status === 'error' ? 'error' : operation.status === 'success' ? 'success' : 'loading'}
          message={operation.message}
          onClose={operation.status === 'running' ? undefined : onClearOperation}
        />
      ) : null}
      {download ? <DownloadBanner download={download} onSave={onShareDownload} onClose={onClearDownload} /> : null}
      {error ? <NoticeBanner tone="error" message={error} onClose={() => onBrowse(snapshot?.directoryId ?? null)} /> : null}

      <View style={styles.listHeading}>
        <Text style={styles.listTitle}>{snapshot?.directoryId === null ? 'Locations' : normalizedQuery ? 'Results' : 'Items'}</Text>
        <Text style={styles.listCount}>{items.length}{snapshot?.truncated ? '+' : ''}</Text>
      </View>

      {loading && !snapshot ? (
        <View style={styles.centerState}><ActivityIndicator color={colors.text} /><Text style={styles.centerStateText}>Reading folders from your PC</Text></View>
      ) : items.length ? (
        <View style={grid ? styles.grid : styles.list}>
          {items.map((item) => (
            <FileItem
              key={item.id}
              item={item}
              thumbnail={thumbnails[item.id]}
              grid={grid}
              selected={selected.includes(item.id)}
              onPress={() => item.kind === 'directory' ? browse(item.id) : setFocusedItem(item)}
              onLongPress={() => toggleSelected(item)}
              onMore={() => setFocusedItem(item)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.centerState}>
          <Ionicons name={normalizedQuery ? 'search-outline' : 'folder-open-outline'} size={34} color={colors.textDim} />
          <Text style={styles.emptyTitle}>{normalizedQuery ? 'No matching files' : 'This folder is empty'}</Text>
          <Text style={styles.centerStateText}>{normalizedQuery ? 'Try a shorter name.' : 'Create a folder or paste files here.'}</Text>
        </View>
      )}

      <FileActionSheet
        item={focusedItem}
        onClose={() => setFocusedItem(null)}
        onOpen={() => {
          if (focusedItem?.kind === 'directory') browse(focusedItem.id);
          else if (focusedItem) onOpen(focusedItem.id);
          setFocusedItem(null);
        }}
        onDownload={() => { if (focusedItem?.kind === 'file') onDownload(focusedItem.id); setFocusedItem(null); }}
        onCopy={() => focusedItem && startClipboard('copy', [focusedItem])}
        onMove={() => focusedItem && startClipboard('move', [focusedItem])}
        onRename={() => focusedItem && openNameDialog('rename', focusedItem)}
        onDelete={() => focusedItem && confirmDelete([focusedItem])}
      />
      <NameDialog value={nameValue} dialog={nameDialog} onChange={setNameValue} onCancel={() => setNameDialog(null)} onSubmit={submitName} />
    </View>
  );
}

function FileItem({ item, thumbnail, grid, selected, onPress, onLongPress, onMore }: {
  item: RemoteFileEntry;
  thumbnail?: string;
  grid: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onMore: () => void;
}) {
  const icon = iconFor(item);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={[grid ? styles.gridItem : styles.listItem, selected && styles.itemSelected]}>
      <FileArtwork item={item} thumbnail={thumbnail} icon={icon} large={grid} />
      <View style={grid ? styles.gridItemCopy : styles.itemCopy}>
        <Text style={[styles.itemName, grid && styles.gridItemName]} numberOfLines={grid ? 2 : 1}>{item.name}</Text>
        <Text style={[styles.itemDetail, grid && styles.gridItemDetail]} numberOfLines={1}>{fileDetail(item)}</Text>
      </View>
      {selected ? <View style={styles.selectionCheck}><Ionicons name="checkmark" size={13} color={colors.inverseText} /></View> : null}
      {!item.locationKind ? <Pressable onPress={(event) => { event.stopPropagation(); onMore(); }} hitSlop={10} style={grid ? styles.gridMore : styles.moreButton}><Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} /></Pressable> : <Ionicons name="chevron-forward" size={17} color={colors.textDim} />}
    </Pressable>
  );
}

function FileArtwork({ item, thumbnail, icon, large }: { item: RemoteFileEntry; thumbnail?: string; icon: IconName; large: boolean }) {
  const size = large ? 76 : 46;
  if (thumbnail) return <Image source={{ uri: thumbnail }} style={[styles.thumbnail, { width: size, height: size }]} />;
  return (
    <View style={[styles.fileArtwork, large && styles.fileArtworkLarge, item.kind === 'directory' && styles.folderArtwork]}>
      <Ionicons name={icon} size={large ? 42 : 27} color={item.kind === 'directory' ? colors.text : colors.textMuted} />
      {item.kind === 'file' && item.extension ? <Text style={styles.extensionBadge}>{item.extension.replace('.', '').slice(0, 4).toUpperCase()}</Text> : null}
    </View>
  );
}

function SelectionBar({ items, onCopy, onMove, onDownload, onRename, onDelete, onCancel }: {
  items: RemoteFileEntry[];
  onCopy: () => void;
  onMove: () => void;
  onDownload: () => void | undefined;
  onRename: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const one = items.length === 1;
  const downloadable = one && items[0].kind === 'file';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectionBar}>
      <ActionChip icon="close" label="Cancel" onPress={onCancel} />
      <ActionChip icon="copy-outline" label="Copy" onPress={onCopy} />
      <ActionChip icon="move-outline" label="Move" onPress={onMove} />
      <ActionChip icon="download-outline" label="Download" onPress={onDownload} disabled={!downloadable} />
      <ActionChip icon="create-outline" label="Rename" onPress={onRename} disabled={!one} />
      <ActionChip icon="trash-outline" label="Delete" onPress={onDelete} danger />
    </ScrollView>
  );
}

function ActionChip({ icon, label, onPress, disabled, danger }: { icon: IconName; label: string; onPress: () => void | undefined; disabled?: boolean; danger?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.actionChip, disabled && styles.disabled]}><Ionicons name={icon} size={16} color={danger ? colors.danger : colors.text} /><Text style={[styles.actionChipText, danger && styles.dangerText]}>{label}</Text></Pressable>;
}

function FileActionSheet({ item, onClose, onOpen, onDownload, onCopy, onMove, onRename, onDelete }: {
  item: RemoteFileEntry | null;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetScrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><FileArtwork item={item} icon={iconFor(item)} large={false} /><View style={styles.sheetHeaderCopy}><Text style={styles.sheetTitle} numberOfLines={2}>{item.name}</Text><Text style={styles.sheetDetail}>{fileDetail(item)}</Text></View></View>
          <SheetAction icon={item.kind === 'directory' ? 'folder-open-outline' : 'open-outline'} label={item.kind === 'directory' ? 'Open folder' : 'Open on PC'} onPress={onOpen} />
          {item.kind === 'file' ? <SheetAction icon="download-outline" label="Download to phone" onPress={onDownload} /> : null}
          <SheetAction icon="copy-outline" label="Copy" onPress={onCopy} />
          <SheetAction icon="move-outline" label="Move" onPress={onMove} />
          <SheetAction icon="create-outline" label="Rename" onPress={onRename} />
          <SheetAction icon="trash-outline" label="Delete" onPress={onDelete} danger />
          <Pressable onPress={onClose} style={styles.cancelSheet}><Text style={styles.cancelSheetText}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SheetAction({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable onPress={onPress} style={styles.sheetAction}><Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} /><Text style={[styles.sheetActionText, danger && styles.dangerText]}>{label}</Text><Ionicons name="chevron-forward" size={16} color={colors.textDim} /></Pressable>;
}

function NameDialog({ value, dialog, onChange, onCancel, onSubmit }: { value: string; dialog: { kind: 'mkdir' | 'rename' } | null; onChange: (value: string) => void; onCancel: () => void; onSubmit: () => void }) {
  return (
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.dialogRoot}>
        <Pressable style={styles.sheetScrim} onPress={onCancel} />
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{dialog?.kind === 'mkdir' ? 'New Folder' : 'Rename Item'}</Text>
          <TextInput value={value} onChangeText={onChange} autoFocus selectTextOnFocus style={styles.dialogInput} placeholder="Name" placeholderTextColor={colors.textDim} onSubmitEditing={onSubmit} />
          <View style={styles.dialogActions}><Pressable onPress={onCancel} style={styles.dialogButton}><Text style={styles.dialogCancel}>Cancel</Text></Pressable><Pressable onPress={onSubmit} style={[styles.dialogButton, styles.dialogPrimary]}><Text style={styles.dialogPrimaryText}>{dialog?.kind === 'mkdir' ? 'Create' : 'Rename'}</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function DownloadBanner({ download, onSave, onClose }: { download: FileDownloadState; onSave: () => Promise<void>; onClose: () => void }) {
  const progress = download.total > 0 ? Math.min(1, download.received / download.total) : 0;
  return (
    <View style={styles.downloadBanner}>
      <View style={styles.downloadHeader}><Ionicons name={download.status === 'ready' ? 'checkmark-circle' : download.status === 'error' ? 'alert-circle' : 'download-outline'} size={20} color={download.status === 'error' ? colors.danger : colors.text} /><View style={styles.downloadCopy}><Text style={styles.downloadTitle} numberOfLines={1}>{download.name || 'Preparing file'}</Text><Text style={styles.downloadDetail}>{download.status === 'downloading' ? `${formatSize(download.received)} of ${formatSize(download.total)}` : download.message}</Text></View><Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable></View>
      {download.status === 'downloading' || download.status === 'waiting' ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View> : null}
      {download.status === 'ready' ? <Pressable onPress={() => void onSave()} style={styles.saveButton}><Text style={styles.saveButtonText}>Save to Files or share</Text></Pressable> : null}
    </View>
  );
}

function NoticeBanner({ tone, message, onClose }: { tone: 'error' | 'success' | 'loading'; message: string; onClose?: () => void }) {
  return <View style={[styles.notice, tone === 'error' && styles.noticeError]}>{tone === 'loading' ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name={tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={tone === 'error' ? colors.danger : colors.text} />}<Text style={[styles.noticeText, tone === 'error' && styles.dangerText]}>{message}</Text>{onClose ? <Pressable onPress={onClose} hitSlop={8}><Ionicons name="close" size={17} color={colors.textMuted} /></Pressable> : null}</View>;
}

function iconFor(item: RemoteFileEntry): IconName {
  if (item.kind === 'directory') {
    if (item.locationKind === 'home') return 'home-outline';
    if (item.locationKind === 'desktop') return 'desktop-outline';
    if (item.locationKind === 'downloads') return 'download-outline';
    if (item.locationKind === 'pictures') return 'images-outline';
    if (item.locationKind === 'music') return 'musical-notes-outline';
    if (item.locationKind === 'videos') return 'videocam-outline';
    if (item.locationKind === 'drive') return 'server-outline';
    if (item.locationKind === 'documents') return 'documents-outline';
    return 'folder';
  }
  if (item.mimeType.startsWith('image/')) return 'image-outline';
  if (item.mimeType.startsWith('video/')) return 'film-outline';
  if (item.mimeType.startsWith('audio/')) return 'musical-note-outline';
  if (item.mimeType.includes('zip') || ['.7z', '.rar'].includes(item.extension)) return 'archive-outline';
  if (['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.py', '.cs', '.cpp', '.java'].includes(item.extension)) return 'code-slash-outline';
  if (item.mimeType === 'application/pdf') return 'document-text-outline';
  return 'document-outline';
}

function fileDetail(item: RemoteFileEntry): string {
  if (item.locationKind) return item.locationKind === 'drive' ? 'Local drive' : 'Favorite location';
  if (item.kind === 'directory') return item.modifiedAt ? `Folder · ${formatDate(item.modifiedAt)}` : 'Folder';
  return `${formatSize(item.size)} · ${formatDate(item.modifiedAt)}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function formatDate(value: number): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const styles = StyleSheet.create({
  surface: { paddingBottom: 18 },
  navigationBar: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 5 },
  roundButton: { width: 40, height: 40, borderRadius: 20 },
  roundButtonInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  invisible: { opacity: 0 },
  disabled: { opacity: 0.34 },
  navigationTitleCopy: { flex: 1, marginHorizontal: 3 },
  navigationEyebrow: { color: colors.textMuted, fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },
  navigationTitle: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: '800', letterSpacing: -0.7, marginTop: 2 },
  breadcrumbs: { minHeight: 30, alignItems: 'center', paddingRight: 16 },
  breadcrumbGroup: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 5 },
  breadcrumb: { maxWidth: 150, color: colors.textMuted, fontSize: 10, fontWeight: '500' },
  breadcrumbCurrent: { color: colors.text, fontWeight: '700' },
  searchBox: { height: 44, borderRadius: 14, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 9, marginTop: 7 },
  searchInput: { flex: 1, height: '100%', color: colors.text, fontSize: 12, fontWeight: '500' },
  clipboardBanner: { marginTop: 12, borderRadius: 15, backgroundColor: colors.primary, padding: 11, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  clipboardIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#E7E7E4', alignItems: 'center', justifyContent: 'center' },
  clipboardCopy: { flex: 1, minWidth: 160 },
  clipboardTitle: { color: colors.inverseText, fontSize: 11, fontWeight: '800' },
  clipboardDetail: { color: '#555552', fontSize: 9, marginTop: 3 },
  pasteButton: { width: '100%', height: 36, borderRadius: 11, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  pasteButtonText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  selectionBar: { gap: 7, paddingVertical: 10 },
  actionChip: { minWidth: 66, height: 52, borderRadius: 14, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  actionChipText: { color: colors.text, fontSize: 8, fontWeight: '700', marginTop: 4 },
  dangerText: { color: colors.danger },
  notice: { minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, marginTop: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeError: { backgroundColor: '#160C0C', borderColor: '#482222' },
  noticeText: { flex: 1, color: colors.text, fontSize: 10, lineHeight: 14 },
  downloadBanner: { marginTop: 10, borderRadius: 15, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, padding: 11 },
  downloadHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  downloadCopy: { flex: 1 },
  downloadTitle: { color: colors.text, fontSize: 11, fontWeight: '700' },
  downloadDetail: { color: colors.textMuted, fontSize: 9, marginTop: 3 },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.text },
  saveButton: { height: 36, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  saveButtonText: { color: colors.inverseText, fontSize: 10, fontWeight: '800' },
  listHeading: { height: 48, flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 9 },
  listTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  listCount: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  list: { borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  listItem: { minHeight: 67, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  itemSelected: { backgroundColor: colors.surfaceRaised },
  itemCopy: { flex: 1, marginHorizontal: 11 },
  itemName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  itemDetail: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  moreButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  selectionCheck: { position: 'absolute', left: 40, top: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  fileArtwork: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  fileArtworkLarge: { width: 76, height: 76, borderRadius: 18 },
  folderArtwork: { backgroundColor: '#161616' },
  extensionBadge: { position: 'absolute', bottom: 4, color: colors.textDim, fontSize: 5, fontWeight: '900', letterSpacing: 0.4 },
  thumbnail: { borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border } as ImageStyle,
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  gridItem: { width: '50%', minHeight: 148, alignItems: 'center', paddingHorizontal: 6, paddingTop: 12, paddingBottom: 8, borderRadius: 16 },
  gridItemCopy: { width: '100%', alignItems: 'center', marginTop: 8, paddingHorizontal: 10 },
  gridItemName: { textAlign: 'center', fontSize: 10, lineHeight: 13 },
  gridItemDetail: { textAlign: 'center', fontSize: 8 },
  gridMore: { position: 'absolute', right: 8, top: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  centerState: { minHeight: 180, borderRadius: radii.large, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 9 },
  centerStateText: { maxWidth: 260, color: colors.textMuted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 28 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 13 },
  sheetHeader: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12, marginBottom: 3 },
  sheetHeaderCopy: { flex: 1, marginLeft: 11 },
  sheetTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  sheetDetail: { color: colors.textMuted, fontSize: 9, marginTop: 4 },
  sheetAction: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingHorizontal: 4 },
  sheetActionText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
  cancelSheet: { height: 46, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', marginTop: 11 },
  cancelSheetText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  dialogRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, borderRadius: 22, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, padding: 18 },
  dialogTitle: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.4 },
  dialogInput: { height: 48, borderRadius: 13, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13, paddingHorizontal: 12, marginTop: 14 },
  dialogActions: { flexDirection: 'row', gap: 8, marginTop: 13 },
  dialogButton: { flex: 1, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  dialogPrimary: { backgroundColor: colors.primary },
  dialogCancel: { color: colors.text, fontSize: 11, fontWeight: '700' },
  dialogPrimaryText: { color: colors.inverseText, fontSize: 11, fontWeight: '800' },
});
