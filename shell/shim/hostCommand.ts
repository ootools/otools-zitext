/**
 * OTools 宿主应用命令通道（`tools_webview_*` / `otools_*`）。
 *
 * ⚠️ 这不是 `window.otools.invokeNative()`：后者转发到插件自己的原生 cdylib
 * （`.oplg` 里的 `lib/*.dylib`），纯 webview 插件调用必然被拒（`native disabled`）。
 * 应用命令只认 `__TAURI_INTERNALS__.invoke`；插件页被 frame 嵌套时宿主会把
 * internals 同时挂到祖先窗口上，所以要逐个候选窗口找。
 */

type TauriInternals = {
    invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
};

type BridgeWindow = Window & { __TAURI_INTERNALS__?: TauriInternals };

function bridgeCandidates(): BridgeWindow[] {
    const self = window as BridgeWindow;
    const candidates: BridgeWindow[] = [self];
    for (const resolve of [() => window.parent, () => window.top]) {
        try {
            const candidate = resolve() as BridgeWindow | null;
            if (candidate && candidate !== self && !candidates.includes(candidate)) candidates.push(candidate);
        } catch { /* cross-origin ancestor: ignore */ }
    }
    return candidates;
}

export function hasHostCommandChannel(): boolean {
    if (typeof window === 'undefined') return false;
    return bridgeCandidates().some((candidate) => typeof candidate.__TAURI_INTERNALS__?.invoke === 'function');
}

export async function hostCommand<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    for (const candidate of bridgeCandidates()) {
        const invoke = candidate.__TAURI_INTERNALS__?.invoke;
        if (typeof invoke === 'function') {
            return candidate.__TAURI_INTERNALS__!.invoke<T>(command, args);
        }
    }
    throw new Error(`宿主命令通道不可用：${command}`);
}

/** 诊断信息落 `~/.otools/log/core/webview.log`（只有宿主这个命令会写盘）。 */
export function hostLog(message: string): void {
    try { console.debug('[zitext]', message); } catch { /* ignore */ }
    void hostCommand('tools_webview_log', { message: `[zitext] ${message}` }).catch(() => {});
}
