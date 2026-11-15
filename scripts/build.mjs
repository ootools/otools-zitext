/**
 * 构建 OTools 插件前端 → dist/。
 * ------------------------------------------------------------------
 *   node scripts/build.mjs              合成 .build/ + vite build + 入口自检
 *   node scripts/build.mjs --tree       只合成 .build/（排查移植改动时用）
 *
 * dist/ 就是 plugin.json 的 entry: dist/index.html 指向的东西，宿主用
 * otools-plugin://<uuid>/dist/index.html 提供。不需要 Rust、不需要 Tauri CLI。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { assertDeps, buildDir, distDir, prepareTree, repoRoot, viteBin } from './tree.mjs';

const has = (name) => process.argv.includes(`--${name}`);

function fail(message) {
    console.error(message);
    process.exit(1);
}

function main() {
    prepareTree();
    console.log(`\n构建树已合成：${path.relative(repoRoot, buildDir)}`);
    if (has('tree')) return;
    assertDeps();

    console.log('\n$ vite build');
    const result = spawnSync(process.execPath, [viteBin(), 'build', '--config', path.join(buildDir, 'vite.config.ts')], {
        cwd: repoRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (result.error) fail(`执行 vite build 失败：${result.error.message}`);
    if ((result.status ?? 1) !== 0) fail('vite build 失败。');

    const entry = path.join(distDir, 'index.html');
    if (!fs.existsSync(entry)) fail(`构建产物里没有 ${entry}，但 plugin.json 的 entry 指向它。`);
    const html = fs.readFileSync(entry, 'utf8');
    if (!/otools/i.test(html)) fail('入口 HTML 缺少 OTools 宿主桥标记。');
    if (!/\.\/assets\//.test(html)) fail('入口 HTML 没有相对路径的 assets/ 引用——宿主用 otools-plugin:// 提供插件，必须是相对路径。');
    if (/src=["']\/assets\//.test(html)) fail('入口 HTML 里有绝对路径的 assets/ 引用。');
    if (/https?:\/\/zitext\.com\/api\//i.test(html)) fail('产物里还残留上游更新接口的请求。');

    const css = fs.existsSync(path.join(distDir, 'assets'))
        ? fs.readdirSync(path.join(distDir, 'assets')).filter((name) => name.endsWith('.css'))
        : [];
    if (css.length === 0) fail('构建产物里没有任何 CSS。检查 main.tsx 是否还 import 了 styles.css。');

    for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
        const source = path.join(repoRoot, name);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(distDir, name));
    }

    const files = fs.readdirSync(distDir).filter((name) => fs.statSync(path.join(distDir, name)).isFile());
    const size = fs.statSync(entry).size;
    console.log(`\n完成：${entry}（${size} B），CSS ${css.length} 个，根目录文件 ${files.length} 个。`);
}

main();
