export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type CaptureProfile = 'smooth' | 'balanced' | 'sharp';

export interface PairingDetails {
  relayUrl: string;
  sessionId: string;
  viewerToken: string;
  deviceId?: string;
  deviceName?: string;
}

export interface DesktopMeta {
  machineName: string;
  sourceWidth: number;
  sourceHeight: number;
  streamWidth: number;
  streamHeight: number;
  left: number;
  top: number;
  fps: number;
  quality: number;
  profile: CaptureProfile;
}

export interface SemanticWindow {
  processId: number;
  iconKey: string;
  windowHandle: number;
  title: string;
  process: string;
  active: boolean;
}

export interface SemanticControl {
  id: string;
  label: string;
  kind: string;
  category: 'action' | 'field' | 'navigation' | 'option' | 'content';
  value: string;
  description: string;
  section: string;
  source: 'accessibility' | 'vision';
  action: string;
  depth: number;
  order: number;
  parentId: string;
  enabled: boolean;
  editable: boolean;
  interactive: boolean;
  focused: boolean;
  selected: boolean;
  checked: boolean | null;
  expanded: boolean | null;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SemanticSnapshot {
  capturedAt: number;
  activeProcessId: number;
  activeWindowHandle: number;
  activeTitle: string;
  adapter: 'accessibility' | 'hybrid' | 'vision' | 'basic';
  accessibilityCount: number;
  visionCount: number;
  windowFrame: { x: number; y: number; width: number; height: number };
  windows: SemanticWindow[];
  controls: SemanticControl[];
}

export interface AppVisual {
  processId: number;
  windowHandle: number;
  width: number;
  height: number;
  capturedAt: number;
  dataUri: string;
}

export interface CameraAxisStatus {
  supported: boolean;
  minimum: number;
  maximum: number;
  step: number;
  defaultValue: number;
  current: number;
  flags: number;
}

export interface CameraPtzStatus {
  device: string;
  available: boolean;
  ptz: boolean;
  action: string;
  moved: boolean;
  pan: CameraAxisStatus;
  tilt: CameraAxisStatus;
  zoom: CameraAxisStatus;
  presets: Array<{ slot: 1 | 2 | 3; saved: boolean }>;
  error: string;
}

export type CameraControlCommand =
  | { kind: 'query' }
  | { kind: 'move'; direction: 'Left' | 'Right' | 'Up' | 'Down' | 'ZoomIn' | 'ZoomOut'; amount?: number }
  | { kind: 'home' }
  | { kind: 'presetSave'; slot: 1 | 2 | 3 }
  | { kind: 'presetRecall'; slot: 1 | 2 | 3 };

export interface ShellApp {
  id: string;
  iconKey: string;
  name: string;
  category: string;
  pinned: boolean;
}

export interface ShellFile {
  id: string;
  name: string;
  location: string;
  kind: string;
  modifiedAt: string;
}

export interface ShellSnapshot {
  capturedAt: number;
  apps: ShellApp[];
}

export interface ShellSearchResults {
  query: string;
  apps: ShellApp[];
  files: ShellFile[];
}

export type FileLocationKind = 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos' | 'drive';

export interface RemoteFileEntry {
  id: string;
  name: string;
  kind: 'directory' | 'file';
  extension: string;
  mimeType: string;
  size: number;
  modifiedAt: number;
  thumbnailAvailable: boolean;
  locationKind?: FileLocationKind;
}

export interface FileBrowserSnapshot {
  directoryId: string | null;
  name: string;
  pathLabel: string;
  parentId: string | null;
  breadcrumbs: Array<{ id: string | null; name: string }>;
  items: RemoteFileEntry[];
  truncated: boolean;
}

export type FileOperationRequest =
  | { kind: 'copy' | 'move'; sourceIds: string[]; destinationId: string }
  | { kind: 'rename'; sourceIds: [string]; name: string }
  | { kind: 'delete'; sourceIds: string[] }
  | { kind: 'mkdir'; destinationId: string; name: string };

export interface FileOperationState {
  requestId: string;
  status: 'running' | 'success' | 'error';
  message: string;
}

export interface FileDownloadState {
  requestId: string;
  status: 'waiting' | 'downloading' | 'ready' | 'error';
  name: string;
  mimeType: string;
  received: number;
  total: number;
  uri: string;
  message: string;
}

export type InputCommand =
  | {
      kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'tap' | 'doubleClick';
      x: number;
      y: number;
    }
  | { kind: 'moveRelative'; dx: number; dy: number }
  | { kind: 'leftClick' | 'rightClick' | 'leftDown' | 'leftUp' }
  | { kind: 'scroll'; delta: number }
  | { kind: 'key'; key: string }
  | { kind: 'secureAttention' }
  | { kind: 'shortcut'; keys: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'replaceText'; x: number; y: number; text: string }
  | { kind: 'focusWindow' | 'closeWindow'; processId: number; windowHandle: number };

export interface RemoteSessionApi {
  hasSession: boolean;
  restoringSession: boolean;
  status: ConnectionStatus;
  error: string | null;
  frameUri: string | null;
  desktopMeta: DesktopMeta | null;
  snapshot: SemanticSnapshot | null;
  shellSnapshot: ShellSnapshot | null;
  shellResults: ShellSearchResults | null;
  appIcons: Record<string, string>;
  appVisual: AppVisual | null;
  cameraStatus: CameraPtzStatus | null;
  fileSnapshot: FileBrowserSnapshot | null;
  fileThumbnails: Record<string, string>;
  fileLoading: boolean;
  fileError: string | null;
  fileOperation: FileOperationState | null;
  fileDownload: FileDownloadState | null;
  hostOnline: boolean;
  secureDesktopActive: boolean;
  viewerCount: number;
  latencyMs: number | null;
  connect: (relayUrl: string, pairingCode: string) => Promise<void>;
  disconnect: () => void;
  sendInput: (command: InputCommand) => void;
  refreshSemantic: () => void;
  requestShell: (refresh?: boolean) => void;
  searchShell: (query: string) => void;
  launchShell: (id: string) => void;
  requestIcons: (keys: string[]) => void;
  requestAppVisual: (processId: number, windowHandle: number) => void;
  requestCameraStatus: () => void;
  requestFiles: (directoryId: string | null) => void;
  requestFileThumbnails: (ids: string[]) => void;
  runFileOperation: (operation: FileOperationRequest) => void;
  openFile: (id: string) => void;
  downloadFile: (id: string) => void;
  shareDownloadedFile: () => Promise<void>;
  clearFileOperation: () => void;
  clearFileDownload: () => void;
  sendCameraControl: (command: CameraControlCommand) => void;
  setQuality: (profile: CaptureProfile) => void;
  setStreamEnabled: (enabled: boolean) => void;
}
