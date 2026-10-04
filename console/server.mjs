/**
 * 发布控制台 · 本地 HTTP 服务
 * ---------------------------------------------------
 * 一个进程干两件事：
 *   /api/**   → 读写文章、归档、预渲染（见 lib/api.mjs）
 *   其余      → 静态资源：先找 console/web/，找不到再落到站点根（/p/docs-md.css、
 *               /p/fonts/*、/811/data/** 这些预览与试听用的文件）
 *
 * 安全与约束：
 *   · 只监听 127.0.0.1 —— 这是本机工具，不是网站，不对外。
 *   · 静态路径先 realpath 再校验必须落在允许的根里，挡住 `../` 穿越。
 *   · 不用任何外部依赖，也不 spawn 子进程（这个环境里管道受限）。
 *
 * 跑法：node console/server.mjs [--port 8791] [--no-open]
 *   或者直接双击项目根的 控制台.cmd
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { consoleDir, isDir, isFile, siteRoot, webDir, workspaceRoot } from './lib/paths.mjs';
import * as api from './lib/api.mjs';

/* ── 参数 ── */
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.CONSOLE_PORT || 8791));
const HOST = '127.0.0.1';
const OPEN = !argv.includes('--no-open');

/* ── 路由表 ── */
const ROUTES = {
  'GET /api/state': (q) => api.getState(),
  'GET /api/articles': (q) => api.listArticles(q),
  'GET /api/article': (q) => api.readArticle(q),
  'GET /api/editor': (q) => api.getEditorDoc(q),
  'GET /api/archive': () => api.listArchive(),
  'GET /api/selfcheck': () => api.getSelfCheck(),
  'GET /api/jobs': () => api.getJobs(),
  'GET /api/jobs/one': (q) => api.getJob(q),
  'POST /api/jobs': (q, b) => api.postJob(b),
  'POST /api/jobs/stop': (q, b) => api.postJobStop(b),
  'GET /api/manifest': () => api.getManifest(),
  'PUT /api/manifest': (q, b) => api.putManifest(b),
  'POST /api/manifest/entry': (q, b) => api.postManifestEntry(b),
  'POST /api/manifest/scan': () => api.postManifestScan(),
  'POST /api/manifest/fix': (q, b) => api.postManifestFix(b),
  'GET /api/cloud/domains': () => api.getCloudDomains(),
  'POST /api/cloud/scan': (q, b) => api.postCloudScan(b),
  'POST /api/cloud/diff': (q, b) => api.postCloudDiff(b),
  'POST /api/cloud/pull': (q, b) => api.postCloudPull(b),
  'POST /api/cloud/precheck': (q, b) => api.postCloudPrecheck(b),
  'POST /api/links/scan': (q, b) => api.postLinksScan(b),
  'POST /api/publish-all': (q, b) => api.postPublishAll(b),
  'PUT /api/article': (q, b) => api.putArticle(b),
  'PUT /api/settings': (q, b) => api.putSettings(b),
  'POST /api/article/new': (q, b) => api.postArticleNew(b),
  'POST /api/article/rename': (q, b) => api.postArticleRename(b),
  'POST /api/article/move': (q, b) => api.postArticleMove(b),
  'POST /api/article/delete': (q, b) => api.postArticleDelete(b),
  'POST /api/archive': (q, b) => api.postArchive(b),
  'POST /api/archive/rebuild': (q, b) => api.postArchiveRebuild(b),
  'POST /api/archive/rollback': (q, b) => api.postArchiveRollback(b),
  'POST /api/unarchive': (q, b) => api.postUnarchive(b),
  'POST /api/queue': (q, b) => api.postQueuePreview(b),
  'POST /api/publish-drop': (q, b) => api.postPublishDrop(b),
  'POST /api/preview': (q, b) => api.postPreview(b),
};

/* ── 静态资源类型 ── */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('请求体太大（>64MB）'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error('请求体不是合法 JSON：' + e.message), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/* ── 静态文件 ── */

const STATIC_ROOTS = [webDir, siteRoot];

/**
 * 解析静态路径：先 console/web/，再站点根。
 * 越界判断用「解析后的文本路径是否以根目录为前缀」，
 * 而不是把 `..` 归一后再说 —— `/%2e%2e/sk.json` 解码后是 `/../sk.json`，
 * path.resolve 会老实爬到上级目录，必须在这里挡住。
 */
function resolveStatic(urlPath) {
  const rel = String(urlPath).replace(/^[/\\]+/, '');
  for (const root of STATIC_ROOTS) {
    const cand = path.resolve(root, rel);
    const r = path.resolve(root);
    if (cand !== r && !cand.startsWith(r + path.sep)) continue;   /* 爬到根外面了 */
    if (isFile(cand)) return { file: cand, root };
  }
  return null;
}

/**
 * 带 Range 的文件流（音频/视频拖动进度要用）。
 * 浏览器原生 <audio> 就是靠这个 seek 的 —— 所以控制台不需要任何音频 API。
 */
function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

/* ── 请求分发 ── */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    sendJson(res, 400, { error: 'URL 不合法' });
    return;
  }

  const urlPath = decodeURIComponent(url.pathname);
  const query = Object.fromEntries(url.searchParams.entries());

  if (urlPath.startsWith('/api/')) {
    const key = `${req.method} ${urlPath}`;
    const handler = ROUTES[key];
    if (!handler) {
      sendJson(res, 404, { error: '没有这个接口：' + key });
      return;
    }
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const result = await handler(query, body);
      sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      if (status >= 500) console.error('[api]', key, '-', e && e.stack ? e.stack : e);
      sendJson(res, status, {
        error: String(e && e.message ? e.message : e),
        backup: e && e.backup ? path.basename(e.backup) : undefined,
      });
    }
    return;
  }

  /* 静态 */
  let p = urlPath === '/' ? '/index.html' : urlPath;
  if (p.endsWith('/')) p += 'index.html';

  const hit = resolveStatic(p);
  if (!hit) {
    /* 单页应用：认不出的路径回控制台首页，让前端自己按 hash 路由 */
    if (!path.extname(p)) {
      const home = path.join(webDir, 'index.html');
      if (isFile(home)) { sendFile(req, res, home); return; }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + p);
    return;
  }
  sendFile(req, res, hit.file);
});

server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    /* main() 起服务前已经探过一次「对面是不是我们自己的控制台」，
       能走到这里说明占端口的确实是别的程序 —— 别把锅甩给上一次的控制台。 */
    const ours = await consoleAlreadyRunning(PORT);
    console.error('');
    if (ours) {
      console.error(`  端口 ${PORT} 上是另一个控制台实例（可能是刚才那个窗口还开着）。`);
      console.error(`  直接用这个地址就行： http://${HOST}:${PORT}/`);
      console.error(`  想开第二个： 控制台.cmd --port ${PORT + 1}`);
    } else {
      console.error(`  端口 ${PORT} 被别的程序占着（不是控制台）。`);
      console.error(`  换个端口： 控制台.cmd --port ${PORT + 1}`);
    }
    console.error('');
    process.exit(2);
  }
  console.error('\n控制台起不来：' + e.message + '\n');
  process.exit(2);
});

/**
 * 启动监听。测试会 import 这个模块，先用 DSH_CONSOLE_ROOT 指到临时站点，
 * 再在临时端口上 listen —— 所以这里只是函数，不在模块顶层自动监听。
 */
export function listen(port = PORT, host = HOST, { open = OPEN, quiet = false } = {}) {
  server.listen(port, host, () => {
    const link = `http://${host}:${port}/`;
    if (!quiet) {
      console.log('');
      console.log('  发布控制台已启动');
      console.log('  ' + link);
      console.log('');
      console.log('  工作空间  ' + workspaceRoot);
      console.log('  站点      ' + siteRoot);
      console.log('  控制台    ' + consoleDir + '   （不会进 dist，也不会被上传）');
      console.log('');
      console.log('  按 Ctrl+C 停掉。');
      console.log('');
    }

    if (open) openBrowser(link);
  });
  return server;
}

/* 供测试直接 import：拿到 server 与 listen，自己决定端口和时机 */
export { server, PORT, HOST };

/* 直接 `node console/server.mjs` 跑才自动监听并接管 Ctrl+C；被 import 时不动作 */
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ── 起服务前的自检：同一个端口上是不是已经有一个控制台在跑 ── */

/** 用页面里那个标题确认「对面是我们自己的控制台」，不是别的程序 */
async function consoleAlreadyRunning(port) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    const res = await fetch(`http://${HOST}:${port}/`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const html = await res.text();
    return /<title>发布控制台/.test(html) || /id="nav"/.test(html);
  } catch {
    return false;
  }
}

/** 只是把浏览器叫起来，不等待、不读它的输出 */
function openBrowser(link) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', link], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [link], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [link], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* 打不开就算了，地址已经打在屏幕上了 */ }
}

/**
 * 命令行入口。
 * ---------------------------------------------------
 * 双击 .cmd 起服务时最容易撞的两种情况都在这儿兜住：
 *   1. 端口被上一次开着的控制台占着 → 直接把浏览器指过去，不再甩错误；
 *   2. 端口被别的程序占着 → 说清楚是谁，并给一条换端口的命令。
 */
async function main() {
  const link = `http://${HOST}:${PORT}/`;

  if (await consoleAlreadyRunning(PORT)) {
    console.log('');
    console.log(`  控制台已经开着了：${link}`);
    console.log('  （上一次的窗口应该还在。要用新端口：控制台.cmd --port ' + (PORT + 1) + '）');
    console.log('');
    if (OPEN) openBrowser(link);
    return;
  }

  listen(PORT, HOST, { open: OPEN });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('\n  控制台已停止。\n');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500);
    });
  }
}

if (isMain) main();



