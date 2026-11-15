/**
 * 侧栏资源管理器（移植层覆盖版）。
 *
 * 相对上游的改动只有一处主题：**支持多个根目录**。
 *
 * 上游是单根语义 —— 设置里只有一个 `openedFolder`，再打开一个目录就把上一个
 * 换掉。这里把它当「主根」，另外记住一组附加根（`utils/workspaceRoots.ts`）：
 *   - 菜单/侧栏再打开一个目录时**追加**而不是替换；
 *   - 每个根独立加载、独立报错、独立刷新，可以单独移除；
 *   - 过滤与文件计数跨根聚合；
 *   - 根列表持久化，重启后整组恢复（主根仍来自 `openedFolder`，所以窗口标题
 *     和启动参数的行为跟上游一致）。
 *
 * 之所以放在这里而不是改 App.tsx：App 是 2000+ 行的上游文件，为多根去 fork
 * 它会让上游升级变成逐行合并。把状态收在侧栏内部，App 那边完全不用动。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { FileNode } from '../types';
import { FileTreeNode } from './FileTreeNode';
import { errorService, withoutErrorCodes } from '../services/ErrorService';
import { openFolderDialog, readTreeLevel, findFilesByName } from '../utils/fileTree';
import { FolderIconNamed } from '../utils/fileIcons';
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../constants';
import { normalizeRoots, readWorkspaceRoots, rootLabel, writeWorkspaceRoots } from '../utils/workspaceRoots';

interface FileExplorerProps {
    /** 主根（来自设置里的 openedFolder）。 */
    folderPath: string | null;
    onFolderOpen: (path: string) => void;
    onFileSelect: (path: string) => void;
    /** File open in the focused tab; the tree marks it selected. */
    activePath?: string | null;
    /** Open tabs with unsaved changes; the tree marks them with a dot. */
    dirtyPaths?: ReadonlySet<string>;
    /** Hides the explorer; the folder stays open. */
    onClose: () => void;
    /** Closes the project folder. */
    onCloseFolder?: () => void;
    collapsed: boolean;
    width: number;
    onWidthChange: (width: number) => void;
}

interface RootTree {
    tree: FileNode[];
    loading: boolean;
    error: string | null;
}

interface RootFilter {
    query: string;
    tree: FileNode[];
    truncated: boolean;
    error?: string;
}

const emptyTree = (): RootTree => ({ tree: [], loading: true, error: null });

async function buildTreePreservingExpansion(
    oldNodes: FileNode[],
    path: string,
): Promise<FileNode[]> {
    const fresh = await readTreeLevel(path);
    if (oldNodes.length === 0) return fresh;
    const oldByPath = new Map(oldNodes.map(node => [node.path, node]));
    return Promise.all(fresh.map(async node => {
        const old = oldByPath.get(node.path);
        if (node.isDirectory && old?.expanded) {
            const children = await buildTreePreservingExpansion(old.children || [], node.path);
            return { ...node, expanded: true, children };
        }
        return node;
    }));
}

function updateNodeChildren(tree: FileNode[], targetPath: string, children: FileNode[]): FileNode[] {
    return tree.map(node => {
        if (node.path === targetPath) {
            return { ...node, children, expanded: true };
        }
        if (node.children) {
            return { ...node, children: updateNodeChildren(node.children, targetPath, children) };
        }
        return node;
    });
}

const countFiles = (nodes: FileNode[]): number => nodes.reduce(
    (total, node) => total + (node.isDirectory ? countFiles(node.children ?? []) : node.placeholder ? 0 : 1),
    0,
);

/** Memoized: typing re-renders App, and the tree should only re-render when
 *  its own inputs change. */
export const FileExplorer = memo(function FileExplorer({
    folderPath,
    onFolderOpen,
    onFileSelect,
    activePath,
    dirtyPaths,
    onClose,
    onCloseFolder,
    collapsed,
    width,
    onWidthChange,
}: FileExplorerProps) {
    const [roots, setRoots] = useState<string[]>([]);
    const [trees, setTrees] = useState<Record<string, RootTree>>({});
    const [restored, setRestored] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    /* Bumped by Refresh so file counts and the filter are recounted alongside
       the trees — files added on disk since the folder was opened are picked up. */
    const [refreshKey, setRefreshKey] = useState(0);
    const [filters, setFilters] = useState<Record<string, RootFilter>>({});
    const [counts, setCounts] = useState<Record<string, { count: number; partial: boolean }>>({});

    const rootsRef = useRef(roots);
    rootsRef.current = roots;
    const treesRef = useRef(trees);
    treesRef.current = trees;
    /* Every tree load for a root takes a new number; a load that finishes after
       a newer one started, or after the root was removed, is dropped. */
    const generations = useRef(new Map<string, number>());
    const lastProp = useRef<string | null>(null);

    // Restore the remembered root list before reacting to the folder prop:
    // settings load asynchronously, so the first render always has `null` and
    // must not be mistaken for "the user closed the folder".
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const saved = await readWorkspaceRoots();
            if (cancelled) return;
            setRoots(saved);
            setRestored(true);
        })();
        return () => { cancelled = true; };
    }, []);

    // Reconcile with the prop: a new non-null folder is appended (this is what
    // makes "Open Folder" add a root instead of replacing the workspace); the
    // prop going back to null means the user closed the folder.
    useEffect(() => {
        if (!restored) return;
        const previous = lastProp.current;
        lastProp.current = folderPath;
        if (!folderPath) {
            if (previous) setRoots([]);
            return;
        }
        if (previous === folderPath) return;
        setRoots(current => (current.includes(folderPath) ? current : [...current, folderPath]));
    }, [folderPath, restored]);

    useEffect(() => {
        if (!restored) return;
        void writeWorkspaceRoots(roots);
    }, [roots, restored]);

    const loadRoot = useCallback(async (path: string, preserveExpanded = false) => {
        const generation = (generations.current.get(path) ?? 0) + 1;
        generations.current.set(path, generation);
        const isCurrent = () => generations.current.get(path) === generation
            && rootsRef.current.includes(path);
        setTrees(prev => ({ ...prev, [path]: { ...(prev[path] ?? emptyTree()), loading: true, error: null } }));
        try {
            const previous = preserveExpanded ? (treesRef.current[path]?.tree ?? []) : [];
            const tree = await buildTreePreservingExpansion(previous, path);
            if (!isCurrent()) return;
            setTrees(prev => ({ ...prev, [path]: { tree, loading: false, error: null } }));
        } catch (err) {
            if (!isCurrent()) return;
            setTrees(prev => ({ ...prev, [path]: { tree: [], loading: false, error: (err as Error).message } }));
            errorService.showError('Failed to load file tree', err as Error);
        }
    }, []);

    // Load roots that have no tree yet; forget the ones that were removed.
    useEffect(() => {
        if (!restored) return;
        const known = treesRef.current;
        for (const path of roots) {
            if (!known[path] || known[path].error) void loadRoot(path);
        }
        setTrees(prev => {
            const next: Record<string, RootTree> = {};
            for (const path of roots) if (prev[path]) next[path] = prev[path];
            return Object.keys(next).length === Object.keys(prev).length ? prev : next;
        });
    }, [roots, restored, loadRoot]);

    const refreshAll = useCallback(() => {
        for (const path of rootsRef.current) void loadRoot(path, true);
        setRefreshKey(key => key + 1);
    }, [loadRoot]);

    const addRoot = useCallback(async () => {
        const path = await openFolderDialog();
        if (!path) return;
        const identity = normalizeRoots([path])[0];
        if (!identity) return;
        setRoots(current => (current.includes(identity) ? current : [...current, identity]));
        // Keeps `openedFolder` pointing at the newest root, exactly like upstream.
        onFolderOpen(identity);
    }, [onFolderOpen]);

    const removeRoot = useCallback((path: string) => {
        const remaining = rootsRef.current.filter(item => item !== path);
        setRoots(remaining);
        if (path !== folderPath) return;
        // The primary root is gone: let the settings follow a survivor so the
        // next launch does not resurrect it.
        if (remaining.length) onFolderOpen(remaining[0]);
        else onCloseFolder?.();
    }, [folderPath, onFolderOpen, onCloseFolder]);

    const handleNodeClick = useCallback((node: FileNode) => {
        if (!node.isDirectory) onFileSelect(node.path);
    }, [onFileSelect]);

    const handleNodeExpand = useCallback(async (node: FileNode) => {
        if (!node.isDirectory) return;
        const root = rootsRef.current.find(item => node.path === item || node.path.startsWith(`${item}/`)
            || node.path.startsWith(`${item}\\`));
        if (!root) return;
        const generation = generations.current.get(root);
        try {
            // Always reload on expand so newly-created files inside the folder appear.
            const children = await readTreeLevel(node.path);
            if (generation !== undefined && generations.current.get(root) !== generation) return;
            setTrees(prev => {
                const entry = prev[root];
                if (!entry) return prev;
                return { ...prev, [root]: { ...entry, tree: updateNodeChildren(entry.tree, node.path, children) } };
            });
        } catch (err) {
            errorService.showError('Failed to load directory', err as Error);
        }
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizing) {
                const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, e.clientX));
                onWidthChange(newWidth);
            }
        };
        const handleMouseUp = () => setIsResizing(false);

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, onWidthChange]);

    // The filter searches each folder on the backend, not just the folders
    // expanded so far, then the per-root results are shown side by side.
    useEffect(() => {
        const query = searchQuery.trim();
        if (!roots.length || !query) {
            setFilters({});
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void Promise.all(roots.map(async (path) => {
                try {
                    const result = await findFilesByName(path, query);
                    return [path, { query, ...result }] as const;
                } catch (err) {
                    // Shown in the panel, not as a toast: this runs on every keystroke.
                    return [path, {
                        query, tree: [], truncated: false,
                        error: err instanceof Error ? err.message : String(err),
                    }] as const;
                }
            })).then((entries) => {
                if (!cancelled) setFilters(Object.fromEntries(entries));
            });
        }, 150);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [roots, searchQuery, refreshKey]);

    /* Files in the whole workspace, counted on the Rust side. Deliberately not
       derived from the loaded tree: directories load their children on expand,
       so a tree-derived figure would describe the browsing rather than the folder. */
    useEffect(() => {
        if (!roots.length) {
            setCounts({});
            return;
        }
        let cancelled = false;
        void Promise.all(roots.map(async (path) => {
            try {
                const total = await invoke<{ count: number; partial: boolean }>('count_project_files', { path });
                return [path, total] as const;
            } catch {
                return [path, null] as const;
            }
        })).then((entries) => {
            if (cancelled) return;
            const next: Record<string, { count: number; partial: boolean }> = {};
            for (const [path, total] of entries) if (total) next[path] = total;
            setCounts(next);
        });
        return () => { cancelled = true; };
    }, [roots, refreshKey]);

    const filtering = searchQuery.trim().length > 0;
    const matchCount = useMemo(
        () => Object.values(filters).reduce((total, entry) => total + countFiles(entry.tree), 0),
        [filters],
    );
    const filterTruncated = useMemo(
        () => Object.values(filters).some(entry => entry.truncated),
        [filters],
    );

    const countedRoots = Object.keys(counts).length;
    const totalFileCount = useMemo(() => {
        if (filtering) return matchCount;
        if (!roots.length || countedRoots === 0) return null;
        return Object.values(counts).reduce((total, entry) => total + entry.count, 0);
    }, [filtering, matchCount, roots.length, countedRoots, counts]);
    // Counting stops at a time, size or depth limit (or a root failed to count):
    // say so rather than presenting a partial figure as the workspace's size.
    const countIsPartial = !filtering
        && (countedRoots < roots.length || Object.values(counts).some(entry => entry.partial));

    const dirtyCount = dirtyPaths?.size ?? 0;

    if (collapsed) return null;

    return (
        <div className="file-explorer" style={{ width: `${width}px` }}>
            <div className="file-explorer-header">
                <span className="file-explorer-title">EXPLORER</span>
                <div className="file-explorer-actions">
                    <button
                        className="file-explorer-action-btn"
                        onClick={() => { void addRoot(); }}
                        title={roots.length ? 'Add Folder to Workspace' : 'Open Folder'}
                        aria-label={roots.length ? 'Add Folder to Workspace' : 'Open Folder'}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            <line x1="12" y1="11" x2="12" y2="17"/>
                            <line x1="9" y1="14" x2="15" y2="14"/>
                        </svg>
                    </button>
                    <button className="file-explorer-action-btn" onClick={refreshAll} title="Refresh">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                    </button>
                    {roots.length > 0 && onCloseFolder && (
                        <button className="file-explorer-action-btn" onClick={onCloseFolder} title="Close Folder" aria-label="Close Folder">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                <line x1="9" y1="14" x2="15" y2="14"/>
                            </svg>
                        </button>
                    )}
                    {/* Hides the sidebar; the folder stays open (Close Folder is separate). */}
                    <button className="file-explorer-action-btn" onClick={onClose} title="Hide Explorer" aria-label="Hide Explorer">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>

            {roots.length > 0 && (
                <div className="file-explorer-search">
                    <input
                        type="text"
                        className="file-explorer-search-input"
                        placeholder="Filter by file name…"
                        title="Filters the tree by file name. To search text inside files, use Find in Files (Ctrl/Cmd+Shift+F)."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button className="file-explorer-search-clear" onClick={() => setSearchQuery('')} title="Clear filter">
                            ×
                        </button>
                    )}
                </div>
            )}

            <div className="file-explorer-content">
                {roots.length === 0 && (
                    <div className="file-explorer-empty">
                        <p>No folder opened</p>
                        <button className="file-explorer-open-btn" onClick={() => { void addRoot(); }}>
                            Open Folder
                        </button>
                    </div>
                )}

                {roots.map((root) => {
                    const entry = trees[root];
                    const filter = filtering ? filters[root] : undefined;
                    const nodes = filtering ? (filter?.tree ?? []) : (entry?.tree ?? []);
                    const loading = !filtering && (!entry || entry.loading);
                    const error = !filtering ? entry?.error ?? null : null;
                    return (
                        <div className="file-tree" role="tree" aria-label="Files" key={root} data-root={root}>
                            <div className="file-tree-root" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div className="file-tree-root-name" title={root} style={{ flex: 1, minWidth: 0 }}>
                                    <FolderIconNamed name={rootLabel(root)} open />
                                    {rootLabel(root)}
                                </div>
                                <button
                                    className="file-explorer-action-btn"
                                    title={`Remove ${rootLabel(root)} from workspace`}
                                    aria-label={`Remove ${rootLabel(root)} from workspace`}
                                    onClick={() => removeRoot(root)}
                                    style={{ opacity: 0.6 }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </button>
                            </div>

                            {loading && <div className="file-explorer-loading">Loading...</div>}

                            {error && (
                                <div className="file-explorer-error">
                                    <p>Error: {error}</p>
                                    <button onClick={() => { void loadRoot(root); }}>Retry</button>
                                </div>
                            )}

                            {!loading && !error && filtering && filter?.error && (
                                <div className="file-explorer-no-results">
                                    Couldn't search this folder: {withoutErrorCodes(filter.error)}
                                </div>
                            )}

                            {!loading && !error && filtering && filter && !filter.error && nodes.length === 0 && (
                                <div className="file-explorer-no-results">
                                    No file names match "{filter.query}".
                                </div>
                            )}

                            {!loading && !error && nodes.map((node, index) => (
                                <FileTreeNode
                                    key={node.path}
                                    node={node}
                                    level={0}
                                    onClick={handleNodeClick}
                                    onExpand={handleNodeExpand}
                                    activePath={activePath}
                                    dirtyPaths={dirtyPaths}
                                    tabIndex={index === 0 ? 0 : -1}
                                />
                            ))}
                        </div>
                    );
                })}

                {filtering && filterTruncated && (
                    <div className="file-explorer-no-results">
                        Showing the first matches only; type more of the name to narrow the search.
                    </div>
                )}
            </div>

            {roots.length > 0 && (
                <div className="file-explorer-footer">
                    {/* Blank until the walk returns, rather than showing a 0 that
                        would be read as an empty folder. */}
                    <span title={countIsPartial ? 'Counting stopped early; the workspace has at least this many files.' : undefined}>
                        {totalFileCount === null
                            ? ''
                            : `${totalFileCount.toLocaleString()}${countIsPartial ? '+' : ''} ${totalFileCount === 1 && !countIsPartial ? 'file' : 'files'}`}
                    </span>
                    {dirtyCount > 0 && (
                        <span className="file-explorer-footer-unsaved">
                            {dirtyCount} unsaved
                        </span>
                    )}
                </div>
            )}

            <div className="file-explorer-resize-handle" onMouseDown={handleMouseDown} />
        </div>
    );
});
