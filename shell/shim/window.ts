/**
 * Replacement for `@tauri-apps/api/window`.
 *
 * The OTools host owns the plugin window. Upstream calls this API only for
 * title/fullscreen hints and the Windows custom titlebar; those are answered as
 * no-ops while real focus events still come from the DOM so autosave-on-blur
 * keeps working.
 */
type Unlisten = () => void;

let fullscreen = false;
let maximized = false;

// Tauri's window methods take an argument in some call sites (setTitle,
// setSize, setPosition, …). Accept and ignore anything so upstream type-checks
// against this shim without needing source patches.
const noopAsync = (..._args: unknown[]): Promise<void> => Promise.resolve();

const currentWindow = {
    label: 'otools-zitext',
    setTitle: noopAsync,
    close: noopAsync,
    minimize: noopAsync,
    maximize: async () => { maximized = true; },
    unmaximize: async () => { maximized = false; },
    toggleMaximize: async () => { maximized = !maximized; },
    isMaximized: async () => maximized,
    isFullscreen: async () => fullscreen,
    setFullscreen: async (value: boolean) => { fullscreen = Boolean(value); },
    isVisible: async () => true,
    isFocused: async () => document.hasFocus(),
    setFocus: noopAsync,
    center: noopAsync,
    show: noopAsync,
    hide: noopAsync,
    setSize: noopAsync,
    setPosition: noopAsync,
    startDragging: noopAsync,
    async onResized(_handler: (event: { payload: unknown }) => void): Promise<Unlisten> {
        return () => {};
    },
    async onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<Unlisten> {
        const onBlur = () => handler({ payload: false });
        const onFocus = () => handler({ payload: true });
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
        };
    },
};

export function getCurrentWindow() {
    return currentWindow;
}

export const getAllWindows = async () => [currentWindow];
export const getCurrentWebviewWindow = getCurrentWindow;
export const WebviewWindow = class {};
export const Window = class {};
