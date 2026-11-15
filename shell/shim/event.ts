/**
 * In-page replacement for `@tauri-apps/api/event`.
 *
 * Upstream uses Tauri events for native-menu actions, dialog results, close
 * requests and session-restore notifications. An OTools plugin has no native
 * menu and its window is owned by the host, so those events never originate
 * outside the page. The ones that matter here (dialog results and host file
 * drops) are emitted by our own invoke router; every other subscription simply
 * stays idle instead of throwing.
 */
export interface OtoolsEvent<T> {
    event: string;
    id: number;
    payload: T;
}

export type UnlistenFn = () => void;

// Upstream wraps `listen` in helpers typed as `(...args: unknown[]) => unknown`,
// so the callback must accept an unconstrained return value. `emit` awaits the
// result regardless, which keeps async handlers sequenced as before.
type Handler = (event: OtoolsEvent<any>) => unknown;

const listeners = new Map<string, Set<Handler>>();
let nextId = 1;

export async function listen<T>(event: string, handler: (event: OtoolsEvent<T>) => unknown): Promise<UnlistenFn> {
    const set = listeners.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    listeners.set(event, set);
    return () => {
        set.delete(handler as Handler);
        if (set.size === 0) listeners.delete(event);
    };
}

export async function once<T>(event: string, handler: (event: OtoolsEvent<T>) => void | Promise<void>): Promise<UnlistenFn> {
    const unlisten = await listen<T>(event, async (payload) => {
        unlisten();
        await handler(payload);
    });
    return unlisten;
}

export async function emit<T = unknown>(event: string, payload?: T): Promise<void> {
    const set = listeners.get(event);
    if (!set) return;
    const eventObject: OtoolsEvent<T> = { event, id: nextId++, payload: payload as T };
    for (const handler of [...set]) {
        try { await handler(eventObject); }
        catch (error) { console.error(`[zitext] event handler failed: ${event}`, error); }
    }
}

export const listenerCount = (event: string): number => listeners.get(event)?.size ?? 0;
