import type { SemanticWindow, ShellApp } from '../types';

export interface OpenAppGroup {
  key: string;
  name: string;
  iconKey: string;
  representative: SemanticWindow;
  windows: SemanticWindow[];
}

export function resolveWindowApp(window: SemanticWindow, apps: ShellApp[]): ShellApp | null {
  const process = normalize(window.process);
  const title = normalize(window.title);
  return apps.find((app) => {
    const name = normalize(app.name);
    if (!name) return false;
    if (name === process || name === title || title.startsWith(name)) return true;
    if (process.length >= 4 && (name.endsWith(process) || name.startsWith(process))) return true;
    if (name === 'fileexplorer' && process === 'explorer') return true;
    return false;
  }) ?? null;
}

export function resolveWindowIconKey(window: SemanticWindow, apps: ShellApp[]): string {
  return resolveWindowApp(window, apps)?.iconKey ?? window.iconKey;
}

export function windowDisplayName(window: SemanticWindow, apps: ShellApp[]): string {
  const app = resolveWindowApp(window, apps);
  return app?.name ?? friendlyName(window.process);
}

export function groupOpenWindows(windows: SemanticWindow[], apps: ShellApp[]): OpenAppGroup[] {
  const groups = new Map<string, OpenAppGroup>();

  for (const window of windows) {
    const app = resolveWindowApp(window, apps);
    const identity = app
      ? `app:${app.id}`
      : `process:${normalize(window.process) || normalize(window.title) || window.processId}`;
    const existing = groups.get(identity);

    if (!existing) {
      groups.set(identity, {
        key: identity,
        name: app?.name ?? friendlyName(window.process),
        iconKey: app?.iconKey ?? window.iconKey,
        representative: window,
        windows: [window],
      });
      continue;
    }

    existing.windows.push(window);
    if (window.active && !existing.representative.active) existing.representative = window;
  }

  return [...groups.values()].sort((a, b) => {
    if (a.representative.active !== b.representative.active) {
      return a.representative.active ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\.exe$/i, '').replace(/[^a-z0-9]+/g, '');
}

function friendlyName(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
