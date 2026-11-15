/**
 * 校验 .oplg 发布包。
 * ------------------------------------------------------------------
 * 检查：摘要清单、包内 plugin.json 合法性、ZIP 结构与 CRC、
 * entry 与 logo.svg 是否在包里、「正式包不能启用开发模式」，
 * 以及本插件特有的几条：入口 HTML 必须是相对路径、带 OTools 桥标记、
 * 不加载外部脚本，且随包附带 Apache-2.0 许可证与 NOTICE。
 *
 * 用法：node scripts/verify-plugin.mjs [dist-pack]
 */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { expectedPackageNames } from './platform-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(root, process.argv[2] || 'dist-pack');

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const ok = (message) => console.log(`✓ ${message}`);

/** 最小 ZIP 读取器：走中央目录，逐个条目解压并核对 CRC32 */
function readZip(buffer) {
  // EOCD：从尾部往前找 0x06054b50
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65535; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是合法的 ZIP：找不到 EOCD');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`中央目录项 #${i} 签名异常`);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`本地头签名异常：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = compressedSize === uncompressedSize && crc === 0 && uncompressedSize === 0
      ? Buffer.alloc(0)
      : (() => {
          try {
            return inflateRawSync(raw);
          } catch {
            // method 0（存储）时无需解压
            return Buffer.from(raw);
          }
        })();
    entries.push({ name, crc, data, compressedSize, uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const crc32 = (buffer) => {
  // 与 node:zlib 的 crc32 一致（pack-plugin.mjs 打包时用的就是它）
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
};

/** 单个 .oplg 的 ZIP 与内容检查；六个平台包共用同一套规则。 */
function verifyPackage(oplgPath, manifest, filename) {
  const entries = readZip(fs.readFileSync(oplgPath));
  const names = entries.map((e) => e.name);
  if (names.length !== new Set(names).size) fail(`${filename}：ZIP 含重复文件`);
  for (const name of names) {
    if (name.includes('\\')) fail(`${filename}：ZIP 路径含反斜杠：${name}`);
    const pure = path.posix.normalize(name);
    if (pure.startsWith('/') || pure.split('/').includes('..')) fail(`${filename}：ZIP 路径非法：${name}`);
  }
  for (const entry of entries) {
    const actual = crc32(entry.data);
    if (actual !== entry.crc) fail(`${filename}：CRC 校验失败：${entry.name}`);
    if (entry.data.length !== entry.uncompressedSize) fail(`${filename}：解压后大小不符：${entry.name}`);
  }

  if (!names.includes(String(manifest.entry))) fail(`${filename}：ZIP 缺少入口 ${manifest.entry}`);
  if (!names.includes('logo.svg')) fail(`${filename}：ZIP 缺少 logo.svg`);

  const entryData = entries.find((e) => e.name === manifest.entry).data.toString('utf8');
  if (!entryData.includes('./assets/')) fail(`${filename}：入口 HTML 没有相对路径的 assets/ 引用（宿主用 otools-plugin:// 提供插件，必须是相对路径）`);
  if (!/otools/i.test(entryData)) fail(`${filename}：入口 HTML 缺少 OTools 宿主桥标记`);
  if (/<script[^>]+src=["']https?:\/\//i.test(entryData)) fail(`${filename}：入口 HTML 里还有外部 <script src> —— 插件必须完全离线`);

  for (const notice of ['LICENSE', 'NOTICE']) {
    if (!names.includes(notice)) fail(`${filename}：ZIP 缺少 ${notice}（Apache-2.0 随包义务）`);
  }

  const js = entries.filter((e) => e.name.startsWith('dist/') && e.name.endsWith('.js'));
  if (!js.length) fail(`${filename}：包内没有 dist/**/*.js`);
  const wasm = entries.filter((e) => e.name.endsWith('.wasm'));
  const totalBytes = entries.reduce((sum, e) => sum + e.data.length, 0);
  console.log(`✓ ${filename}：${entries.length} 个条目，${js.length} 个 js${wasm.length ? `、${wasm.length} 个 wasm` : ''}，${(totalBytes / 1048576).toFixed(2)} MB`);
}

function main() {
  if (!fs.existsSync(directory)) fail(`目录不存在：${directory}`);

  const manifestPath = path.join(directory, 'plugin.json');
  if (!fs.existsSync(manifestPath)) fail('缺少 plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const { packid, version } = manifest;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packid || '')) fail(`packid 非法：${packid}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version || '')) fail(`version 非法：${version}`);
  ok(`plugin.json 合法：${packid}@${version}`);

  // 发布模式由 meta.json 决定；缺省按单合包处理，兼容手工放进来的包
  const metaPath = path.join(directory, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  // meta.json 可能没随 artifact 一起下载：这时按实际包数推断模式，
  // 避免把六分包误判成合包（历史 workflow 只上传 .oplg / 摘要）。
  const platformPackages = fs.existsSync(metaPath)
    ? meta.packageMode === 1
    : fs.readdirSync(directory).filter((name) => name.endsWith('.oplg')).length > 1;
  const filenames = expectedPackageNames(packid, version, platformPackages);
  const present = fs.readdirSync(directory).filter((name) => name.endsWith('.oplg')).sort();
  const wanted = [...filenames].sort();
  if (present.length !== wanted.length || present.some((name, index) => name !== wanted[index])) {
    fail(`发布目录的 .oplg 与 packageMode 不匹配：期望 ${wanted.join(', ')}，实际 ${present.join(', ') || '（无）'}`);
  }
  ok(`发布模式：${platformPackages ? '六平台分包（packageMode=1）' : '单合包（packageMode=0）'}，共 ${filenames.length} 个包`);

  // 摘要清单必须刚好覆盖全部 .oplg + plugin.json + logo.svg
  const sumsPath = path.join(directory, 'SHA256SUMS');
  if (!fs.existsSync(sumsPath)) fail('缺少 SHA256SUMS');
  const expected = new Set([...filenames, 'plugin.json', 'logo.svg']);
  const checksums = new Map();
  for (const line of fs.readFileSync(sumsPath, 'utf8').split('\n').filter(Boolean)) {
    const [digest, name] = line.split('  ');
    if (!/^[0-9a-f]{64}$/.test(digest) || !expected.has(name) || checksums.has(name)) fail(`摘要清单无效：${line}`);
    checksums.set(name, digest);
  }
  if (checksums.size !== expected.size) fail('摘要清单不完整或混入其他版本');
  for (const [name, digest] of checksums) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
    if (actual !== digest) fail(`摘要不匹配：${name}`);
  }
  ok(`SHA256SUMS 覆盖 ${checksums.size} 个文件且全部匹配`);

  // 正式包不能启用开发模式
  if (manifest.devUrl) fail('正式包不能启用开发模式（devUrl）');
  if (manifest.quickDev) fail('正式包不能启用开发模式（quickDev）');
  ok('已去除 devUrl / quickDev');

  for (const filename of filenames) verifyPackage(path.join(directory, filename), manifest, filename);

  console.log(`\n${filenames.length} 个插件包校验通过（packageMode=${platformPackages ? 1 : 0}）。`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
