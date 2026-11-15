/**
 * 工作区根目录的持久化列表。
 *
 * 上游的「打开文件夹」是单根语义：设置里只有一个 `openedFolder`，再打开一个
 * 就把上一个换掉。这里在它之上加一层「附加根」：`openedFolder` 仍是主根（窗口
 * 标题、启动参数都还用它），其余根由本模块记住，重启后一起恢复。
 *
 * 存的是宿主侧路径，因此读写都走宿主文件存储（`shim/hostStore.ts`）。
 */
import { kvGet, kvSet } from '../../shim/util';

const KEY = 'workspace-roots';

/** 根目录路径去重并按原顺序保留。 */
export function normalizeRoots(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of paths) {
        const path = String(raw ?? '').trim();
        if (!path) continue;
        const identity = path.replace(/[\\/]+$/, '');
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        out.push(identity);
    }
    return out;
}

export async function readWorkspaceRoots(): Promise<string[]> {
    const stored = await kvGet<unknown>(KEY);
    if (!Array.isArray(stored)) return [];
    return normalizeRoots(stored.filter((item): item is string => typeof item === 'string'));
}

export async function writeWorkspaceRoots(paths: readonly string[]): Promise<void> {
    await kvSet(KEY, normalizeRoots(paths));
}

/** 侧栏里显示的根目录名（取末段）。 */
export function rootLabel(path: string): string {
    const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
}
