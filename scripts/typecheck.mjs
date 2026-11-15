/** 合成构建树后对整个前端（上游源码 + 移植层）做 TypeScript 检查。 */
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { assertDeps, prepareTree, repoRoot, tscBin } from './tree.mjs';

prepareTree();
assertDeps();
const result = spawnSync(process.execPath, [tscBin(), '--noEmit', '--pretty', 'false', '-p', `${repoRoot}/tsconfig.json`], {
    cwd: repoRoot,
    stdio: 'inherit',
});
process.exit(result.status ?? 1);
