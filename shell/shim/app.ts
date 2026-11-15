/** Replacement for `@tauri-apps/api/app`. */
import { getBackend } from './host';

/** Version shown in About / Diagnostics. Kept in sync with plugin.json. */
export const PLUGIN_VERSION = '0.1.0';

export async function getVersion(): Promise<string> { return PLUGIN_VERSION; }
export async function getName(): Promise<string> { return 'ZITEXT Editor (OTools)'; }
export async function getTauriVersion(): Promise<string> { return 'otools-host'; }
export async function showAbout(): Promise<void> {
    await getBackend().message(`ZITEXT Editor · OTools 插件版 ${PLUGIN_VERSION}`, { title: 'About' });
}
export const getIdentifier = async (): Promise<string> => 'otools-zitext';
