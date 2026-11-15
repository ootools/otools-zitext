/**
 * Host abstraction for the ZITEXT OTools port.
 *
 * Upstream is a Tauri v2 desktop app: its Rust backend owns the filesystem,
 * native dialogs, clipboard and app-level state. An OTools plugin is a plain
 * webview, so every one of those capabilities is routed through this layer:
 *
 *   1. `window.otools` (the OTools host bridge) — real host files/dialogs.
 *   2. `window.__ZITEXT_HOST_BACKEND__` — an injected test/preview backend.
 *   3. A localStorage-backed virtual filesystem — lets `npm run preview`
 *      render the whole editor in a normal browser without a host.
 *
 * The shim modules only ever talk to `getBackend()`, never to Tauri directly.
 */
import { decodeBase64, encodeBase64 } from './util';

export interface HostFile {
    path: string;
    name: string;
    size: number;
    modified: number;
    bytes: Uint8Array;
}

export interface HostDirEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modified: number;
    isSymlink?: boolean;
}

export interface DialogOptions {
    title?: string;
    kind?: 'info' | 'warning' | 'error';
    okLabel?: string;
    cancelLabel?: string;
}

export interface HostBackend {
    readFile(path: string): Promise<HostFile | null>;
    writeFile(path: string, bytes: Uint8Array): Promise<void>;
    removeFile?(path: string): Promise<void>;
    rename?(from: string, to: string): Promise<void>;
    listDir(path: string): Promise<HostDirEntry[]>;
    pickFile(): Promise<string | null>;
    pickFolder(): Promise<string | null>;
    pickSave(defaultName: string): Promise<string | null>;
    confirm(message: string, options?: DialogOptions): Promise<boolean>;
    message(message: string, options?: DialogOptions): Promise<void>;
    openExternal(url: string): void;
    readClipboard(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    /** Files handed to the plugin by the host ("open with" / drag & drop). */
    consumeOpenFiles?(): Promise<string[]>;
}

type OtoolsWindow = Window & {
    otools?: Record<string, any>;
    utools?: Record<string, any>;
    __ZITEXT_HOST_BACKEND__?: HostBackend;
    __TAURI_INTERNALS__?: { invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> };
    __OToolsEnv?: { pluginUuid?: string; currentFolderPath?: string };
};

const win = (): OtoolsWindow => window as OtoolsWindow;
const api = (): Record<string, any> | undefined => win().otools ?? win().utools;

const basename = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

function normalizeDialogPath(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (value && typeof value === 'object' && typeof (value as any).path === 'string') {
        return String((value as any).path).trim() || null;
    }
    return null;
}

/** Real OTools host. All FS access goes through the documented host API. */
function otoolsBackend(): HostBackend {
    const readFile = async (path: string): Promise<HostFile | null> => {
        const host = api();
        if (!host || typeof host.readHostFile !== 'function') throw new Error('当前不是 OTools 插件运行环境，无法读取本机文件');
        try {
            const payload = await host.readHostFile(path);
            return {
                path: String(payload.path ?? path),
                name: String(payload.name ?? basename(path)),
                size: Number(payload.size ?? 0),
                modified: Number(payload.lastModified ?? 0),
                bytes: decodeBase64(String(payload.dataBase64 ?? '')),
            };
        } catch {
            return null;
        }
    };

    const listDir = async (path: string): Promise<HostDirEntry[]> => {
        const host = api();
        if (!host || typeof host.listHostDir !== 'function') throw new Error('当前不是 OTools 插件运行环境，无法读取本机目录');
        const entries = await host.listHostDir(path);
        if (!Array.isArray(entries)) return [];
        return entries.map((entry: any) => {
            const kind = String(entry.kind ?? '').toLowerCase();
            return {
                name: String(entry.name ?? ''),
                path: String(entry.path ?? ''),
                isDirectory: kind === 'directory' || kind === 'dir' || kind === 'folder',
                size: Number(entry.size ?? 0),
                modified: Number(entry.lastModified ?? 0),
            };
        });
    };

    const dialog = () => api()?.dialog ?? api()?.runtime?.dialog;

    return {
        readFile,
        listDir,
        async writeFile(path, bytes) {
            const host = api();
            if (!host || typeof host.writeHostFile !== 'function') throw new Error('当前不是 OTools 插件运行环境，无法写入本机文件');
            await host.writeHostFile({ path, dataBase64: encodeBase64(bytes) });
        },
        async removeFile(path) {
            const host = api();
            try {
                if (typeof host?.invokeNative === 'function') await host.invokeNative('tools_webview_remove_entry', { path, recursive: false });
                else if (win().__TAURI_INTERNALS__?.invoke) await win().__TAURI_INTERNALS__!.invoke('tools_webview_remove_entry', { path, recursive: false });
            } catch { /* best effort */ }
        },
        async rename(from, to) {
            const host = api();
            const call = async () => {
                if (typeof host?.invokeNative === 'function') {
                    await host.invokeNative('tools_webview_rename_entry', { request: { from, to } });
                    return;
                }
                if (win().__TAURI_INTERNALS__?.invoke) {
                    await win().__TAURI_INTERNALS__!.invoke('tools_webview_rename_entry', { request: { from, to } });
                    return;
                }
                throw new Error('rename unavailable');
            };
            try {
                await call();
            } catch {
                // Older hosts have no rename command: emulate with read + write + remove.
                const file = await readFile(from);
                if (!file) throw new Error('源文件不存在');
                await this.writeFile(to, file.bytes);
                await this.removeFile?.(from);
            }
        },
        async pickFile() {
            const d = dialog();
            const result = d?.open ? await d.open({ multiple: false, title: '打开文件' }) : null;
            if (Array.isArray(result)) return normalizeDialogPath(result[0]);
            return normalizeDialogPath(result);
        },
        async pickFolder() {
            const d = dialog();
            const result = d?.open ? await d.open({ directory: true, multiple: false, title: '打开文件夹' }) : null;
            if (Array.isArray(result)) return normalizeDialogPath(result[0]);
            return normalizeDialogPath(result);
        },
        async pickSave(defaultName) {
            const d = dialog();
            const result = d?.save ? await d.save({ defaultPath: defaultName, title: '另存为' }) : null;
            return normalizeDialogPath(result);
        },
        async confirm(message, options) {
            const d = dialog();
            const ask = d?.ask ?? d?.confirm;
            if (typeof ask === 'function') return Boolean(await ask(message, options ?? {}));
            return window.confirm(message);
        },
        async message(message, options) {
            const d = dialog();
            if (typeof d?.message === 'function') {
                await d.message(message, options ?? {});
                return;
            }
            window.alert(message);
        },
        openExternal(url) {
            const host = api();
            if (typeof host?.shellOpenExternal === 'function') host.shellOpenExternal(url);
            else if (typeof host?.shell?.openExternal === 'function') void host.shell.openExternal(url);
            else window.open(url, '_blank', 'noopener,noreferrer');
        },
        async readClipboard() {
            try {
                return await navigator.clipboard.readText();
            } catch {
                return window.prompt('粘贴剪贴板内容') ?? '';
            }
        },
        async writeClipboard(text) {
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                const host = api();
                if (typeof host?.copyText === 'function') host.copyText(text);
            }
        },
        async consumeOpenFiles() {
            const host = api();
            const pluginUuid = win().__OToolsEnv?.pluginUuid
                ?? new URLSearchParams(window.location.search).get('plugin')
                ?? '';
            if (!pluginUuid) return [];
            const payload = { pluginUuid };
            try {
                if (typeof host?.invokeNative === 'function') {
                    const result = await host.invokeNative('otools_consume_open_files', payload);
                    if (Array.isArray(result)) return result.map(String);
                }
                if (win().__TAURI_INTERNALS__?.invoke) {
                    const result = await win().__TAURI_INTERNALS__!.invoke('otools_consume_open_files', payload);
                    if (Array.isArray(result)) return result.map(String);
                }
            } catch { /* queue is host-owned; not fatal */ }
            return [];
        },
    };
}

/** Browser-only virtual FS: keeps `dist/index.html` usable outside OTools. */
function browserBackend(): HostBackend {
    const KEY = 'zitext.virtual.fs.v1';
    type Stored = { b: string; m: number };
    const read = (): Record<string, Stored> => {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Stored>; }
        catch { return {}; }
    };
    const write = (all: Record<string, Stored>) => {
        try { localStorage.setItem(KEY, JSON.stringify(all)); }
        catch { /* quota exceeded: the preview stays read-only for new files */ }
    };
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const join = (dir: string, name: string) => (norm(dir) === '/' ? `/${name}` : `${norm(dir)}/${name}`);

    return {
        async readFile(path) {
            const entry = read()[norm(path)];
            if (!entry) return null;
            return { path: norm(path), name: basename(norm(path)), size: entry.b.length, modified: entry.m, bytes: decodeBase64(entry.b) };
        },
        async writeFile(path, bytes) {
            const all = read();
            all[norm(path)] = { b: encodeBase64(bytes), m: Date.now() };
            write(all);
        },
        async removeFile(path) {
            const all = read();
            delete all[norm(path)];
            write(all);
        },
        async rename(from, to) {
            const all = read();
            const src = norm(from), dst = norm(to);
            if (!all[src]) throw new Error('源文件不存在');
            all[dst] = all[src];
            delete all[src];
            write(all);
        },
        async listDir(path) {
            const root = norm(path);
            const all = read();
            const prefix = root === '/' ? '/' : `${root}/`;
            const seen = new Map<string, HostDirEntry>();
            for (const filePath of Object.keys(all)) {
                if (!filePath.startsWith(prefix)) continue;
                const rest = filePath.slice(prefix.length);
                const parts = rest.split('/');
                const name = parts[0];
                if (!name) continue;
                const child = join(root, name);
                if (seen.has(child)) continue;
                const isDirectory = parts.length > 1;
                seen.set(child, {
                    name,
                    path: child,
                    isDirectory,
                    size: isDirectory ? 0 : decodeBase64(all[filePath].b).length,
                    modified: all[filePath].m,
                });
            }
            // Empty directories created through "open folder" are kept separately.
            try {
                const dirs = JSON.parse(localStorage.getItem(`${KEY}.dirs`) || '[]') as string[];
                for (const dir of dirs) {
                    if (!dir.startsWith(prefix)) continue;
                    const rest = dir.slice(prefix.length);
                    if (!rest || rest.includes('/')) continue;
                    const child = join(root, rest);
                    if (!seen.has(child)) seen.set(child, { name: rest, path: child, isDirectory: true, size: 0, modified: 0 });
                }
            } catch { /* ignore */ }
            return [...seen.values()];
        },
        async pickFile() {
            return window.prompt('输入要打开的文件路径（浏览器预览模式）', '/virtual/untitled.txt');
        },
        async pickFolder() {
            const value = window.prompt('输入要打开的文件夹路径（浏览器预览模式）', '/virtual');
            if (!value) return null;
            try {
                const dirs = JSON.parse(localStorage.getItem(`${KEY}.dirs`) || '[]') as string[];
                if (!dirs.includes(norm(value))) dirs.push(norm(value));
                localStorage.setItem(`${KEY}.dirs`, JSON.stringify(dirs));
            } catch { /* ignore */ }
            return norm(value);
        },
        async pickSave(defaultName) {
            return window.prompt('输入保存路径（浏览器预览模式）', `/virtual/${defaultName || 'untitled.txt'}`);
        },
        async confirm(message) { return window.confirm(message); },
        async message(message) { window.alert(message); },
        openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); },
        async readClipboard() {
            try { return await navigator.clipboard.readText(); }
            catch { return window.prompt('粘贴剪贴板内容') ?? ''; }
        },
        async writeClipboard(text) {
            try { await navigator.clipboard.writeText(text); }
            catch { /* ignore */ }
        },
    };
}

let cached: HostBackend | null = null;

export function getBackend(): HostBackend {
    if (cached) return cached;
    if (win().__ZITEXT_HOST_BACKEND__) cached = win().__ZITEXT_HOST_BACKEND__!;
    else if (api() && typeof api()!.readHostFile === 'function') cached = otoolsBackend();
    else cached = browserBackend();
    return cached;
}

/** Used by the smoke test / preview harness to replace the backend. */
export function setBackend(backend: HostBackend | null): void {
    cached = backend;
    if (backend) win().__ZITEXT_HOST_BACKEND__ = backend;
}

export const isHostRuntime = (): boolean => Boolean(api() && typeof api()!.readHostFile === 'function');
