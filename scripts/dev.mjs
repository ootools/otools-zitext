/**
 * 开发服务器：合成 .build/ 后跑 vite（HMR），端口 5395。
 * ------------------------------------------------------------------
 *   node scripts/dev.mjs
 *
 * 宿主不在时页面退回到浏览器虚拟文件系统（localStorage），文件对话框用
 * prompt 输入路径；要验证真实宿主行为，请把 .oplg 装进 OTools，或在
 * plugin.json 里开 quickDev 后由宿主加载 devUrl。
 */
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { assertDeps, buildDir, prepareTree, repoRoot, viteBin } from './tree.mjs';

prepareTree();
assertDeps();
console.log(`\n$ vite  (root=${path.relative(repoRoot, buildDir)})`);
const status = spawnSync(process.execPath, [viteBin(), '--config', path.join(buildDir, 'vite.config.ts')], {
    cwd: buildDir,
    stdio: 'inherit',
}).status ?? 1;
process.exit(status);
