/**
 * 临时静态服务器：只为本地验收用，不属于站点产物。
 * 用法：node build/.serve.mjs 8788
 * 它模拟 Retinbox 的静态托管行为：
 *   · .md 等文本文件原样返回（对应 raw.php 的语义）
 *   · 其它文件按扩展名给 Content-Type
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot as root } from './paths.mjs';

const port = Number(process.argv[2] || 8788);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  /* 模拟 raw.php：?f=路径 读原文 */
  if (urlPath === '/p/raw.php') {
    const q = new URL(req.url, 'http://x').searchParams.get('f') || '';
    const target = path.join(root, q.replace(/^\/+/, ''));
    if (!target.startsWith(root) || !fs.existsSync(target)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到文件');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(fs.readFileSync(target));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const file = path.join(root, urlPath.replace(/^\/+/, ''));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + urlPath);
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(file));
});

/* 没有这个监听，端口被占的时候 Node 会直接甩一坨
   "Unhandled 'error' event" 堆栈出来，看不出到底谁占了。 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${port} 已经被占用了。`);
    console.error(`多半是上一次的预览还开着 —— 打开 http://127.0.0.1:${port}/p/docs.html 看看是不是它。`);
    console.error(`确认是的话，在原来那个窗口按 Ctrl+C；或者换个端口：`);
    console.error(`  node build/.serve.mjs ${port + 1}\n`);
    process.exit(2);
  }
  if (err.code === 'EACCES') {
    console.error(`\n没有权限监听 ${port}（1024 以下的端口在部分系统上要管理员）。换个端口试试。\n`);
    process.exit(2);
  }
  console.error(`\n静态服务器起不来：${err.message}\n`);
  process.exit(2);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`静态服务器已起：http://127.0.0.1:${port}/p/docs.html`);
});
