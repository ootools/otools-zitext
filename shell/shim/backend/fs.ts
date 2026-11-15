/**
 * Filesystem commands (`read_file_content`, `write_file_content`,
 * `read_directory`, `get_file_metadata`, `search_in_files`, …) reimplemented
 * against the OTools host filesystem API.
 *
 * The JSON shapes mirror `src-tauri/src/lib.rs` exactly — including the mixed
 * snake_case / camelCase naming, which the upstream TypeScript expects.
 */
import { getBackend, type HostDirEntry } from '../host';
import {
    MAX_FILE_SIZE, assertTextFile, basename, contentHash, decodeText, encodeText,
    fileIdentity, normalizePath,
} from '../util';

const MAX_DIRECTORY_DEPTH = 10;
const MAX_DIRECTORY_ENTRIES = 5000;
const MAX_SEARCH_FILES_VISITED = 50_000;
const MAX_SEARCH_DURATION_MS = 30_000;
const MAX_SEARCH_RESULTS = 500;
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_NAME_MATCHES = 1000;
const MAX_COUNTED_FILES = 100_000;

const GENERATED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', 'target', 'dist', 'build', 'out',
    '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache', 'coverage',
    '.idea', '.vscode', 'vendor', '.gradle', 'bin', 'obj',
]);

const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'bz2',
    'xz', '7z', 'rar', 'tar', 'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac',
    'ogg', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'exe', 'dll', 'so', 'dylib',
    'o', 'a', 'class', 'jar', 'wasm', 'pyc', 'db', 'sqlite', 'sqlite3', 'dmg',
    'msi', 'deb', 'rpm', 'iso', 'psd', 'ai', 'sketch', 'heic', 'avif',
]);

const isTextFile = (path: string): boolean => {
    const ext = basename(path).includes('.') ? basename(path).split('.').pop()!.toLowerCase() : '';
    return !BINARY_EXTENSIONS.has(ext);
};

const clean = (path: string) => normalizePath(path);

interface FileEntry {
    name: string;
    path: string;
    is_directory: boolean;
    size?: number;
    modified?: number;
}

function toFileEntry(entry: HostDirEntry): FileEntry {
    return {
        name: entry.name,
        path: clean(entry.path),
        is_directory: entry.isDirectory,
        size: entry.isDirectory ? undefined : entry.size,
        modified: entry.modified || undefined,
    };
}

/** Walks a folder. `collect` decides which entries make it into the result. */
async function walk(
    root: string,
    recursive: boolean,
    onEntry: (entry: HostDirEntry, depth: number) => boolean | void | Promise<boolean | void>,
    onDirectory?: (entry: HostDirEntry, depth: number) => boolean | void | Promise<boolean | void>,
): Promise<{ truncated: boolean; hiddenLinks: number }> {
    let truncated = false;
    let hiddenLinks = 0;

    const visit = async (dir: string, depth: number): Promise<void> => {
        if (depth > MAX_DIRECTORY_DEPTH) { truncated = true; return; }
        let entries: HostDirEntry[];
        try { entries = await getBackend().listDir(dir); }
        catch { return; }
        for (const entry of entries) {
            if (entry.isSymlink) { hiddenLinks += 1; continue; }
            if (entry.isDirectory) {
                if ((await onDirectory?.(entry, depth)) === false) continue;
                if (recursive) {
                    if (GENERATED_DIRS.has(entry.name)) continue;
                    await visit(entry.path, depth + 1);
                }
            } else {
                await onEntry(entry, depth);
            }
        }
    };

    await visit(clean(root), 0);
    return { truncated, hiddenLinks };
}

export async function readFileContent(args: Record<string, unknown>) {
    const path = clean(String(args.path ?? ''));
    const file = await getBackend().readFile(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(file.size / 1_048_576).toFixed(1)} MB). Maximum supported size is 10 MB`);
    }
    assertTextFile(file.bytes);
    const { content, encoding } = decodeText(file.bytes);
    return {
        path: clean(file.path),
        content,
        size: file.size,
        encoding,
        modified: file.modified,
        hash: await contentHash(file.bytes),
        identity: fileIdentity(file.path, file.size, file.modified),
    };
}

export async function writeFileContent(args: Record<string, unknown>) {
    const path = clean(String(args.path ?? ''));
    const content = String(args.content ?? '');
    const encoding = String(args.encoding || 'UTF-8');
    const expectedModified = args.expectedModified === undefined || args.expectedModified === null ? null : Number(args.expectedModified);
    const expectedSize = args.expectedSize === undefined || args.expectedSize === null ? null : Number(args.expectedSize);
    const expectedHash = args.expectedHash == null ? null : String(args.expectedHash);

    if (expectedHash !== null) {
        const current = await getBackend().readFile(path);
        if (!current) throw new Error('ZITEXT_FILE_CONFLICT: file changed or was removed before save');
        const currentHash = await contentHash(current.bytes);
        if (expectedModified !== current.modified || expectedSize !== current.size || expectedHash !== currentHash) {
            throw new Error('ZITEXT_FILE_CONFLICT: file changed on disk since it was opened. Reload or review the external change before saving.');
        }
    }

    const bytes = encodeText(content, encoding);
    if (bytes.length > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(bytes.length / 1_048_576).toFixed(1)} MB). Maximum supported size is 10 MB`);
    }
    await getBackend().writeFile(path, bytes);
    const saved = await getBackend().readFile(path);
    const size = saved?.size ?? bytes.length;
    const modified = saved?.modified ?? Date.now();
    return {
        encoding,
        size,
        modified,
        hash: await contentHash(bytes),
        identity: fileIdentity(path, size, modified),
    };
}

export async function readDirectory(args: Record<string, unknown>) {
    const root = clean(String(args.path ?? ''));
    const recursive = Boolean(args.recursive);
    const entries: FileEntry[] = [];
    const { truncated, hiddenLinks } = await walk(root, recursive, (entry) => {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) return false;
        entries.push(toFileEntry(entry));
    }, (entry) => {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) return false;
        entries.push(toFileEntry(entry));
    });
    return { entries, truncated: truncated || entries.length >= MAX_DIRECTORY_ENTRIES, hiddenLinks };
}

export async function findFilesByName(args: Record<string, unknown>) {
    const folder = clean(String(args.folder ?? ''));
    const query = String(args.query ?? '').toLowerCase();
    const matched = new Set<string>();
    // Ancestor folders of every match are included so the tree can expand to it.
    const includeParents = (file: string) => {
        let current = normalizePath(file);
        while (current && current !== '/' && current !== folder) {
            const parent = current.slice(0, Math.max(0, current.lastIndexOf('/'))) || '/';
            if (parent === current) break;
            // The search root itself is not a tree row: buildFileTree() uses it
            // as the parent of every returned entry.
            if (parent !== folder && parent !== '/' && !matched.has(parent)) matched.add(parent);
            current = parent;
            if (parent === '/' || parent === folder) break;
        }
    };
    let truncated = false;
    const directories = new Set<string>();
    const sizes = new Map<string, number>();
    const modifiedTimes = new Map<string, number>();
    await walk(folder, true, (entry) => {
        sizes.set(clean(entry.path), entry.size);
        modifiedTimes.set(clean(entry.path), entry.modified);
        if (!query || entry.name.toLowerCase().includes(query)) {
            if (matched.size < MAX_NAME_MATCHES) {
                matched.add(clean(entry.path));
                includeParents(entry.path);
            } else truncated = true;
        }
    }, (entry) => {
        directories.add(clean(entry.path));
        if (GENERATED_DIRS.has(entry.name)) return false;
    });
    const entries: FileEntry[] = [];
    for (const path of matched) {
        const isDirectory = directories.has(path);
        entries.push({
            name: basename(path),
            path,
            is_directory: isDirectory,
            size: isDirectory ? undefined : sizes.get(path),
            modified: isDirectory ? undefined : modifiedTimes.get(path),
        });
    }
    return { entries, truncated };
}

export async function countProjectFiles(args: Record<string, unknown>) {
    const root = clean(String(args.path ?? ''));
    let count = 0;
    let partial = false;
    await walk(root, true, () => {
        count += 1;
        if (count >= MAX_COUNTED_FILES) partial = true;
    }, (entry) => {
        if (GENERATED_DIRS.has(entry.name)) { partial = true; return false; }
    });
    return { count, partial };
}

async function metadata(path: string) {
    const normalized = clean(path);
    const file = await getBackend().readFile(normalized);
    if (!file) return { modified: 0, size: 0, exists: false, identity: '' };
    return {
        modified: file.modified,
        size: file.size,
        exists: true,
        identity: fileIdentity(normalized, file.size, file.modified),
    };
}

export const getFileMetadata = (args: Record<string, unknown>) => metadata(String(args.path ?? ''));

export async function getFilesMetadata(args: Record<string, unknown>) {
    const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
    return Promise.all(paths.map(async (path) => ({ path: clean(path), ...(await metadata(path)) })));
}

export async function renameFile(args: Record<string, unknown>): Promise<boolean> {
    const oldPath = clean(String(args.oldPath ?? ''));
    const newPath = clean(String(args.newPath ?? ''));
    if (!oldPath || !newPath || oldPath === newPath) return false;
    const backend = getBackend();
    const source = await backend.readFile(oldPath);
    if (!source) return false;
    if (await backend.readFile(newPath)) throw new Error('目标文件已存在');
    if (typeof backend.rename === 'function') await backend.rename(oldPath, newPath);
    else {
        await backend.writeFile(newPath, source.bytes);
        await backend.removeFile?.(oldPath);
    }
    return true;
}

export async function searchInFiles(args: Record<string, unknown>) {
    const folder = clean(String(args.folder ?? ''));
    const query = String(args.query ?? '');
    const caseSensitive = Boolean(args.caseSensitive);
    const wholeWord = Boolean(args.wholeWord);
    const empty = {
        matches: [], resultLimitReached: false, stoppedEarly: false,
        skippedLargeFiles: 0, skippedEncodingFiles: 0, skippedDeepFolders: 0, skippedLinks: 0,
    };
    if (!query || !folder) return empty;

    const needle = caseSensitive ? query : query.toLowerCase();
    const started = Date.now();
    let visited = 0;
    let responseBytes = 0;
    let stoppedEarly = false;
    let skippedLargeFiles = 0;
    let skippedEncodingFiles = 0;
    let skippedDeepFolders = 0;
    const matches: Array<Record<string, unknown>> = [];

    const pushMatch = (filePath: string, lineIndex: number, line: string, start: number) => {
        matches.push({
            file_path: clean(filePath),
            line_number: lineIndex + 1,
            line_content: line.slice(0, 4096),
            match_start: start,
            match_end: start + query.length,
        });
        responseBytes += line.length + 80;
    };

    await walk(folder, true, async (entry) => {
        if (matches.length >= MAX_SEARCH_RESULTS) return;
        visited += 1;
        if (visited > MAX_SEARCH_FILES_VISITED || Date.now() - started > MAX_SEARCH_DURATION_MS || responseBytes > MAX_SEARCH_RESPONSE_BYTES) {
            stoppedEarly = true;
            return;
        }
        if (!isTextFile(entry.path)) return;
        if (entry.size > MAX_FILE_SIZE) { skippedLargeFiles += 1; return; }
        const file = await getBackend().readFile(entry.path);
        if (!file) return;
        if (file.bytes[0] === 0xff && file.bytes[1] === 0xfe) { skippedEncodingFiles += 1; return; }
        let text: string;
        try { text = decodeText(file.bytes).content; }
        catch { skippedEncodingFiles += 1; return; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_RESULTS; i += 1) {
            const line = lines[i];
            const haystack = caseSensitive ? line : line.toLowerCase();
            let from = 0;
            let index = haystack.indexOf(needle, from);
            while (index >= 0 && matches.length < MAX_SEARCH_RESULTS) {
                const before = index > 0 ? haystack[index - 1] : '';
                const after = haystack[index + needle.length] ?? '';
                const wordOk = !wholeWord || !(/[\p{L}\p{N}_]/u.test(before) || /[\p{L}\p{N}_]/u.test(after));
                if (wordOk) pushMatch(entry.path, i, line, index);
                from = index + Math.max(1, needle.length);
                index = haystack.indexOf(needle, from);
            }
        }
    }, (entry) => {
        if (GENERATED_DIRS.has(entry.name)) return false;
    });

    return {
        matches,
        resultLimitReached: matches.length >= MAX_SEARCH_RESULTS,
        stoppedEarly,
        skippedLargeFiles,
        skippedEncodingFiles,
        skippedDeepFolders,
        skippedLinks: 0,
    };
}
