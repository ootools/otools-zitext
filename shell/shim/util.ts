/** Shared helpers for the OTools port of ZITEXT (no Tauri dependency). */

export function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
export const ENCODING_UTF8 = 'UTF-8';
export const ENCODING_UTF8_BOM = 'UTF-8 with BOM';
export const ENCODING_WINDOWS_1252 = 'Windows-1252';

export function decodeText(bytes: Uint8Array): { content: string; encoding: string } {
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
        throw new Error("This file is UTF-16 encoded, which ZITEXT can't edit yet. Convert it to UTF-8 to open it.");
    }
    const hasBom = bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2];
    const body = hasBom ? bytes.subarray(3) : bytes;
    try {
        return { content: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: hasBom ? ENCODING_UTF8_BOM : ENCODING_UTF8 };
    } catch {
        const decoder = new TextDecoder('windows-1252');
        return { content: decoder.decode(bytes), encoding: ENCODING_WINDOWS_1252 };
    }
}

const CP1252_SPECIAL: Record<string, number> = {
    '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85,
    '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a,
    '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
    '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
    '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b, '\u0153': 0x9c,
    '\u017e': 0x9e, '\u0178': 0x9f,
};

export function encodeText(content: string, encoding: string): Uint8Array {
    if (encoding === ENCODING_WINDOWS_1252) {
        const bytes = new Uint8Array(content.length);
        for (let i = 0; i < content.length; i += 1) {
            const ch = content[i];
            const code = content.charCodeAt(i);
            const byte = CP1252_SPECIAL[ch] ?? (code <= 0xff ? code : -1);
            if (byte < 0) {
                throw new Error('ZITEXT_ENCODING_UNREPRESENTABLE: this document contains characters that cannot be represented in Windows-1252.');
            }
            bytes[i] = byte;
        }
        return bytes;
    }
    const body = new TextEncoder().encode(content);
    if (encoding !== ENCODING_UTF8_BOM) return body;
    const withBom = new Uint8Array(body.length + 3);
    withBom.set(UTF8_BOM);
    withBom.set(body, 3);
    return withBom;
}

/** Hex SHA-256 when WebCrypto is available; a stable 64-bit FNV hash otherwise.
 *  The hash is only used to detect a file changing between open and save, so a
 *  non-cryptographic fallback is sufficient on non-secure webview origins. */
export async function contentHash(bytes: Uint8Array): Promise<string> {
    try {
        const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
        let a = 0xcbf29ce484222325n;
        let b = 0x100000001b3n;
        for (const byte of bytes) {
            a = ((a ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
            b = ((b + BigInt(byte)) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
        }
        return a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0');
    }
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function assertTextFile(bytes: Uint8Array): void {
    const checkLength = Math.min(bytes.length, 8192);
    for (let i = 0; i < checkLength; i += 1) {
        if (bytes[i] === 0) {
            throw new Error('This file appears to be binary. ZITEXT is a text editor and cannot display binary content.');
        }
    }
}

export function normalizePath(path: string): string {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

export function joinPath(dir: string, name: string): string {
    const base = normalizePath(dir);
    return base === '/' ? `/${name}` : `${base}/${name}`;
}

export function dirname(path: string): string {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf('/');
    if (index < 0) return '';
    if (index === 0) return '/';
    return normalized.slice(0, index);
}

export function basename(path: string): string {
    return normalizePath(path).split('/').pop() || '';
}

export const fileIdentity = (path: string, size: number, modified: number): string => `${normalizePath(path)}:${size}:${modified}`;

/** Async key/value store backed by IndexedDB (crash-recovery snapshots can be
 *  several MB, well past localStorage's quota), with a localStorage fallback. */
const DB_NAME = 'otools-zitext';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(null); return; }
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        } catch { resolve(null); }
    });
    return dbPromise;
}

function localKey(key: string): string { return `zitext.kv.${key}`; }

export async function kvGet<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    if (db) {
        try {
            return await new Promise<T | undefined>((resolve, reject) => {
                const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                request.onsuccess = () => resolve(request.result as T | undefined);
                request.onerror = () => reject(request.error);
            });
        } catch { /* fall through to localStorage */ }
    }
    try {
        const raw = localStorage.getItem(localKey(key));
        return raw === null ? undefined : JSON.parse(raw) as T;
    } catch { return undefined; }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    if (db) {
        try {
            await new Promise<void>((resolve, reject) => {
                const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            return;
        } catch { /* fall through to localStorage */ }
    }
    try { localStorage.setItem(localKey(key), JSON.stringify(value)); }
    catch { /* quota exceeded: persistence is best-effort in browser preview */ }
}

export const kvHas = async (key: string): Promise<boolean> => (await kvGet(key)) !== undefined;
