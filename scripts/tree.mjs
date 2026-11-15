/**
 * 合成构建树 `.build/`。
 * ------------------------------------------------------------------
 * upstream/ 是 zitrino-oss/zitext-editor 前端在锁定提交上的**原样快照**，
 * 不要就地修改。所有移植改动都在 shell/ 里：
 *   - shell/shim/     Tauri → OTools 宿主适配层（Vite alias 指过去）
 *   - shell/src/      少量必须替换的上游文件（覆盖同名路径）
 *   - shell/tests/    移植层自己的回归测试
 *   - shell/index.html、vite.config.ts、vitest.config.ts
 *
 * `.build/` 是产物目录，随时可以删掉重建。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const buildDir = path.join(repoRoot, '.build');
export const distDir = path.join(repoRoot, 'dist');

const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'target', 'dist', 'dist-pack']);

export function walk(dir, base = dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (SKIP_NAMES.has(name)) continue;
        const full = path.join(dir, name);
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) walk(full, base, out);
        else if (stat.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
    }
    return out;
}

function copyTree(from, to) {
    if (!fs.existsSync(from)) throw new Error(`缺少目录：${from}`);
    fs.mkdirSync(to, { recursive: true });
    for (const relative of walk(from)) {
        const source = path.join(from, relative);
        const target = path.join(to, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }
}

/** 只做「一行文案」级别的替换，并断言命中次数，避免上游漂移后静默失效。 */
const TEXT_PATCHES = [
    {
        file: 'src/components/SettingsModal.tsx',
        find: 'description="Checks zitext.com once per session. No personal data is sent."',
        replace: 'description="Updates are delivered by OTools; no network check is performed."',
        expected: 1,
    },
];

function applyTextPatches() {
    for (const patch of TEXT_PATCHES) {
        const file = path.join(buildDir, patch.file);
        if (!fs.existsSync(file)) throw new Error(`补丁目标不存在：${patch.file}`);
        const text = fs.readFileSync(file, 'utf8');
        const count = text.split(patch.find).length - 1;
        if (count !== patch.expected) {
            throw new Error(`补丁失效：${patch.file} 期望命中 ${patch.expected} 次，实际 ${count} 次。上游可能已改版，请同步 shell/ 里的适配层。`);
        }
        fs.writeFileSync(file, text.split(patch.find).join(patch.replace));
    }
}

/** 生成 .build/ 并返回路径；重复调用会先清空旧树。 */
export function prepareTree() {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(buildDir, { recursive: true });

    copyTree(path.join(repoRoot, 'upstream', 'src'), path.join(buildDir, 'src'));
    copyTree(path.join(repoRoot, 'upstream', 'public'), path.join(buildDir, 'public'));
    copyTree(path.join(repoRoot, 'shell', 'shim'), path.join(buildDir, 'shim'));
    copyTree(path.join(repoRoot, 'shell', 'src'), path.join(buildDir, 'src'));
    copyTree(path.join(repoRoot, 'shell', 'tests'), path.join(buildDir, 'tests'));

    for (const name of ['index.html', 'vite.config.ts', 'vitest.config.ts']) {
        fs.copyFileSync(path.join(repoRoot, 'shell', name), path.join(buildDir, name));
    }
    fs.copyFileSync(path.join(repoRoot, 'logo.svg'), path.join(buildDir, 'public', 'logo.svg'));

    applyTextPatches();
    return { buildDir, distDir };
}

export const viteBin = () => path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
export const vitestBin = () => path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
export const tscBin = () => path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

export function assertDeps() {
    for (const [name, bin] of [['vite', viteBin()], ['vitest', vitestBin()], ['typescript', tscBin()]]) {
        if (!fs.existsSync(bin)) {
            console.error(`找不到 ${name}。先在仓库根执行：npm install --legacy-peer-deps`);
            process.exit(1);
        }
    }
}
