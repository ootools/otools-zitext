/**
 * 跑移植层回归测试 + 发布脚本单元测试。
 * ------------------------------------------------------------------
 *   node scripts/test.mjs              移植层测试（CI 门禁）
 *   node scripts/test.mjs --upstream   再叠加 .build/src 下的上游测试（参考用）
 *   node scripts/test.mjs core         只跑文件名含 core 的移植层用例
 *
 * 上游自带 900+ 个测试，但它们针对的是 Tauri 后端与 zitext.com 的产品形态；
 * 本仓的回归责任是「宿主适配层正确」和「构建树能合成」。上游套件可以手动
 * 用 --upstream 核对，结果不作为门禁。
 */
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { assertDeps, buildDir, prepareTree, vitestBin } from './tree.mjs';

const args = process.argv.slice(2);
const withUpstream = args.includes('--upstream');
const filters = args.filter((item) => !item.startsWith('--'));

prepareTree();
assertDeps();

const vitest = vitestBin();
const vitestArgs = [vitest, 'run', '--config', `${buildDir}/vitest.config.ts`];
if (withUpstream) {
    // 位置参数是路径子串过滤：'src' 命中上游用例，'tests' 命中移植层用例。
    vitestArgs.push('src', 'tests');
} else if (filters.length) {
    vitestArgs.push(...filters);
}
console.log(`\n$ vitest run  （范围：${withUpstream ? '移植层 + 上游' : '仅移植层'}）`);
const status = spawnSync(process.execPath, vitestArgs, {
    cwd: buildDir,
    stdio: 'inherit',
    env: { ...process.env, ZITEXT_UPSTREAM_TESTS: withUpstream ? '1' : '' },
}).status ?? 1;
if (status !== 0) process.exit(status);

console.log('\n$ node --test scripts/*.test.mjs');
const unit = spawnSync(process.execPath, ['--test', 'scripts/platform-packages.test.mjs', 'scripts/publish-market.test.mjs', 'scripts/release-policy.test.mjs'], {
    cwd: process.cwd(), stdio: 'inherit',
}).status ?? 1;
process.exit(unit);
