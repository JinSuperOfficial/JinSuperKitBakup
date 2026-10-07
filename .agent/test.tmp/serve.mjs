/* 临时静态服务器（验收完毕可整个删掉 .agent/test.tmp）：
   - 本目录下的测试页 → http://<本机IP>:8813/panel-test.html
   - 站点原文（jinsuper.rth1.xyz）→ http://<本机IP>:8813/811/function.html
   响应一律 no-store，避免浏览器缓存把旧 CSS/JS 混进来。
   启动：node .agent/test.tmp/serve.mjs [端口，默认 8813] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..', 'jinsuper.rth1.xyz');
const PORT = Number(process.argv[2] || 8813);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    /* 本目录里的测试页优先；其余按站点原文解析 */
    const local = path.join(HERE, p);
    const file = (local.startsWith(HERE) && fs.existsSync(local)) ? local : path.join(SITE, p);
    if (!file.startsWith(HERE) && !file.startsWith(SITE)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 ' + p);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'pragma': 'no-cache',
      'expires': '0',
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 ' + e.message);
  }
}).listen(PORT, '0.0.0.0');
