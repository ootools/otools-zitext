/**
 * Drop-in replacement for `invoke()` from `@tauri-apps/api/core`.
 *
 * Every custom command from `src-tauri/src/lib.rs` is mapped to a webview-side
 * implementation. Commands that only existed to drive the native window/menu
 * are answered with harmless no-ops, so the whole upstream React application
 * runs unchanged inside an OTools plugin.
 */
import * as fs from './backend/fs';
import * as largeFile from './backend/largeFile';
import * as state from './backend/state';

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
    // Files
    read_file_content: fs.readFileContent,
    write_file_content: fs.writeFileContent,
    read_directory: fs.readDirectory,
    get_file_metadata: fs.getFileMetadata,
    get_files_metadata: fs.getFilesMetadata,
    rename_file: fs.renameFile,
    find_files_by_name: fs.findFilesByName,
    count_project_files: fs.countProjectFiles,
    search_in_files: fs.searchInFiles,

    // Settings, session, scratchpad, recent files
    settings_file_exists: state.settingsFileExists,
    read_settings: state.readSettings,
    write_settings: state.writeSettings,
    set_opened_folder: state.setOpenedFolder,
    add_recent_file: state.addRecentFile,
    get_recent_files: state.getRecentFiles,
    save_session: state.saveSession,
    get_last_session: state.getLastSession,
    read_scratchpad: state.readScratchpad,
    write_scratchpad: state.writeScratchpad,
    append_crash_log: state.appendCrashLog,
    grant_recent_path: state.noop,

    // Startup / external integration
    get_startup_args: state.getStartupArgs,
    get_startup_folder: state.getStartupFolder,
    request_menu_action: state.requestMenuAction,
    open_url_in_browser: state.openUrlInBrowser,
    open_external_link: state.openUrlInBrowser,

    // Native window/menu lifecycle — owned by the OTools host
    rebuild_native_menu: state.noop,
    retarget_document: state.noop,
    release_folder_access: state.noop,
    signal_tab_closed: state.noop,
    acknowledge_close_request: state.noop,
    confirm_app_close: state.noop,
    cancel_app_close: state.noop,
    set_window_theme: state.noop,

    // Large file / log viewer
    large_file_open: largeFile.largeFileOpen,
    large_file_status: largeFile.largeFileStatus,
    large_file_refresh: largeFile.largeFileRefresh,
    large_file_lines: largeFile.largeFileLines,
    large_file_set_filter: largeFile.largeFileSetFilter,
    large_file_filter_status: largeFile.largeFileFilterStatus,
    large_file_filtered_lines: largeFile.largeFileFilteredLines,
    large_file_search: largeFile.largeFileSearch,
    large_file_find_time: largeFile.largeFileFindTime,
    large_file_export: largeFile.largeFileExport,
    large_file_close: largeFile.largeFileClose,
};

const warned = new Set<string>();

export async function invoke<T = unknown>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const handler = handlers[command];
    if (!handler) {
        if (!warned.has(command)) {
            warned.add(command);
            console.warn(`[zitext] 未实现的后端命令：${command}（OTools 插件版按无操作处理）`);
        }
        return undefined as T;
    }
    try {
        return await handler(payload ?? {}) as T;
    } catch (error) {
        // Tauri rejects with a plain string; upstream reads `error as string`
        // in several places, so preserve the message shape.
        if (error instanceof Error) throw error.message;
        throw error;
    }
}

/** `@tauri-apps/api/core` also exports these; upstream only uses `invoke`. */
export const convertFileSrc = (path: string): string => path;
export const isTauri = (): boolean => false;
export const transformCallback = (_callback: unknown, _once = false): number => 0;
