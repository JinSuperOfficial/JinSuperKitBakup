'use strict';
/**
 * src/local-server.js —— 内置离线副本的本地静态服务
 * ---------------------------------------------------------------
 * 为什么要起服务而不是直接 file://：
 *   站点的清单（/Skills/skills.json、/class/tools.json）是 fetch 出来的，
 *   file:// 下 fetch 会被 CORS 拦掉，页面会显示「清单没加载出来」。
 *   所以离线副本也走 http://127.0.0.1:<随机端口>/，和线上行为完全一致。
 *
 * 只服务打包进来的那份快照目录，只监听 127.0.0.1，端口交给系统挑（0），
 * 因此不会和别的程序抢端口；支持 Range（英语听力那种音频要拖进度条）。
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** 离线副本目录：打包后在 resources/site，开发时直接用仓库里的站点源目录 */
function siteRoot() {
  if (process.env.JSD_SITE_ROOT) return path.resolve(process.env.JSD_SITE_ROOT);
  const { app } = require('electron');
  if (app.isPackaged) return path.join(process.resourcesPath, 'site');
  return path.resolve(__dirname, '..', '..', 'jinsuper.rth1.xyz');
}

let server = null;
let base = null;
let starting = null;

function mimeOf(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** 把 URL 路径落成磁盘路径；越界（../）一律拒掉 */
function resolveFile(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.resolve(root, `.${path.posix.normalize(rel)}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

async function pickFile(root, urlPath) {
  const guess = resolveFile(root, urlPath);
  if (!guess) return null;
  const tries = [guess];
  if (!path.extname(guess)) tries.push(`${guess}.html`, path.join(guess, 'index.html'));
  for (const t of tries) {
    try {
      const st = await fsp.stat(t);
      if (st.isFile()) return { file: t, stat: st };
      if (st.isDirectory()) {
        const idx = path.join(t, 'index.html');
        const ist = await fsp.stat(idx).catch(() => null);
        if (ist && ist.isFile()) return { file: idx, stat: ist };
      }
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

function sendRange(req, res, file, stat, type) {
  const total = stat.size;
  const range = req.headers.range;
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (!range || !/^bytes=\d*-\d*(,\d*-\d*)*$/.test(range)) {
    res.writeHead(200, { ...headers, 'Content-Length': total });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  const [rawStart, rawEnd] = range.replace(/bytes=/, '').split(',')[0].split('-');
  let start = rawStart === '' ? total - Number(rawEnd) : Number(rawStart);
  let end = rawStart === '' || rawEnd === '' ? total - 1 : Number(rawEnd);
  start = Math.max(0, Math.min(start, total - 1));
  end = Math.max(start, Math.min(end, total - 1));
  res.writeHead(206, {
    ...headers,
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1,
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file, { start, end }).pipe(res);
}

async function handle(req, res) {
  const root = siteRoot();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method Not Allowed');
  }
  let hit = await pickFile(root, req.url || '/');
  let code = 200;
  if (!hit) {
    hit = await pickFile(root, '/404.html');
    code = 404;
  }
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404');
  }
  const type = mimeOf(hit.file);
  if (code === 404) {
    res.writeHead(404, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(hit.file).pipe(res);
  }
  return sendRange(req, res, hit.file, hit.stat, type);
}

/** 起服务（幂等）；返回根地址，例如 http://127.0.0.1:53421 */
function ensure() {
  if (base) return Promise.resolve(base);
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    const root = siteRoot();
    if (!fs.existsSync(path.join(root, 'index.html'))) {
      starting = null;
      reject(new Error(`内置离线副本不存在或缺 index.html：${root}`));
      return;
    }
    server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        console.error('[local] 出错：', err && err.message);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500');
      });
    });
    server.once('error', (err) => {
      starting = null;
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve(base);
    });
  });
  return starting;
}

function url() {
  return base;
}

function close() {
  if (server) {
    server.close();
    server = null;
    base = null;
    starting = null;
  }
}

module.exports = { ensure, url, close, siteRoot, resolveFile, mimeOf };
