/**
 * Replacement for `@tauri-apps/plugin-dialog`.
 *
 * Upstream only uses `ask` (confirmations). File/folder pickers go through
 * `request_menu_action`, which uses the host dialog as well. The `open/save`
 * exports are here so the shim is a complete stand-in for the module.
 */
import { getBackend, type DialogOptions } from './host';

export interface DialogFilter { name: string; extensions: string[] }
export interface OpenDialogOptions extends DialogOptions {
    directory?: boolean;
    multiple?: boolean;
    defaultPath?: string;
    filters?: DialogFilter[];
}
export interface SaveDialogOptions extends DialogOptions { defaultPath?: string; filters?: DialogFilter[] }

export async function ask(message: string, options?: string | DialogOptions): Promise<boolean> {
    const normalized = typeof options === 'string' ? { title: options } : options;
    return getBackend().confirm(message, normalized);
}

export async function confirm(message: string, options?: string | DialogOptions): Promise<boolean> {
    return ask(message, options);
}

export async function message(messageText: string, options?: string | DialogOptions): Promise<void> {
    const normalized = typeof options === 'string' ? { title: options } : options;
    await getBackend().message(messageText, normalized);
}

export async function open(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
    const backend = getBackend();
    if (options.multiple) {
        const first = await backend.pickFile();
        return first ? [first] : null;
    }
    return options.directory ? backend.pickFolder() : backend.pickFile();
}

export async function save(options: SaveDialogOptions | string = {}): Promise<string | null> {
    const normalized = typeof options === 'string' ? { defaultPath: options } : options;
    const parts = (normalized.defaultPath ?? 'untitled.txt').split(/[\\/]/);
    return getBackend().pickSave(parts[parts.length - 1] || 'untitled.txt');
}
