/**
 * Application-level commands that upstream stores in the OS app-data folder:
 * settings, recent files, crash-recovery session, scratchpad, startup files,
 * native dialogs and external links.
 *
 * All state lives in the plugin's own IndexedDB store (never in the host), and
 * dialogs go through the OTools host so the user always picks real paths.
 */
import { emit } from '../event';
import { getBackend, hostLog, isHostRuntime } from '../host';
import { kvGet, kvHas, kvSet } from '../util';

const DEFAULT_SETTINGS = {
    theme: 'system',
    fontFamily: '"JetBrains Mono", "Menlo", "Monaco", "Consolas", monospace',
    uiFont: '"Space Grotesk", system-ui, sans-serif',
    fontSize: 14,
    wordWrap: false,
    recentFiles: [] as string[],
    lastSession: [] as unknown[],
    autosave: 'off',
    autosaveDelay: 2000,
    showMinimap: false,
    editorTheme: 'vs-dark',
    keybindings: {} as Record<string, string>,
    openedFolder: null as string | null,
    sidebarWidth: 250,
    sidebarCollapsed: false,
    activeTabPath: null as string | null,
    enableColumnSelection: false,
    tabSize: 4,
    insertSpaces: true,
    formatOnSave: false,
    checkForUpdates: false,
};

type Settings = typeof DEFAULT_SETTINGS;

async function loadSettings(): Promise<Settings> {
    const stored = await kvGet<Partial<Settings>>('settings');
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}), lastSession: [] };
}

async function saveSettings(settings: Settings): Promise<void> {
    await kvSet('settings', { ...settings, lastSession: [] });
}

export async function settingsFileExists(): Promise<boolean> {
    return kvHas('settings');
}

export async function readSettings(): Promise<Settings> {
    return loadSettings();
}

export async function writeSettings(args: Record<string, unknown>): Promise<void> {
    const settings = (args.settings ?? {}) as Partial<Settings>;
    await saveSettings({ ...(await loadSettings()), ...settings });
}

export async function setOpenedFolder(args: Record<string, unknown>): Promise<void> {
    const settings = await loadSettings();
    await saveSettings({ ...settings, openedFolder: (args.path as string | null) ?? null });
}

export async function addRecentFile(args: Record<string, unknown>): Promise<void> {
    const path = String(args.path ?? '');
    if (!path) return;
    const settings = await loadSettings();
    const recent = [path, ...settings.recentFiles.filter((item) => item !== path)].slice(0, 20);
    await saveSettings({ ...settings, recentFiles: recent });
}

export async function getRecentFiles(): Promise<string[]> {
    return (await loadSettings()).recentFiles;
}

export async function saveSession(args: Record<string, unknown>): Promise<void> {
    const session = Array.isArray(args.session) ? args.session : [];
    await kvSet('session', session);
}

export async function getLastSession(): Promise<unknown[]> {
    const session = await kvGet<unknown[]>('session');
    return Array.isArray(session) ? session : [];
}

export async function readScratchpad(): Promise<string> {
    const value = await kvGet<string>('scratchpad');
    return typeof value === 'string' ? value : '';
}

export async function writeScratchpad(args: Record<string, unknown>): Promise<void> {
    await kvSet('scratchpad', String(args.content ?? ''));
}

export async function appendCrashLog(args: Record<string, unknown>): Promise<void> {
    const lines = (await kvGet<string[]>('crash-log')) ?? [];
    lines.push(String(args.line ?? ''));
    await kvSet('crash-log', lines.slice(-200));
}

/** Dialogs are host-owned. Upstream listens for the result event before it
 *  calls `request_menu_action`, so emitting after the picker resolves works. */
export async function requestMenuAction(args: Record<string, unknown>): Promise<void> {
    const action = String(args.action ?? '');
    const backend = getBackend();
    hostLog(`request_menu_action=${action} backend=${isHostRuntime() ? 'host' : 'browser'}`
        + ` otools=${Boolean((window as any).otools)} tauri=${Boolean((window as any).__TAURI_INTERNALS__)}`);
    let result: string | null = null;
    if (action === 'open') {
        result = await pickOrReport(() => backend.pickFile(), '打开文件');
        await emit('open-from-dialog', result);
    } else if (action === 'open_folder') {
        result = await pickOrReport(() => backend.pickFolder(), '打开文件夹');
        await emit('folder-from-dialog', result);
    } else if (action === 'save_as') {
        result = await pickOrReport(() => backend.pickSave(String(args.defaultName ?? '')), '另存为');
        await emit('save-from-dialog', result);
    } else {
        throw new Error(`Unknown menu action: ${action}`);
    }
}

/**
 * A picker that throws must never look like "nothing happened": the upstream
 * UI only sees `null` (user cancelled) and would silently stay unchanged.
 */
async function pickOrReport(pick: () => Promise<string | null>, label: string): Promise<string | null> {
    try {
        return await pick();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[zitext] ${label}失败`, error);
        try {
            await getBackend().message(`${label}失败：${message}`, { title: 'ZITEXT', kind: 'error' });
        } catch { /* reporting is best effort */ }
        return null;
    }
}

const deliveredAt = new Map<string, number>();
let pollingStarted = false;

function startOpenFilePolling(): void {
    if (pollingStarted) return;
    pollingStarted = true;
    const backend = getBackend();
    if (typeof backend.consumeOpenFiles !== 'function') return;
    const deliver = async () => {
        let files: string[] = [];
        try { files = await backend.consumeOpenFiles!(); }
        catch { return; }
        const now = Date.now();
        for (const path of files) {
            if (!path || now - (deliveredAt.get(path) ?? 0) < 3000) continue;
            deliveredAt.set(path, now);
            await emit('open-file', path);
        }
        if (deliveredAt.size > 256) {
            for (const [path, at] of deliveredAt) if (now - at >= 3000) deliveredAt.delete(path);
        }
    };
    // The first batch is returned by `get_startup_args` (upstream opens it
    // itself), so only later arrivals are delivered as `open-file` events.
    window.setInterval(() => { void deliver(); }, 1500);
}

function queryOpenFiles(): string[] {
    try {
        const raw = new URLSearchParams(window.location.search).get('otoolsOpenFile');
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch { return []; }
}

export async function getStartupArgs(): Promise<string[]> {
    startOpenFilePolling();
    const backend = getBackend();
    let fromHost: string[] = [];
    if (typeof backend.consumeOpenFiles === 'function') {
        try { fromHost = await backend.consumeOpenFiles(); }
        catch { /* host queue is optional */ }
    }
    const all = [...queryOpenFiles(), ...fromHost];
    for (const path of all) deliveredAt.set(path, Date.now());
    return [...new Set(all)];
}

export async function getStartupFolder(): Promise<string | null> {
    const env = (window as any).__OToolsEnv?.currentFolderPath;
    const fromQuery = new URLSearchParams(window.location.search).get('otoolsOpenFolder');
    return (typeof env === 'string' && env.trim() ? env : null) ?? fromQuery ?? null;
}

export function openUrlInBrowser(args: Record<string, unknown>): void {
    getBackend().openExternal(String(args.url ?? ''));
}

/** No-ops: the host owns the window, its native menu and path grants. */
export const noop = (): void => {};
