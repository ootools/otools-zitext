/**
 * 状态持久化回归测试。
 *
 * 背景：插件页面跑在宿主的 `otools-plugin://` 自定义 scheme 上，那里的
 * IndexedDB / localStorage 不保证可用，而两层访问器的失败都是静默的——
 * 表现就是「重启后标签页全没了」。所以状态（设置、会话快照、草稿）现在优先
 * 落到宿主文件 `~/.otools/local/<packid>/kv-*.json`，web 存储只作回退与迁移源。
 *
 * 这里钉住四件事：① 宿主可用时写宿主文件、读宿主文件；② 宿主不可用时回退
 * web 存储；③ web 里的旧数据会被搬到宿主；④ `get_last_session` 能拿到条目
 * 并写下诊断日志。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { command: string; args: Record<string, unknown> };

const STATE_DIR = '/Users/tester/.otools/local/otools-zitext';

let files: Map<string, string>;
let calls: Call[];
let logs: string[];

const encode = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const decode = (value: string): string => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
};

/** 宿主侧文件系统的最小替身：命令名与载荷形状跟 `tools_webview_*` 一致。 */
function installHost(): void {
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
        tools_webview_home_dir: () => '/Users/tester',
        tools_webview_join_path: (args) => (args.parts as string[]).join('/'),
        tools_webview_create_dir: () => null,
        tools_webview_read_file: (args) => {
            const path = String(args.path ?? '');
            const text = files.get(path);
            if (text === undefined) throw new Error(`读取文件失败: ${path}`);
            return { path, name: path.split('/').pop(), size: text.length, mime: 'application/json', lastModified: 0, dataBase64: encode(text) };
        },
        tools_webview_write_file: (args) => {
            const request = (args.request ?? {}) as { path?: string; dataBase64?: string };
            files.set(String(request.path), decode(String(request.dataBase64 ?? '')));
            return null;
        },
        tools_webview_log: (args) => {
            logs.push(String(args.message ?? ''));
            return null;
        },
    };
    (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
            calls.push({ command, args });
            const handler = handlers[command];
            if (!handler) throw new Error(`command not allowed: ${command}`);
            return handler(args);
        },
    };
}

const removeHost = (): void => { delete (window as any).__TAURI_INTERNALS__; };

/** hostStore 会缓存目录与待写队列，每个用例都要一份干净的模块实例。 */
async function freshStore() {
    vi.resetModules();
    return await import('../shim/util');
}

beforeEach(() => {
    files = new Map();
    calls = [];
    logs = [];
    localStorage.clear();
    removeHost();
});

describe('状态持久化', () => {
    it('宿主可用时把状态写进宿主文件，并能读回', async () => {
        installHost();
        const store = await freshStore();

        const session = [{ path: '/work/a.txt', cursor_line: 3, is_active: true }];
        await store.kvSet('session', session);
        await store.hostKvFlush();

        const written = files.get(`${STATE_DIR}/kv-session.json`);
        expect(written).toBe(JSON.stringify(session));
        expect(store.kvBackend()).toBe('host');
        // 目录是宿主侧建出来的，不是假设存在
        expect(calls.some((call) => call.command === 'tools_webview_create_dir'
            && call.args.path === STATE_DIR)).toBe(true);

        // 读回走同一个文件，不碰 web 存储
        const read = await store.kvGet<unknown[]>('session');
        expect(read).toEqual(session);
    });

    it('同一 key 的连续写入会合并，不会逐次落盘', async () => {
        installHost();
        const store = await freshStore();

        await store.kvSet('session', [{ path: '/work/a.txt' }]);
        await store.kvSet('session', [{ path: '/work/b.txt' }]);
        await store.kvSet('session', [{ path: '/work/c.txt' }]);
        expect(files.has(`${STATE_DIR}/kv-session.json`)).toBe(false);

        await store.hostKvFlush();
        const writes = calls.filter((call) => call.command === 'tools_webview_write_file');
        expect(writes).toHaveLength(1);
        expect(files.get(`${STATE_DIR}/kv-session.json`)).toContain('/work/c.txt');
    });

    it('宿主不可用时回退 web 存储', async () => {
        const store = await freshStore();
        await store.kvSet('settings', { fontSize: 15 });

        expect(store.kvBackend()).toBe('web');
        expect(JSON.parse(localStorage.getItem('zitext.kv.settings') ?? 'null')).toEqual({ fontSize: 15 });
        expect(await store.kvGet('settings')).toEqual({ fontSize: 15 });
    });

    it('web 存储里的旧数据会被搬到宿主文件', async () => {
        installHost();
        const legacy = [{ path: '/work/legacy.txt', is_active: true }];
        localStorage.setItem('zitext.kv.session', JSON.stringify(legacy));
        const store = await freshStore();

        // 宿主侧还没有这个文件：先读 web，再补写宿主
        expect(await store.kvGet<unknown[]>('session')).toEqual(legacy);
        await store.hostKvFlush();
        expect(JSON.parse(files.get(`${STATE_DIR}/kv-session.json`) ?? 'null')).toEqual(legacy);
    });

    it('get_last_session 读到条目并写下存储后端诊断', async () => {
        installHost();
        files.set(`${STATE_DIR}/kv-session.json`, JSON.stringify([
            { path: '/work/a.txt', cursor_line: 1, cursor_column: 1, is_active: true },
            { path: 'Untitled-1', is_untitled: true, content: 'draft', is_active: false },
        ]));
        vi.resetModules();
        const state = await import('../shim/backend/state');

        const session = await state.getLastSession();
        expect(session).toHaveLength(2);
        expect(logs.some((line) => line.includes('get_last_session: 2 条') && line.includes('存储=host'))).toBe(true);
    });
});
