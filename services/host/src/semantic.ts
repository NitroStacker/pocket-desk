import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  category: "action" | "field" | "navigation" | "option" | "content";
  value: string;
  description: string;
  section: string;
  source: "accessibility" | "vision";
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
  adapter: "accessibility" | "hybrid" | "vision" | "basic";
  accessibilityCount: number;
  visionCount: number;
  windowFrame: { x: number; y: number; width: number; height: number };
  windows: SemanticWindow[];
  controls: SemanticControl[];
}

interface RawSnapshot {
  desktop?: { left?: number; top?: number; width?: number; height?: number };
  window?: { left?: number; top?: number; width?: number; height?: number };
  activeTitle?: string;
  activeProcessId?: number;
  activeWindowHandle?: number;
  adapter?: string;
  accessibilityCount?: number;
  visionCount?: number;
  windows?: Array<{
    processId?: number;
    windowHandle?: number;
    title?: string;
    process?: string;
    active?: boolean;
  }>;
  controls?: Array<{
    label?: string;
    kind?: string;
    enabled?: boolean;
    editable?: boolean;
    interactive?: boolean;
    focused?: boolean;
    automationId?: string;
    runtimeId?: string;
    parentRuntimeId?: string;
    order?: number;
    source?: string;
    action?: string;
    depth?: number;
    value?: string;
    description?: string;
    section?: string;
    selected?: boolean;
    checked?: boolean | null;
    expanded?: boolean | null;
    rect?: { left?: number; top?: number; width?: number; height?: number };
  }>;
}

export async function captureSemanticSnapshot(
  targetProcessId = 0,
  targetWindowHandle = 0,
): Promise<SemanticSnapshot> {
  const script = fileURLToPath(new URL("../scripts/semantic.ps1", import.meta.url));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stdout = await runPowerShell(script, targetProcessId, targetWindowHandle);
      const raw = JSON.parse(stdout) as RawSnapshot;
      return normalizeSnapshot(raw);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 160));
    }
  }
  throw new Error("The selected application changed while its interface was being read.", {
    cause: lastError,
  });
}

function runPowerShell(
  script: string,
  targetProcessId: number,
  targetWindowHandle: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-TargetProcessId",
        String(targetProcessId),
        "-TargetWindowHandle",
        String(targetWindowHandle),
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function normalizeSnapshot(raw: RawSnapshot): SemanticSnapshot {
  const desktop = raw.desktop;
  const left = finite(desktop?.left, 0);
  const top = finite(desktop?.top, 0);
  const width = Math.max(1, finite(desktop?.width, 1));
  const height = Math.max(1, finite(desktop?.height, 1));
  const windowLeft = finite(raw.window?.left, left);
  const windowTop = finite(raw.window?.top, top);
  const windowWidth = Math.max(1, finite(raw.window?.width, width));
  const windowHeight = Math.max(1, finite(raw.window?.height, height));

  const windows: SemanticWindow[] = (raw.windows ?? [])
    .filter(
      (window) =>
        typeof window.processId === "number" &&
        typeof window.title === "string" &&
        window.title.trim().length > 0,
    )
    .slice(0, 30)
    .map((window) => ({
      processId: window.processId as number,
      iconKey: `window:${window.processId as number}`,
      windowHandle: finite(window.windowHandle, 0),
      title: (window.title as string).trim(),
      process: normalizeWindowProcess(window.process, window.title),
      active: window.active === true,
    }));

  const normalizedControls: SemanticControl[] = (raw.controls ?? [])
    .filter((control) => control.rect && typeof control.label === "string")
    .slice(0, 360)
    .map((control, index) => {
      const rect = control.rect ?? {};
      const centerX = finite(rect.left, left) + finite(rect.width, 0) / 2;
      const centerY = finite(rect.top, top) + finite(rect.height, 0) / 2;
      const kind = typeof control.kind === "string" ? control.kind : "Control";
      const automationId = typeof control.automationId === "string"
        ? control.automationId
        : "";
      const runtimeId = typeof control.runtimeId === "string" ? control.runtimeId : "";
      const parentRuntimeId = typeof control.parentRuntimeId === "string"
        ? control.parentRuntimeId
        : "";
      const editable = control.editable === true;
      const source: SemanticControl["source"] = control.source === "vision"
        ? "vision"
        : "accessibility";
      return {
        id: `${finite(raw.activeWindowHandle, 0)}:${source}:${kind}:${runtimeId || automationId || (control.label as string)}:${index}`,
        label: cleanText(control.label, 500) || kind,
        kind,
        category: categoryForKind(kind, editable),
        value: cleanText(control.value, 12_000),
        description: cleanText(control.description, 400),
        section: cleanText(control.section, 160),
        source,
        action: cleanText(control.action, 60) || (source === "vision" ? "tap" : "read"),
        depth: Math.max(0, Math.min(30, Math.round(finite(control.depth, 0)))),
        order: Math.max(0, Math.round(finite(control.order, index))),
        parentId: parentRuntimeId ? `${finite(raw.activeWindowHandle, 0)}:${parentRuntimeId}` : "",
        enabled: control.enabled !== false,
        editable,
        interactive: control.interactive === true || source === "vision",
        focused: control.focused === true,
        selected: control.selected === true,
        checked: typeof control.checked === "boolean" ? control.checked : null,
        expanded: typeof control.expanded === "boolean" ? control.expanded : null,
        x: clamp((centerX - left) / width),
        y: clamp((centerY - top) / height),
        left: clamp((finite(rect.left, windowLeft) - windowLeft) / windowWidth),
        top: clamp((finite(rect.top, windowTop) - windowTop) / windowHeight),
        width: clamp(finite(rect.width, 0) / windowWidth),
        height: clamp(finite(rect.height, 0) / windowHeight),
      };
    });
  const controls = dedupeControls(normalizedControls).slice(0, 220);

  return {
    capturedAt: Date.now(),
    activeProcessId: finite(raw.activeProcessId, 0),
    activeWindowHandle: finite(raw.activeWindowHandle, 0),
    activeTitle: typeof raw.activeTitle === "string" ? raw.activeTitle : "Desktop",
    adapter: parseAdapter(raw.adapter),
    accessibilityCount: Math.max(0, Math.round(finite(raw.accessibilityCount, 0))),
    visionCount: Math.max(0, Math.round(finite(raw.visionCount, 0))),
    windowFrame: {
      x: clamp((windowLeft - left) / width),
      y: clamp((windowTop - top) / height),
      width: clamp(windowWidth / width),
      height: clamp(windowHeight / height),
    },
    windows,
    controls,
  };
}

function normalizeWindowProcess(process: unknown, title: unknown): string {
  const processName = typeof process === "string" ? process : "App";
  const windowTitle = typeof title === "string" ? title.trim() : "";
  // Legacy packaged Windows apps are owned by ApplicationFrameHost. Present the
  // actual app title to the mobile client while retaining the real PID/HWND.
  return processName === "ApplicationFrameHost" && windowTitle ? windowTitle : processName;
}

function dedupeControls(controls: SemanticControl[]): SemanticControl[] {
  const useful = controls.filter((control) => {
    const label = control.label.replace(/\s+/g, " ").trim();
    return label.length > 0 && !/^[\s\uE000-\uF8FF\uFFFD]+$/u.test(label);
  });
  const ranked = [...useful].sort((a, b) => rolePriority(b) - rolePriority(a));
  const kept: SemanticControl[] = [];
  for (const control of ranked) {
    const label = control.label.toLocaleLowerCase();
    const duplicate = kept.some((existing) => {
      if (existing.source !== control.source || existing.label.toLocaleLowerCase() !== label) return false;
      if (overlap(existing, control) >= 0.72) return true;
      return existing.interactive && !control.interactive && containsCenter(existing, control);
    });
    if (!duplicate) kept.push(control);
  }
  return kept.sort((a, b) => a.order - b.order || a.top - b.top || a.left - b.left);
}

function rolePriority(control: SemanticControl): number {
  if (control.editable) return 90;
  if (control.kind === "MenuItem" || control.kind === "TabItem") return 80;
  if (control.interactive) return 70;
  if (control.kind === "Document") return 60;
  if (control.kind === "Text") return 20;
  return 40;
}

function overlap(a: SemanticControl, b: SemanticControl): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersection / smaller : 0;
}

function containsCenter(container: SemanticControl, item: SemanticControl): boolean {
  const centerX = item.left + item.width / 2;
  const centerY = item.top + item.height / 2;
  return centerX >= container.left && centerX <= container.left + container.width &&
    centerY >= container.top && centerY <= container.top + container.height;
}

function categoryForKind(
  kind: string,
  editable: boolean,
): SemanticControl["category"] {
  if (editable || ["Edit", "ComboBox"].includes(kind)) return "field";
  if (["CheckBox", "RadioButton"].includes(kind)) return "option";
  if (["MenuItem", "TabItem", "Hyperlink", "TreeItem", "ListItem", "DataItem"].includes(kind)) {
    return "navigation";
  }
  if (["Text", "Document", "HeaderItem", "Image", "VisualText"].includes(kind)) return "content";
  return "action";
}

function cleanText(value: unknown, length: number): string {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function parseAdapter(value: unknown): SemanticSnapshot["adapter"] {
  return value === "accessibility" || value === "hybrid" || value === "vision" || value === "basic"
    ? value
    : "basic";
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
