/**
 * Large File / Log viewer backend.
 *
 * Upstream streams and indexes arbitrarily large files in Rust. An OTools
 * webview has no random-access file handle, so this implementation reads the
 * file once through the host API and keeps the decoded lines in memory. It is
 * bounded (256 MB) but keeps every viewer feature: paged lines, include/exclude
 * filters, search, go-to-time, live refresh, highlight-rule export and export
 * to a file chosen by the host save dialog.
 */
import { getBackend } from '../host';
import { normalizePath } from '../util';

const MAX_LARGE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_DISPLAY_LINE = 4000;

interface Rule { pattern: string; regex?: boolean; caseSensitive?: boolean }
interface Filter { include?: Rule[]; exclude?: Rule[]; matchAll?: boolean }

interface Session {
    id: number;
    path: string;
    size: number;
    lines: string[];
    rotations: number;
    missing: boolean;
    error: string | null;
    filter: Filter | null;
    filtered: number[];
}

const sessions = new Map<number, Session>();
let nextId = 1;

const statusOf = (session: Session) => ({
    id: session.id,
    path: session.path,
    size: session.size,
    indexedBytes: session.size,
    lineCount: session.lines.length,
    indexing: false,
    rotations: session.rotations,
    missing: session.missing,
    error: session.error,
});

function sessionOf(id: unknown): Session {
    const session = sessions.get(Number(id));
    if (!session) throw new Error('Unknown large-file session');
    return session;
}

const compileRule = (rule: Rule): RegExp | null => {
    if (!rule?.pattern) return null;
    try {
        const source = rule.regex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(source, rule.caseSensitive ? 'u' : 'iu');
    } catch { return null; }
};

const matchesFilter = (line: string, filter: Filter): boolean => {
    const includes = (filter.include ?? []).map(compileRule).filter((r): r is RegExp => Boolean(r));
    const excludes = (filter.exclude ?? []).map(compileRule).filter((r): r is RegExp => Boolean(r));
    if (excludes.some((regex) => regex.test(line))) return false;
    if (includes.length === 0) return true;
    return filter.matchAll ? includes.every((regex) => regex.test(line)) : includes.some((regex) => regex.test(line));
};

const lineObject = (index: number, text: string) => ({
    number: index,
    text: text.length > MAX_DISPLAY_LINE ? text.slice(0, MAX_DISPLAY_LINE) : text,
    truncated: text.length > MAX_DISPLAY_LINE,
});

const splitLines = (text: string): string[] => {
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
};

function recomputeFilter(session: Session) {
    session.filtered = session.filter
        ? session.lines.reduce<number[]>((acc, line, index) => {
            if (matchesFilter(line, session.filter!)) acc.push(index);
            return acc;
        }, [])
        : [];
}

const filterStatus = (session: Session) => ({
    active: Boolean(session.filter),
    matched: session.filtered.length,
    scannedLines: session.lines.length,
    done: true,
    error: null,
});

export async function largeFileOpen(args: Record<string, unknown>) {
    const path = normalizePath(String(args.path ?? ''));
    const file = await getBackend().readFile(path);
    if (!file) throw new Error(`File not found: ${path}`);
    if (file.size > MAX_LARGE_FILE_BYTES) {
        throw new Error(`文件过大（${(file.size / 1_048_576).toFixed(0)} MB），日志查看器上限 256 MB`);
    }
    const text = new TextDecoder('utf-8').decode(file.bytes);
    const session: Session = {
        id: nextId++,
        path,
        size: file.size,
        lines: splitLines(text),
        rotations: 0,
        missing: false,
        error: null,
        filter: null,
        filtered: [],
    };
    sessions.set(session.id, session);
    return statusOf(session);
}

export async function largeFileStatus(args: Record<string, unknown>) {
    return statusOf(sessionOf(args.id));
}

export async function largeFileRefresh(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const file = await getBackend().readFile(session.path);
    if (!file) {
        session.missing = true;
        return statusOf(session);
    }
    session.missing = false;
    if (file.size < session.size) session.rotations += 1;
    session.size = file.size;
    session.lines = splitLines(new TextDecoder('utf-8').decode(file.bytes));
    recomputeFilter(session);
    return statusOf(session);
}

export async function largeFileLines(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const start = Math.max(0, Number(args.start ?? 0));
    const count = Math.max(0, Math.min(1000, Number(args.count ?? 200)));
    const result = [];
    for (let i = start; i < Math.min(session.lines.length, start + count); i += 1) {
        result.push(lineObject(i, session.lines[i]));
    }
    return result;
}

export async function largeFileSetFilter(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    session.filter = (args.filter ?? null) as Filter | null;
    recomputeFilter(session);
    return filterStatus(session);
}

export async function largeFileFilterStatus(args: Record<string, unknown>) {
    return filterStatus(sessionOf(args.id));
}

export async function largeFileFilteredLines(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const start = Math.max(0, Number(args.start ?? 0));
    const count = Math.max(0, Math.min(1000, Number(args.count ?? 200)));
    const result = [];
    for (let i = start; i < Math.min(session.filtered.length, start + count); i += 1) {
        const index = session.filtered[i];
        result.push(lineObject(index, session.lines[index]));
    }
    return result;
}

export async function largeFileSearch(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const rule = compileRule((args.rule ?? {}) as Rule);
    if (!rule) return { line: null, stoppedAt: null };
    const backwards = Boolean(args.backwards);
    const from = args.fromLine === null || args.fromLine === undefined ? null : Number(args.fromLine);
    const last = session.lines.length - 1;
    if (backwards) {
        const start = from === null ? last : Math.min(last, from - 1);
        for (let i = start; i >= 0; i -= 1) if (rule.test(session.lines[i])) return { line: i, stoppedAt: null };
    } else {
        const start = from === null ? 0 : Math.max(0, from + 1);
        for (let i = start; i <= last; i += 1) if (rule.test(session.lines[i])) return { line: i, stoppedAt: null };
    }
    return { line: null, stoppedAt: null };
}

export async function largeFileFindTime(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const target = String(args.target ?? '').trim();
    const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(target);
    if (!match) return null;
    const wanted = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
    for (let i = 0; i < session.lines.length; i += 1) {
        const found = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(session.lines[i]);
        if (!found) continue;
        const value = Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3] ?? 0);
        if (value >= wanted) return i;
    }
    return null;
}

export async function largeFileExport(args: Record<string, unknown>) {
    const session = sessionOf(args.id);
    const destination = normalizePath(String(args.destination ?? ''));
    const selection = (args.selection ?? { kind: 'all' }) as Record<string, unknown>;
    let indexes: number[] = [];
    switch (selection.kind) {
        case 'filtered':
            indexes = [...session.filtered];
            break;
        case 'range':
            indexes = session.lines.map((_, i) => i).slice(Number(selection.start ?? 0), Number(selection.end ?? 0) + 1);
            break;
        case 'lines':
            indexes = (Array.isArray(selection.lines) ? selection.lines : []).map(Number);
            break;
        case 'matching': {
            const rules = ((Array.isArray(selection.rules) ? selection.rules : []) as Rule[])
                .map(compileRule).filter((r): r is RegExp => Boolean(r));
            indexes = session.lines.reduce<number[]>((acc, line, i) => {
                if (rules.some((regex) => regex.test(line))) acc.push(i);
                return acc;
            }, []);
            break;
        }
        default:
            indexes = session.lines.map((_, i) => i);
    }
    const text = indexes.map((i) => session.lines[i] ?? '').join('\n');
    const bytes = new TextEncoder().encode(text.endsWith('\n') ? text : `${text}\n`);
    await getBackend().writeFile(destination, bytes);
    return indexes.length;
}

export async function largeFileClose(args: Record<string, unknown>): Promise<void> {
    sessions.delete(Number(args.id));
}

/** Used by tests to avoid leaking sessions between cases. */
export const __largeFileSessionCount = () => sessions.size;
