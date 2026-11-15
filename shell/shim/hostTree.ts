/**
 * 选择器适配层：直接复用宿主 SDK 的 `pickFromHostTree`。
 *
 * 为什么不用 OS 原生对话框：macOS 上 `dialog.blocking_pick_folder()` 那条链在本
 * 插件里会「闪一下就再也弹不出来」（原生 sheet 与宿主面板窗口的父子关系不稳定，
 * 第二次调用直接卡住）。SDK 的 `pickFromHostTree` 是一棵画在页面里的 DOM 树，
 * 数据只来自宿主的只读目录命令 `tools_webview_browse_dialog`，不受原生窗口状态
 * 影响，可以反复打开。它还会在导入时把渲染器挂到 `window.__otoolsHostTree`，
 * 让宿主 `dialog.open` 的回落链也能复用。
 *
 * 这里只做三件事：把 SDK 的结果收敛成「路径或 null」、记住上次目录、补一个
 * SDK 没有的「另存为」文件名输入（树本身仍然是 SDK 画的）。
 */
import { pickFromHostTree, type HostPickResult } from 'otools-plugin-sdk';
import { hostCommand, hostLog } from './hostCommand';

/** 上一次确认过的目录，下次打开直接落在这里。 */
let lastDir = '';

/** 只给测试用：清掉「记住上次目录」的状态。 */
export function resetPickerMemory(): void {
    lastDir = '';
}

const dirOf = (path: string): string => {
    const normalized = path.replace(/[\\/]+$/, '');
    const cut = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    if (cut <= 0) return normalized.slice(0, cut + 1) || normalized;
    return normalized.slice(0, cut);
};

const baseOf = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

async function joinPath(dir: string, name: string): Promise<string> {
    try {
        const joined = await hostCommand<string>('tools_webview_join_path', { parts: [dir, name] });
        if (typeof joined === 'string' && joined.trim()) return joined.trim();
    } catch { /* 老宿主没有这个命令，手动拼 */ }
    const separator = /\\/.test(dir) && !dir.includes('/') ? '\\' : '/';
    return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`;
}

async function run(options: {
    directory: boolean;
    title: string;
    startPath?: string;
}): Promise<string | null> {
    let result: HostPickResult;
    try {
        result = await pickFromHostTree({
            directory: options.directory,
            title: options.title,
            startPath: options.startPath || lastDir || undefined,
        });
    } catch (error) {
        hostLog(`DOM 选择器不可用：${error instanceof Error ? error.message : String(error)}`);
        throw error instanceof Error ? error : new Error(String(error));
    }
    if (result.kind !== 'picked' || !result.paths.length) return null;
    const picked = result.paths[0];
    lastDir = options.directory ? picked : dirOf(picked);
    return picked;
}

/** 选目录。 */
export const pickHostFolder = (title = '打开文件夹'): Promise<string | null> =>
    run({ directory: true, title });

/** 选单个文件。 */
export const pickHostFile = (title = '打开文件'): Promise<string | null> =>
    run({ directory: false, title });

/**
 * 另存为：先用同一棵 DOM 树选目录（`startPath` 传完整默认路径，宿主会定位到它的
 * 父目录），再用一个单行输入框问文件名——SDK 的树没有文件名输入。
 */
export async function pickHostSavePath(defaultName: string): Promise<string | null> {
    const suggested = String(defaultName ?? '').trim();
    const dir = await run({ directory: true, title: '另存为 · 选择目录', startPath: suggested });
    if (!dir) return null;
    const name = await askFileName(dir, baseOf(suggested) || 'untitled.txt');
    if (!name) return null;
    return joinPath(dir, name);
}

/** 复用 SDK 已注入的 `otools-host-tree-*` 样式，保持两个弹层外观一致。 */
function askFileName(dir: string, suggested: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        let done = false;
        const overlay = document.createElement('div');
        overlay.className = 'otools-host-tree-overlay';
        overlay.innerHTML = `
            <div class="otools-host-tree-panel" role="dialog" aria-modal="true" aria-label="另存为">
                <div class="otools-host-tree-header">
                    <div class="otools-host-tree-title">另存为</div>
                    <div class="otools-host-tree-path"></div>
                </div>
                <div class="otools-host-tree-body" style="min-height:0;padding:16px">
                    <input data-zt-name type="text" spellcheck="false" aria-label="文件名"
                        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d6d6da;
                        border-radius:8px;font:inherit;color:inherit;background:inherit" />
                </div>
                <div class="otools-host-tree-footer">
                    <div class="otools-host-tree-selection"></div>
                    <button class="otools-host-tree-btn" data-zt-cancel type="button">取消</button>
                    <button class="otools-host-tree-btn otools-host-tree-btn-primary" data-zt-ok type="button">保存</button>
                </div>
            </div>`;

        const pathEl = overlay.querySelector<HTMLElement>('.otools-host-tree-path')!;
        const input = overlay.querySelector<HTMLInputElement>('[data-zt-name]')!;
        pathEl.textContent = dir;
        pathEl.title = dir;
        input.value = suggested;

        const close = (value: string | null) => {
            if (done) return;
            done = true;
            window.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(value);
        };
        const confirm = () => {
            const name = input.value.trim();
            if (name) close(name);
        };
        function onKey(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close(null);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                event.stopImmediatePropagation();
                confirm();
            }
        }

        overlay.querySelector('[data-zt-cancel]')!.addEventListener('click', () => close(null));
        overlay.querySelector('[data-zt-ok]')!.addEventListener('click', confirm);
        overlay.addEventListener('mousedown', (event) => {
            if (event.target === overlay) close(null);
        });
        window.addEventListener('keydown', onKey, true);

        document.body.appendChild(overlay);
        input.focus();
        input.select();
    });
}
