/**
 * Host-file key/value store.
 *
 * Why not IndexedDB / localStorage? The plugin runs in the host's
 * `otools-plugin://localhost/<packid>/dist/index.html` page. Custom-scheme
 * origins are not guaranteed a working web-storage stack: `indexedDB.open`
 * can reject and `localStorage` can be an opaque origin, and both of our
 * accessors swallow the error. The visible symptom is "the editor forgets my
 * tabs / settings on every restart" with nothing in the log.
 *
 * So persistence goes through the host filesystem instead, in the same place
 * native plugins keep their data (`~/.otools/local/<packid>/`). Web storage
 * stays as a fallback so `npm run preview` (a real http origin) still works,
 * and as a one-time migration source for people who already have state there.
 *
 * One file per key (`kv-settings.json`, `kv-session.json`, …) so the frequent
 * session snapshot never rewrites the settings document.
 */
import { hasHostCommandChannel, hostCommand, hostLog } from './hostCommand';

const DEFAULT_PACK_ID = 'otools-zitext';

/** `otools-plugin://localhost/<packid>/dist/index.html` → `<packid>`. */
function packId(): string {
    try {
        const first = window.location.pathname.split('/').filter(Boolean)[0];
        if (first) return decodeURIComponent(first);
    } catch { /* fall through */ }
    return DEFAULT_PACK_ID;
}

/** btoa/atob on UTF-8 text, without pulling `util.ts` in (that module imports
 *  this one, and a cycle here would be resolved before `btoa` is reachable). */
function toBase64(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function fromBase64(value: string): string {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

let dirPromise: Promise<string | null> | null = null;
let unavailableReason = '';
/** Reported by the startup diagnostic so a bug report says which store was used. */
let lastBackend: 'host' | 'web' | 'none' = 'none';

export function kvBackend(): 'host' | 'web' | 'none' { return lastBackend; }
export function markWebBackend(): void { if (lastBackend === 'none') lastBackend = 'web'; }

function joinPath(dir: string, name: string): string {
    const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** Directory holding this plugin's state, created on first use. */
function resolveDir(): Promise<string | null> {
    if (dirPromise) return dirPromise;
    dirPromise = (async () => {
        if (!hasHostCommandChannel()) {
            unavailableReason = '宿主命令通道不可用';
            return null;
        }
        const home = await hostCommand<string>('tools_webview_home_dir');
        if (!home) throw new Error('tools_webview_home_dir 返回空');
        const parts = [home, '.otools', 'local', packId()];
        let dir = home;
        for (const part of parts.slice(1)) {
            dir = await hostCommand<string>('tools_webview_join_path', { parts: [dir, part] });
        }
        await hostCommand('tools_webview_create_dir', { path: dir });
        return dir;
    })().catch((error) => {
        unavailableReason = error instanceof Error ? error.message : String(error);
        hostLog(`状态目录不可用，回退到 web 存储：${unavailableReason}`);
        return null;
    });
    return dirPromise;
}

const safeKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'kv';

async function readKey(key: string): Promise<unknown> {
    const dir = await resolveDir();
    if (!dir) return undefined;
    try {
        const payload = await hostCommand<{ dataBase64?: string }>('tools_webview_read_file', {
            path: joinPath(dir, `kv-${safeKey(key)}.json`),
        });
        if (!payload || typeof payload.dataBase64 !== 'string') return undefined;
        lastBackend = 'host';
        return JSON.parse(fromBase64(payload.dataBase64)) as unknown;
    } catch {
        // A missing file is the normal first-run case, not an error.
        return undefined;
    }
}

async function writeKey(key: string, value: unknown): Promise<boolean> {
    const dir = await resolveDir();
    if (!dir) return false;
    try {
        await hostCommand('tools_webview_write_file', {
            request: { path: joinPath(dir, `kv-${safeKey(key)}.json`), dataBase64: toBase64(JSON.stringify(value)) },
        });
        lastBackend = 'host';
        return true;
    } catch (error) {
        hostLog(`写入状态失败 ${key}：${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Coalesces bursts of writes for the same key. The session snapshot fires on a
 * timer and again 2s after each edit; without this the file would be rewritten
 * several times for one burst of typing.
 */
const pending = new Map<string, { value: unknown; timer: number }>();

export function hostKvGet<T>(key: string): Promise<T | undefined> {
    return readKey(key).then((value) => value as T | undefined);
}

export async function hostKvSet(key: string, value: unknown): Promise<boolean> {
    const dir = await resolveDir();
    if (!dir) return false;
    lastBackend = 'host';
    const entry = pending.get(key);
    if (entry) {
        entry.value = value;
        window.clearTimeout(entry.timer);
        entry.timer = window.setTimeout(() => { void flush(key); }, 250);
        return true;
    }
    const timer = window.setTimeout(() => { void flush(key); }, 250);
    pending.set(key, { value, timer });
    return true;
}

async function flush(key: string): Promise<void> {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    window.clearTimeout(entry.timer);
    await writeKey(key, entry.value);
}

/** Writes everything still queued; used before the page goes away. */
export async function hostKvFlush(): Promise<void> {
    await Promise.all([...pending.keys()].map((key) => flush(key)));
}

if (typeof window !== 'undefined') {
    // A panel close tears the page down without waiting for timers.
    window.addEventListener('pagehide', () => { void hostKvFlush(); });
}
