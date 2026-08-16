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

export type InputCommand =
  | {
      kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'tap' | 'doubleClick';
      x: number;
      y: number;
    }
  | { kind: 'moveRelative'; dx: number; dy: number }
  | { kind: 'leftClick' | 'rightClick' }
  | { kind: 'scroll'; delta: number }
  | { kind: 'key'; key: string }
  | { kind: 'shortcut'; keys: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'replaceText'; x: number; y: number; text: string }
  | { kind: 'focusWindow'; processId: number; windowHandle: number };

export interface RemoteSessionApi {
  hasSession: boolean;
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
  hostOnline: boolean;
  viewerCount: number;
  latencyMs: number | null;
  connect: (relayUrl: string, pairingCode: string) => void;
  disconnect: () => void;
  sendInput: (command: InputCommand) => void;
  refreshSemantic: () => void;
  requestShell: (refresh?: boolean) => void;
  searchShell: (query: string) => void;
  launchShell: (id: string) => void;
  requestIcons: (keys: string[]) => void;
  requestAppVisual: (processId: number, windowHandle: number) => void;
  requestCameraStatus: () => void;
  sendCameraControl: (command: CameraControlCommand) => void;
  setQuality: (profile: CaptureProfile) => void;
  setStreamEnabled: (enabled: boolean) => void;
}
