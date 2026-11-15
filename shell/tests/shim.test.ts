/**
 * 移植层回归测试：宿主适配层必须完整复刻上游 Rust 后端的 JSON 契约。
 * 用一个内存文件系统替身替掉 window.otools，跑在 jsdom 里。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { invoke } from '../shim/core';
import { emit, listen } from '../shim/event';
import { setBackend, type HostBackend, type HostDirEntry } from '../shim/host';

class MemoryBackend implements HostBackend {
    files = new Map<string, { bytes: Uint8Array; modified: number }>();
    dirs = new Set<string>(['/work', '/work/sub']);
    nextPath: string | null = '/work/saved.txt';
    seenEvents: string[] = [];

    private norm(path: string) { return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'; }

    async readFile(path: string) {
        const entry = this.files.get(this.norm(path));
        if (!entry) return null;
        return {
            path: this.norm(path),
            name: this.norm(path).split('/').pop() || '',
            size: entry.bytes.length,
            modified: entry.modified,
            bytes: entry.bytes,
        };
    }
    async writeFile(path: string, bytes: Uint8Array) {
        this.files.set(this.norm(path), { bytes, modified: Date.now() + this.files.size });
    }
    async removeFile(path: string) { this.files.delete(this.norm(path)); }
    async rename(from: string, to: string) {
        const entry = this.files.get(this.norm(from));
        if (!entry) throw new Error('missing');
        this.files.set(this.norm(to), entry);
        this.files.delete(this.norm(from));
    }
    async listDir(path: string): Promise<HostDirEntry[]> {
        const root = this.norm(path);
        const prefix = root === '/' ? '/' : `${root}/`;
        const found = new Map<string, HostDirEntry>();
        for (const dir of this.dirs) {
            if (!dir.startsWith(prefix)) continue;
            const rest = dir.slice(prefix.length);
            if (!rest || rest.includes('/')) continue;
            const child = `${prefix}${rest}`;
            found.set(child, { name: rest, path: child, isDirectory: true, size: 0, modified: 0 });
        }
        for (const [file, entry] of this.files) {
            if (!file.startsWith(prefix)) continue;
            const rest = file.slice(prefix.length);
            if (!rest) continue;
            const name = rest.split('/')[0];
            const child = `${prefix}${name}`;
            const isDirectory = rest.includes('/');
            found.set(child, {
                name,
                path: child,
                isDirectory,
                size: isDirectory ? 0 : entry.bytes.length,
                modified: entry.modified,
            });
        }
        return [...found.values()];
    }
    async pickFile() { return this.nextPath; }
    async pickFolder() { return '/work'; }
    async pickSave(defaultName: string) { return this.nextPath ?? `/work/${defaultName}`; }
    async confirm() { return true; }
    async message() { this.seenEvents.push('message'); }
    openExternal(url: string) { this.seenEvents.push(`external:${url}`); }
    async readClipboard() { return 'clipboard text'; }
    async writeClipboard(text: string) { this.seenEvents.push(`clip:${text}`); }
}

const text = (value: string) => new TextEncoder().encode(value);
const seed = async (backend: MemoryBackend, path: string, value: string) => {
    await invoke('write_file_content', { path, content: value, encoding: 'UTF-8' });
};

let backend: MemoryBackend;

beforeEach(() => {
    localStorage.clear();
    backend = new MemoryBackend();
    setBackend(backend);
});

describe('文件读写契约', () => {
    it('读写往返返回上游 Rust 的字段与 UTF-8/Windows-1252/BOM 编码', async () => {
        await seed(backend, '/work/hello.txt', 'hello ZITEXT');
        const read: any = await invoke('read_file_content', { path: '/work/hello.txt' });
        expect(read.content).toBe('hello ZITEXT');
        expect(read.encoding).toBe('UTF-8');
        expect(read.path).toBe('/work/hello.txt');
        expect(typeof read.hash).toBe('string');
        expect(read.size).toBe(12);
        expect(read.identity).toContain('/work/hello.txt');

        const bom: any = await invoke('write_file_content', {
            path: '/work/bom.txt', content: 'abc', encoding: 'UTF-8 with BOM',
        });
        expect(bom.encoding).toBe('UTF-8 with BOM');
        expect(bom.size).toBe(6);
        const readBom: any = await invoke('read_file_content', { path: '/work/bom.txt' });
        expect(readBom.content).toBe('abc');
        expect(readBom.encoding).toBe('UTF-8 with BOM');
    });

    it('保存时的版本冲突检测与二进制文件拒绝', async () => {
        await seed(backend, '/work/a.txt', 'v1');
        const first: any = await invoke('read_file_content', { path: '/work/a.txt' });
        await backend.writeFile('/work/a.txt', text('changed outside'));
        await expect(invoke('write_file_content', {
            path: '/work/a.txt', content: 'v2', encoding: 'UTF-8',
            expectedModified: first.modified, expectedSize: first.size, expectedHash: first.hash,
        })).rejects.toMatch(/ZITEXT_FILE_CONFLICT/);

        await backend.writeFile('/work/bin.dat', new Uint8Array([65, 0, 66]));
        await expect(invoke('read_file_content', { path: '/work/bin.dat' })).rejects.toMatch(/binary/);
    });

    it('目录、按名查找与全文搜索返回 snake/camel 混合字段', async () => {
        await seed(backend, '/work/a.txt', 'hello world\nsecond HELLO');
        await seed(backend, '/work/sub/b.js', 'const hello = 1;');
        const listing: any = await invoke('read_directory', { path: '/work', recursive: false });
        expect(listing.entries.some((e: any) => e.is_directory === true && e.name === 'sub')).toBe(true);
        expect(listing.hiddenLinks).toBe(0);

        const named: any = await invoke('find_files_by_name', { folder: '/work', query: 'b.js' });
        expect(named.entries.some((e: any) => e.path === '/work/sub/b.js')).toBe(true);
        expect(named.entries.some((e: any) => e.path === '/work/sub' && e.is_directory)).toBe(true);

        const report: any = await invoke('search_in_files', {
            folder: '/work', query: 'hello', caseSensitive: false, wholeWord: false,
        });
        expect(report.matches.length).toBeGreaterThanOrEqual(2);
        expect(report.matches[0]).toMatchObject({ file_path: expect.any(String), line_number: expect.any(Number) });
        expect(report).toHaveProperty('resultLimitReached');
        expect(report).toHaveProperty('skippedLargeFiles');
    });

    it('文件元数据、重命名与批量元数据', async () => {
        await seed(backend, '/work/a.txt', 'abc');
        const meta: any = await invoke('get_file_metadata', { path: '/work/a.txt' });
        expect(meta.exists).toBe(true);
        expect(meta.size).toBe(3);
        const batch: any = await invoke('get_files_metadata', { paths: ['/work/a.txt', '/work/missing.txt'] });
        expect(batch[0].path).toBe('/work/a.txt');
        expect(batch[1].exists).toBe(false);
        expect(await invoke('rename_file', { oldPath: '/work/a.txt', newPath: '/work/renamed.txt' })).toBe(true);
        expect(await backend.readFile('/work/renamed.txt')).not.toBeNull();
    });
});

describe('应用状态与宿主集成', () => {
    it('设置、最近文件、崩溃恢复会话与草稿本写入插件自己的存储', async () => {
        expect(await invoke('settings_file_exists')).toBe(false);
        const defaults: any = await invoke('read_settings');
        expect(defaults.fontSize).toBe(14);
        expect(defaults.checkForUpdates).toBe(false);
        await invoke('write_settings', { settings: { ...defaults, fontSize: 18 } });
        expect(await invoke('settings_file_exists')).toBe(true);
        expect((await invoke<any>('read_settings')).fontSize).toBe(18);

        await invoke('add_recent_file', { path: '/work/a.txt' });
        await invoke('add_recent_file', { path: '/work/a.txt' });
        expect(await invoke('get_recent_files')).toEqual(['/work/a.txt']);

        const session = [{ path: '/work/a.txt', cursor_line: 3, cursor_column: 2, is_dirty: true, content: 'draft' }];
        await invoke('save_session', { session, activeTabPath: '/work/a.txt' });
        expect(await invoke('get_last_session')).toEqual(session);

        await invoke('write_scratchpad', { content: 'scratch' });
        expect(await invoke('read_scratchpad')).toBe('scratch');
    });

    it('对话框通过事件把宿主选中的真实路径交回上游', async () => {
        const payloads: unknown[] = [];
        const unlisten = await listen('save-from-dialog', (event) => { payloads.push(event.payload); });
        await invoke('request_menu_action', { action: 'save_as', defaultName: 'note.txt' });
        expect(payloads).toEqual(['/work/saved.txt']);
        await unlisten();

        await invoke('open_external_link', { url: 'https://example.com' });
        expect(backend.seenEvents).toContain('external:https://example.com');
        expect(await invoke('get_startup_args')).toEqual([]);
        expect(await invoke('get_startup_folder')).toBeNull();
    });

    it('事件总线与未知命令不会让上游崩溃', async () => {
        let received: unknown = null;
        const unlisten = await listen<string>('menu-new', (event) => { received = event.payload; });
        await emit('menu-new', 'go');
        expect(received).toBe('go');
        await unlisten();
        await emit('menu-new', 'ignored');
        expect(received).toBe('go');
        expect(await invoke('set_window_theme', { theme: 'dark' })).toBeUndefined();
        expect(await invoke('totally_unknown_command')).toBeUndefined();
    });
});

describe('大文件 / 日志查看器', () => {
    it('分页、过滤、搜索、时间定位与导出都可用', async () => {
        const lines = Array.from({ length: 250 }, (_, i) =>
            i % 10 === 0 ? `2026-01-01 0${i % 10}:15:00 ERROR request ${i}` : `2026-01-01 0${i % 10}:20:00 INFO line ${i}`);
        await backend.writeFile('/work/app.log', text(lines.join('\n')));
        const opened: any = await invoke('large_file_open', { path: '/work/app.log' });
        expect(opened.lineCount).toBe(250);
        expect(opened.indexing).toBe(false);
        const id = opened.id;

        const page: any = await invoke('large_file_lines', { id, start: 0, count: 3 });
        expect(page.map((line: any) => line.number)).toEqual([0, 1, 2]);
        expect(page[0].text).toContain('ERROR');

        const status: any = await invoke('large_file_set_filter', {
            id, filter: { include: [{ pattern: 'ERROR', regex: false, caseSensitive: true }], exclude: [], matchAll: false },
        });
        expect(status.done).toBe(true);
        expect(status.matched).toBe(25);
        const filtered: any = await invoke('large_file_filtered_lines', { id, start: 0, count: 2 });
        expect(filtered).toHaveLength(2);
        expect(filtered[0].text).toContain('ERROR');

        const hit: any = await invoke('large_file_search', {
            id, fromLine: null, backwards: false, rule: { pattern: 'line 21', regex: false, caseSensitive: false },
        });
        expect(hit.line).toBe(21);
        expect(await invoke('large_file_find_time', { id, target: '05:16' })).not.toBeNull();

        const written: any = await invoke('large_file_export', {
            id, destination: '/work/export.log', selection: { kind: 'filtered' },
        });
        expect(written).toBe(25);
        const exported = await backend.readFile('/work/export.log');
        expect(exported).not.toBeNull();
        expect(new TextDecoder().decode(exported!.bytes).split('\n').filter(Boolean)).toHaveLength(25);

        await invoke('large_file_close', { id });
        await expect(invoke('large_file_status', { id })).rejects.toMatch(/Unknown large-file session/);
    });
});
