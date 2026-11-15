/**
 * OTools 移植版：插件由宿主统一更新，不再请求上游 zitext.com 的更新接口。
 * 纯函数（版本比较 / 清单解析）原样保留，供界面与上游测试复用；
 * `useUpdateChecker` 恒不返回更新，界面上的开关因此不会发起任何网络请求。
 */
const SKIPPED_KEY_PREFIX = 'update_skipped_v';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface UpdateInfo {
    version: string;
    releaseDate: string;
}

function storage(): Storage | null {
    try { return window.localStorage; } catch { return null; }
}

/** Remembers "Skip this version" across sessions. */
export function skipUpdateVersion(version: string): void {
    try { storage()?.setItem(`${SKIPPED_KEY_PREFIX}${version}`, '1'); } catch { /* best effort */ }
}

const SEMVER = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

/**
 * Strict SemVer 2.0 precedence: -1, 0 or 1, or null when either string is
 * not a version. Pre-releases sort before their release, so moving from
 * 2.2.0-rc.1 to 2.2.0 is an update.
 */
export function compareVersions(a: string, b: string): number | null {
    const pa = SEMVER.exec(a.trim());
    const pb = SEMVER.exec(b.trim());
    if (!pa || !pb) return null;
    for (let i = 1; i <= 3; i++) {
        const diff = Number(pa[i]) - Number(pb[i]);
        if (diff !== 0) return Math.sign(diff);
    }
    const preA = pa[4];
    const preB = pb[4];
    if (preA === preB) return 0;
    if (preA === undefined) return 1;
    if (preB === undefined) return -1;
    const idsA = preA.split('.');
    const idsB = preB.split('.');
    for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
        const x = idsA[i];
        const y = idsB[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const nx = /^\d+$/.test(x);
        const ny = /^\d+$/.test(y);
        if (nx && ny) {
            const diff = Number(x) - Number(y);
            if (diff !== 0) return Math.sign(diff);
        } else if (nx !== ny) {
            return nx ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

/** Reads the manifest defensively: bounded size, expected field types. */
export function parseManifest(text: string): UpdateInfo | null {
    if (text.length > MAX_MANIFEST_BYTES) return null;
    let manifest: unknown;
    try { manifest = JSON.parse(text); } catch { return null; }
    if (!manifest || typeof manifest !== 'object') return null;
    const { version, releaseDate } = manifest as Record<string, unknown>;
    if (typeof version !== 'string' || !SEMVER.test(version.trim())) return null;
    return {
        version: version.trim(),
        releaseDate: typeof releaseDate === 'string' && releaseDate.length <= 40 ? releaseDate : '',
    };
}

/**
 * 插件版永不请求外部更新接口：版本发布由 OTools 宿主 / 插件市场负责。
 * 保留同名 hook 与返回结构，上游 App.tsx 无需改动。
 */
export function useUpdateChecker(_enabled: boolean = true): { update: UpdateInfo | null; dismiss: () => void; skip: () => void } {
    return {
        update: null,
        dismiss: () => {},
        skip: () => {},
    };
}
