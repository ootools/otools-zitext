/** Replacement for `@tauri-apps/plugin-clipboard-manager`. */
import { getBackend } from './host';

export const readText = (): Promise<string> => getBackend().readClipboard();
export const writeText = (text: string): Promise<void> => getBackend().writeClipboard(text);
