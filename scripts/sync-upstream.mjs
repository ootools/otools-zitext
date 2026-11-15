/**
 * 同步上游快照到 `upstream/`，并写下 `upstream.lock.json`。
 * ------------------------------------------------------------------
 *   node scripts/sync-upstream.mjs --from <dir>    用本机已有的 zitext-editor 克隆
 *   node scripts/sync-upstream.mjs --ref <ref>     从 GitHub 拉指定分支/标签/提交
 *   node scripts/sync-upstream.mjs --check         只校验 upstream/ 与 lock 是否一致
 *
 * 为什么不是 git subtree？上游是 Tauri 桌面应用，src-tauri/（Rust 后端）、
 * .github/、scripts/ 与打包配置对插件版毫无用处；我们只需要前端 src/、
 * public/ 以及许可证和依赖声明。挂整仓 subtree 只会把用不到的 Rust
 * workspace 带进插件仓。所以这里用「白名单快照 + 内容哈希锁定」：
 *   - `upstream/` 是锁定提交上这些路径的**原样快照**，不要就地修改；
 *     移植改动一律放 `shell/`，由 scripts/tree.mjs 叠加到构建树。
 *   - `upstream.lock.json` 记下提交号与整棵树的内容哈希，`--check`
 *     能验证快照有没有被动过（CI 门禁会跑）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM_DIR = path.join(repoRoot, 'upstream');
const LOCK_PATH = path.join(repoRoot, 'upstream.lock.json');

const REPO = 'zitrino-oss/zitext-editor';
const REPO_URL = `https://github.com/${REPO}.git`;
const SSH_URL = `git@github.com:${REPO}.git`;

/** 只保留前端与合规文件；Rust 后端与 CI 配置不进插件仓。 */
const SNAPSHOT_PATHS = [
    'src', 'public', 'index.html', 'package.json', 'vite.config.ts',
    'tsconfig.json', 'tsconfig.node.json', 'LICENSE', 'NOTICE', 'README.md',
    'CHANGELOG.md', 'DEPENDENCY_EXCEPTIONS.md', '.nvmrc',
];
const EXCLUDE_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'target', 'dist']);

function arg(name, fallback = null) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
        ? process.argv[index + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} 失败：${result.error?.message || result.stderr || result.stdout}`);
    }
    return (result.stdout || '').trim();
}

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

function copyPath(sourceRoot, relative) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`上游缺少路径：${relative}`);
    const stat = fs.statSync(source);
    const target = path.join(UPSTREAM_DIR, relative);
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

function check() {
    if (!fs.existsSync(LOCK_PATH)) throw new Error('缺少 upstream.lock.json，请先运行同步脚本');
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    const current = treeHash(UPSTREAM_DIR);
    if (current.hash !== lock.treeHash || current.fileCount !== lock.fileCount) {
        throw new Error(`upstream/ 与 upstream.lock.json 不一致（当前 ${current.fileCount} 个文件 / ${current.hash.slice(0, 12)}，锁定 ${lock.fileCount} 个 / ${String(lock.treeHash).slice(0, 12)}）。不要就地修改快照，改动应放 shell/。`);
    }
    console.log(`✓ 上游快照一致：${REPO}@${lock.commit.slice(0, 12)}，${current.fileCount} 个文件，${current.hash.slice(0, 16)}…`);
}

function main() {
    if (has('check')) { check(); return; }

    let sourceRoot = arg('from');
    let temporary = null;
    if (!sourceRoot) {
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zitext-upstream-'));
        const ref = arg('ref', 'main');
        const env = { ...process.env };
        for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete env[key];
        run('git', ['clone', '--depth', '1', '--branch', ref, SSH_URL, temporary], { env });
        sourceRoot = temporary;
    }
    sourceRoot = path.resolve(sourceRoot);

    const commit = run('git', ['-C', sourceRoot, 'rev-parse', 'HEAD']);
    const commitDate = run('git', ['-C', sourceRoot, 'log', '-1', '--format=%cI']);
    const ref = arg('ref', run('git', ['-C', sourceRoot, 'rev-parse', '--abbrev-ref', 'HEAD']));

    for (const relative of SNAPSHOT_PATHS) copyPath(sourceRoot, relative);
    const { hash, fileCount } = treeHash(UPSTREAM_DIR);
    const lock = {
        repo: REPO,
        url: REPO_URL,
        subpath: '(frontend whitelist)',
        ref,
        commit,
        commitDate,
        fetchedAt: new Date().toISOString(),
        fileCount,
        treeHash: hash,
        note: 'upstream/ 是锁定提交下前端白名单路径的原样快照，不要就地修改；移植改动放 shell/。',
    };
    fs.writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    console.log(`✓ 已同步 ${REPO}@${commit.slice(0, 12)}：${fileCount} 个文件，treeHash=${hash.slice(0, 16)}…`);
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
