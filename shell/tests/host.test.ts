/**
 * 宿主桥回归测试：选择器必须复用宿主 SDK 的 DOM 树，不能碰 OS 原生对话框。
 *
 * 背景（0.1.1 线上问题）：走宿主原生 picker 时，macOS 上对话框闪一下就再也
 * 弹不出来（原生 sheet 与宿主面板窗口的父子关系不稳定，第二次调用直接卡住）。
 * 现在选择器由 `otools-plugin-sdk` 的 `pickFromHostTree` 画在页面里，数据只来自
 * `tools_webview_browse_dialog`。这里把三条约束钉住：① 走 SDK 的 DOM 树；
 * ② 绝不调用原生 picker / dialog；③ zitext 自己的应用命令走
 * `__TAURI_INTERNALS__`，不用原生 cdylib 桥 `invokeNative`。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { invoke } from '../shim/core';
import { listen } from '../shim/event';
import { getBackend, setBackend } from '../shim/host';
import { resetPickerMemory } from '../shim/hostTree';

type Call = { command: string; args: Record<string, unknown> };
type Entry = { name: string; path: string; kind: string; size: number; mime: string };

let calls: Call[];
let nativeCalls: Call[];
let hostCommands: Record<string, (args: Record<string, unknown>) => unknown>;

const dir = (path: string): Entry => ({
    name: path.split('/').filter(Boolean).pop() ?? '/', path, kind: 'directory', size: 0, mime: '',
});
const file = (path: string, size = 12): Entry => ({
    name: path.split('/').pop() ?? path, path, kind: 'file', size, mime: 'text/plain',
});

const TREE: Record<string, Entry[]> = {
    '/work': [dir('/work/sub'), file('/work/a.txt'), file('/work/b.txt'), file('/work/.env', 20)],
    '/work/sub': [file('/work/sub/c.txt')],
};

/**
 * 复刻宿主 `resolve_dialog_target`：给一个完整文件路径时定位到它的父目录，
 * 空路径回到默认目录（这里用 /work 代替 home）。
 */
const resolveTarget = (raw?: string | null): string => {
    const requested = raw ? String(raw).trim() : '';
    if (!requested) return '/work';
    if (TREE[requested]) return requested;
    const parent = requested.slice(0, requested.lastIndexOf('/')) || '/';
    return TREE[parent] ? parent : '/work';
};

const installHost = (commands: Record<string, (args: Record<string, unknown>) => unknown> = {}) => {
    calls = [];
    nativeCalls = [];
    hostCommands = {
        tools_webview_browse_dialog: (args) => {
            const request = (args.request ?? {}) as { path?: string | null };
            const path = resolveTarget(request.path);
            const entries = TREE[path];
            if (!entries) throw new Error(`目录不存在：${path}`);
            const parent = path === '/work' ? '/' : path.slice(0, path.lastIndexOf('/')) || '/';
            return {
                currentPath: path,
                parentPath: parent,
                fileName: null,
                roots: [{ path: '/work', name: 'work' }],
                entries,
            };
        },
        tools_webview_join_path: (args) => (args.parts as string[]).join('/'),
        tools_webview_remove_entry: () => null,
        tools_webview_rename_entry: () => null,
        tools_webview_log: () => null,
        otools_consume_open_files: () => ['/work/dropped.txt'],
        ...commands,
    };

    (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
            calls.push({ command, args });
            const handler = hostCommands[command];
            if (!handler) throw new Error(`command not allowed: ${command}`);
            return handler(args);
        },
    };
    (window as any).otools = {
        readHostFile: async (path: string) => ({ path, name: path, size: 0, lastModified: 0, dataBase64: '' }),
        listHostDir: async () => [],
        writeHostFile: async () => undefined,
        browseHostDir: async (path: string) => hostCommands.tools_webview_browse_dialog({ request: { path } }),
        dialog: {
            open: async () => { throw new Error('不该走原生 dialog.open'); },
            save: async () => { throw new Error('不该走原生 dialog.save'); },
            message: async () => undefined,
            confirm: async () => true,
        },
        // 原生 cdylib 桥：SDK 会对未登记的命令先试这里再回落宿主命令。
        invokeNative: async (method: string, payload: Record<string, unknown>) => {
            nativeCalls.push({ command: method, args: payload ?? {} });
            throw new Error('native disabled');
        },
    };
};

const tick = async (times = 4) => {
    for (let i = 0; i < times; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

async function waitFor<T extends Element>(selector: string): Promise<T> {
    for (let i = 0; i < 80; i += 1) {
        const found = document.querySelector(selector) as T | null;
        if (found) return found;
        await tick(2);
    }
    throw new Error(`等不到元素：${selector}`);
}

const click = (element: Element | null) => {
    if (!element) throw new Error('要点击的元素不存在');
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
const entry = (path: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-host-tree-entry][data-path="${path}"]`);
const confirmButton = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>('[data-host-tree-confirm]');

/** 等选择器把目录渲染完（确认按钮可用），否则点它会被 disabled 挡掉。 */
async function waitReady(): Promise<HTMLButtonElement> {
    for (let i = 0; i < 80; i += 1) {
        const button = confirmButton();
        if (button && !button.disabled) return button;
        await tick(2);
    }
    throw new Error('选择器没有就绪');
}

beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as any).__ZITEXT_HOST_BACKEND__;
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).otools;
    delete (window as any).__OToolsEnv;
    resetPickerMemory();
    setBackend(null);
});

describe('DOM 选择器（宿主 SDK）', () => {
    it('打开文件夹：渲染页面内选择器，确认返回当前目录', async () => {
        installHost();
        const pending = getBackend().pickFolder();
        await waitReady();

        click(confirmButton());
        expect(await pending).toBe('/work');
        expect(document.querySelector('.otools-host-tree-overlay')).toBeNull();
    });

    it('点击文件夹进入子目录，再确认拿到子目录', async () => {
        installHost();
        const pending = getBackend().pickFolder();
        await waitReady();

        click(entry('/work/sub'));
        await waitFor('[data-host-tree-entry][data-path="/work/sub/c.txt"]');

        click(confirmButton());
        expect(await pending).toBe('/work/sub');
    });

    it('打开文件：选中文件后确认返回该文件路径', async () => {
        installHost();
        const pending = getBackend().pickFile();
        await waitFor('[data-host-tree-entry][data-path="/work/a.txt"]');
        await tick(4);

        const confirm = confirmButton()!;
        expect(confirm.disabled).toBe(true);
        click(entry('/work/a.txt'));
        expect(confirm.disabled).toBe(false);

        click(confirm);
        expect(await pending).toBe('/work/a.txt');
    });

    it('隐藏文件默认不显示，勾选开关后才出现', async () => {
        installHost();
        const pending = getBackend().pickFile();
        await waitFor('[data-host-tree-entry][data-path="/work/a.txt"]');
        expect(entry('/work/.env')).toBeNull();

        const toggle = document.querySelector<HTMLInputElement>('[data-host-tree-show-hidden]')!;
        expect(toggle.checked).toBe(false);
        toggle.checked = true;
        toggle.dispatchEvent(new window.Event('change'));
        expect(entry('/work/.env')).not.toBeNull();

        click(entry('/work/.env'));
        click(confirmButton());
        expect(await pending).toBe('/work/.env');
    });

    it('取消返回 null', async () => {
        installHost();
        const pending = getBackend().pickFolder();
        await waitReady();

        click(document.querySelector('[data-host-tree-cancel]'));
        expect(await pending).toBeNull();
    });

    it('从不调用 OS 原生 picker 或 dialog', async () => {
        installHost();
        const pending = getBackend().pickFolder();
        await waitReady();
        click(confirmButton());
        await pending;

        const forbidden = calls.filter((call) =>
            call.command === 'tools_webview_pick_folder'
            || call.command === 'tools_webview_pick_files'
            || call.command === 'tools_webview_pick_save_path'
            || call.command.startsWith('plugin:dialog|'));
        expect(forbidden).toEqual([]);
    });

    it('目录读不出来时在弹层里显示错误，取消后返回 null', async () => {
        installHost({ tools_webview_browse_dialog: () => { throw new Error('permission denied'); } });
        const pending = getBackend().pickFolder();

        const status = await waitFor<HTMLElement>('.otools-host-tree-status');
        await tick(6);
        expect(status.textContent).toContain('permission denied');

        click(document.querySelector('[data-host-tree-cancel]'));
        expect(await pending).toBeNull();
    });

    it('另存为：先选目录，再输入文件名，经宿主 join_path 拼成完整路径', async () => {
        installHost();
        const pending = getBackend().pickSave('/work/note.txt');

        await waitReady();
        click(confirmButton());

        const input = await waitFor<HTMLInputElement>('[data-zt-name]');
        expect(input.value).toBe('note.txt');
        input.value = 'draft.md';
        click(document.querySelector('[data-zt-ok]'));

        expect(await pending).toBe('/work/draft.md');
        const join = calls.find((call) => call.command === 'tools_webview_join_path');
        expect(join?.args).toEqual({ parts: ['/work', 'draft.md'] });
    });

    it('另存为：文件名留空时不关闭，取消返回 null', async () => {
        installHost();
        const pending = getBackend().pickSave('/work/note.txt');
        await waitReady();
        click(confirmButton());

        const input = await waitFor<HTMLInputElement>('[data-zt-name]');
        input.value = '   ';
        click(document.querySelector('[data-zt-ok]'));
        await tick();
        expect(document.querySelector('[data-zt-name]')).not.toBeNull();

        click(document.querySelector('[data-zt-cancel]'));
        expect(await pending).toBeNull();
    });
});

describe('菜单动作往返', () => {
    it('open_folder 通过事件把 DOM 选择器选中的路径交回上游', async () => {
        installHost();
        const payloads: unknown[] = [];
        const unlisten = await listen('folder-from-dialog', (event) => { payloads.push(event.payload); });

        const pending = invoke('request_menu_action', { action: 'open_folder' });
        await waitReady();
        click(confirmButton());
        await pending;
        await unlisten();

        expect(payloads).toEqual(['/work']);
    });
});

describe('tauri 命令通道', () => {
    it('删除 / 重命名 / 待打开文件都走 __TAURI_INTERNALS__，不用原生 cdylib 桥', async () => {
        installHost();
        (window as any).__OToolsEnv = { pluginUuid: 'otools-zitext' };

        const backend = getBackend();
        await backend.removeFile!('/work/dead.txt');
        await backend.rename!('/work/a.txt', '/work/b.txt');
        expect(await backend.consumeOpenFiles!()).toEqual(['/work/dropped.txt']);

        expect(nativeCalls).toEqual([]);
        expect(calls.map((call) => call.command)).toEqual([
            'tools_webview_remove_entry',
            'tools_webview_rename_entry',
            'otools_consume_open_files',
        ]);
        expect(calls[1].args).toEqual({ request: { from: '/work/a.txt', to: '/work/b.txt' } });
        expect(calls[2].args).toEqual({ pluginUuid: 'otools-zitext' });
    });
});
