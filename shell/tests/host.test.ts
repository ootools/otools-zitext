/**
 * 宿主桥回归测试：对话框必须走「宿主命令优先」的确定性路径。
 *
 * 背景（0.1.0 线上问题）：插件里点「打开文件夹」没有任何反应。原因是宿主
 * 选择器只走了 `window.otools.dialog.open`，而它的结果在「用户取消」和
 * 「宿主弹不出原生框」两种情况下都是 `null`，上层只能当作取消处理；同时
 * `window.otools.invokeNative()` 是**原生 cdylib** 桥，不是 tauri 命令通道，
 * 用它调 `tools_webview_*` 必然 reject。这里把两条约束都钉住。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { invoke } from '../shim/core';
import { listen } from '../shim/event';
import { getBackend, setBackend } from '../shim/host';

type Call = { command: string; args: Record<string, unknown> };

let calls: Call[];
let nativeCalls: Call[];
let hostCommands: Record<string, (args: Record<string, unknown>) => unknown>;
let dialogOpen: (options: Record<string, unknown>) => unknown;

const installHost = (options: {
    commands?: Record<string, (args: Record<string, unknown>) => unknown>;
    open?: (options: Record<string, unknown>) => unknown;
} = {}) => {
    calls = [];
    nativeCalls = [];
    hostCommands = options.commands ?? {};
    dialogOpen = options.open ?? (() => null);

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
        dialog: {
            open: async (opts: Record<string, unknown>) => dialogOpen(opts),
            save: async () => null,
            message: async () => undefined,
            confirm: async () => true,
        },
        // 原生 cdylib 桥：任何调用都应当被视为「用错了通道」。
        invokeNative: async (method: string, payload: Record<string, unknown>) => {
            nativeCalls.push({ command: method, args: payload ?? {} });
            throw new Error('native disabled');
        },
    };
};

beforeEach(() => {
    delete (window as any).__ZITEXT_HOST_BACKEND__;
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).otools;
    setBackend(null);
});

describe('文件夹 / 文件选择', () => {
    it('优先调用宿主 picker 命令，命中时不再碰 dialog.open', async () => {
        installHost({
            commands: { tools_webview_pick_folder: () => ({ path: '/picked/folder', name: 'folder' }) },
            open: () => { throw new Error('dialog.open 不该被调用'); },
        });

        expect(await getBackend().pickFolder()).toBe('/picked/folder');
        expect(calls.map((c) => c.command)).toEqual(['tools_webview_pick_folder']);
        expect(calls[0].args).toEqual({ options: { title: '打开文件夹' } });
    });

    it('宿主命令取消（null）时直接返回 null，不再弹第二个对话框', async () => {
        installHost({
            commands: { tools_webview_pick_folder: () => null },
            open: () => { throw new Error('dialog.open 不该被调用'); },
        });

        expect(await getBackend().pickFolder()).toBeNull();
        expect(calls).toHaveLength(1);
    });

    it('宿主命令不可用时回落到 dialog.open，并规范化返回形状', async () => {
        installHost({ open: () => [{ path: '/legacy/dir' }] });

        expect(await getBackend().pickFolder()).toBe('/legacy/dir');
        expect(calls.some((c) => c.command === 'tools_webview_pick_folder')).toBe(true);
    });

    it('两层都拿不到路径时返回 null 而不是抛错', async () => {
        installHost({ open: () => null });
        expect(await getBackend().pickFolder()).toBeNull();
    });

    it('打开文件取数组首个路径，另存为带 suggestedName', async () => {
        installHost({
            commands: {
                tools_webview_pick_files: () => [{ path: '/work/a.txt' }, { path: '/work/b.txt' }],
                tools_webview_pick_save_path: () => ({ path: '/work/note.txt', name: 'note.txt' }),
            },
        });

        expect(await getBackend().pickFile()).toBe('/work/a.txt');
        expect(await getBackend().pickSave('note.txt')).toBe('/work/note.txt');
        expect(calls.map((c) => c.command)).toEqual([
            'tools_webview_pick_files',
            'tools_webview_pick_save_path',
        ]);
        expect(calls[1].args).toEqual({ options: { title: '另存为', suggestedName: 'note.txt' } });
    });
});

describe('菜单动作往返', () => {
    it('open_folder 通过事件把宿主选中的真实路径交回上游', async () => {
        installHost({ commands: { tools_webview_pick_folder: () => ({ path: '/work/project' }) } });

        const payloads: unknown[] = [];
        const unlisten = await listen('folder-from-dialog', (event) => { payloads.push(event.payload); });
        await invoke('request_menu_action', { action: 'open_folder' });
        await unlisten();

        expect(payloads).toEqual(['/work/project']);
    });
});

describe('tauri 命令通道', () => {
    it('删除 / 重命名 / 待打开文件都走 __TAURI_INTERNALS__，不用原生 cdylib 桥', async () => {
        installHost({
            commands: {
                tools_webview_remove_entry: () => null,
                tools_webview_rename_entry: () => null,
                otools_consume_open_files: () => ['/work/dropped.txt'],
            },
        });
        (window as any).__OToolsEnv = { pluginUuid: 'otools-zitext' };

        const backend = getBackend();
        await backend.removeFile!('/work/dead.txt');
        await backend.rename!('/work/a.txt', '/work/b.txt');
        expect(await backend.consumeOpenFiles!()).toEqual(['/work/dropped.txt']);

        expect(nativeCalls).toEqual([]);
        expect(calls.map((c) => c.command)).toEqual([
            'tools_webview_remove_entry',
            'tools_webview_rename_entry',
            'otools_consume_open_files',
        ]);
        expect(calls[1].args).toEqual({ request: { from: '/work/a.txt', to: '/work/b.txt' } });
        expect(calls[2].args).toEqual({ pluginUuid: 'otools-zitext' });
    });
});
