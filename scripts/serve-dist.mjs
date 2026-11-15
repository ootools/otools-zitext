/**
 * 把 dist/ 当静态站点跑起来（本地预览 / 冒烟测试用；不进插件分发）。
 *   node scripts/serve-dist.mjs [端口]     默认 5396
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repoRoot, 'dist');
const port = Number(process.argv[2] || 5396);

if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('dist/index.html 不存在，先跑 node scripts/build.mjs');
    process.exit(1);
}

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dist, rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}/  （Ctrl+C 结束）`);
});
