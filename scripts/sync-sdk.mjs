/**
 * 同步 / 校验 vendor 里的宿主 SDK（`otools-plugin-sdk`）。
 * ------------------------------------------------------------------
 *   node scripts/sync-sdk.mjs --from <dir>   从宿主仓库的 vendor/otools-plugin-sdk 拷一份
 *   node scripts/sync-sdk.mjs --check        只校验 vendor/ 与 vendor/sdk-source.json 是否一致
 *
 * 为什么不用 npm 直接依赖上游？宿主 SDK 不在 npm 上，它是宿主仓库里的一个
 * 工作区包，版本随宿主发版。插件要的是**某一版确定**的 `pickFromHostTree`
 * 行为（DOM 树的选择器），跟着宿主 `main` 漂会随时改变交互。所以这里沿用
 * `upstream/` 的做法：白名单拷贝 + 内容哈希锁定，`--check` 能发现有人就地
 * 改了 vendor/，也能在同步后留下可追溯的版本号与哈希。
 *
 * 只拷 dist/ 与合规文件，不拷 src/：SDK 的 `dist/host-file-tree.js` 被内联
 * 进 `index.js`，独立入口并不存在，拷源码只会让构建多一条没人用的路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = path.join(repoRoot, 'vendor', 'otools-plugin-sdk');
const SOURCE_PATH = path.join(repoRoot, 'vendor', 'sdk-source.json');

/** 白名单：SDK 的运行时产物与合规文件。 */
const SNAPSHOT_PATHS = ['dist', 'package.json', 'LICENSE', 'README.md'];
const EXCLUDE_NAMES = new Set(['node_modules', '.git', '.DS_Store']);

function arg(name, fallback = null) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
        ? process.argv[index + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

function walk(dir, base = dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (EXCLUDE_NAMES.has(name)) continue;
        const full = path.join(dir, name);
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) walk(full, base, out);
        else if (stat.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
    }
    return out;
}

function treeHash(dir) {
    const files = walk(dir).sort();
    const hash = createHash('sha256');
    for (const relative of files) {
        const data = fs.readFileSync(path.join(dir, relative));
        hash.update(relative);
        hash.update('\0');
        hash.update(String(data.length));
        hash.update('\0');
        hash.update(createHash('sha256').update(data).digest());
        hash.update('\n');
    }
    return { hash: hash.digest('hex'), fileCount: files.length };
}

function readSource() {
    if (!fs.existsSync(SOURCE_PATH)) throw new Error('缺少 vendor/sdk-source.json，请先运行 `node scripts/sync-sdk.mjs --from <dir>`');
    return JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
}

function check() {
    const source = readSource();
    if (!source.treeHash) {
        throw new Error('vendor/sdk-source.json 还没有 treeHash，请重新运行 `node scripts/sync-sdk.mjs --from <dir>` 打上锁定值');
    }
    const current = treeHash(VENDOR_DIR);
    if (current.hash !== source.treeHash || current.fileCount !== source.fileCount) {
        throw new Error(`vendor/otools-plugin-sdk 与 sdk-source.json 不一致（当前 ${current.fileCount} 个文件 / ${current.hash.slice(0, 12)}，锁定 ${source.fileCount} 个 / ${String(source.treeHash).slice(0, 12)}）。不要就地改 vendor/，升级请用 --from 重新同步。`);
    }
    // 入口一旦在 SDK 内部改名，import 会在构建期才炸；这里提前拦。
    const index = path.join(VENDOR_DIR, 'dist', 'index.js');
    if (!fs.existsSync(index)) throw new Error('vendor/otools-plugin-sdk/dist/index.js 不存在');
    const bundle = fs.readFileSync(index, 'utf8');
    const missing = (source.entryPointsUsed || []).filter((name) => !bundle.includes(name));
    if (missing.length) throw new Error(`dist/index.js 里找不到入口：${missing.join(', ')}`);
    console.log(`✓ 宿主 SDK 一致：otools-plugin-sdk@${source.version}，${current.fileCount} 个文件，${current.hash.slice(0, 16)}…`);
}

function copyInto(sourceRoot) {
    for (const relative of SNAPSHOT_PATHS) {
        const source = path.join(sourceRoot, relative);
        if (!fs.existsSync(source)) throw new Error(`SDK 缺少路径：${relative}`);
        const target = path.join(VENDOR_DIR, relative);
        const stat = fs.statSync(source);
        if (stat.isDirectory()) {
            fs.mkdirSync(target, { recursive: true });
            for (const item of walk(source)) {
                const destination = path.join(target, item);
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.copyFileSync(path.join(source, item), destination);
            }
        } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
        }
    }
}

function sync() {
    const from = arg('from');
    if (!from) throw new Error('用法：node scripts/sync-sdk.mjs --from <宿主仓库的 vendor/otools-plugin-sdk> | --check');
    const sourceRoot = path.resolve(from);
    if (!fs.existsSync(sourceRoot)) throw new Error(`源目录不存在：${sourceRoot}`);

    const sdkPackage = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'));
    // 允许 `--from vendor/otools-plugin-sdk` 原地盖章：只重算哈希，不动文件。
    const inPlace = sourceRoot === VENDOR_DIR;
    if (!inPlace) copyInto(sourceRoot);

    const { hash, fileCount } = treeHash(VENDOR_DIR);
    const previous = fs.existsSync(SOURCE_PATH) ? JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')) : {};
    const record = {
        upstream: previous.upstream || 'https://github.com/ootools/otools-plugin-sdk',
        version: sdkPackage.version,
        source: previous.source || 'otools/otools vendor/otools-plugin-sdk (dist only, 与宿主内置版本同源)',
        syncedAt: new Date().toISOString(),
        fileCount,
        treeHash: hash,
        entryPointsUsed: previous.entryPointsUsed || ['pickFromHostTree', 'browseHostDir'],
        note: previous.note || '只拷贝 dist + package.json + LICENSE/README；dist 里没有独立的 host-file-tree.js（被内联进 index.js）。',
    };
    fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    console.log(`✓ 已${inPlace ? '盖章' : '同步'} otools-plugin-sdk@${record.version}：${fileCount} 个文件，treeHash=${hash.slice(0, 16)}…`);
}

try {
    if (has('check')) check();
    else sync();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
