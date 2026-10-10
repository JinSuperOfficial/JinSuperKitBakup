/**
 * 发布控制台 · 本地 HTTP 服务
 * ---------------------------------------------------
 * 一个进程干两件事：
 *   /api/**   → 读写文章、归档、预渲染（见 lib/api.mjs）
 *   其余      → 静态资源：先找 console/web/，找不到再落到站点根（/p/docs-md.css、
 *               /p/fonts/*、/class/data/** 这些预览与试听用的文件）
 *
 * 安全与约束：
 *   · 只监听 127.0.0.1 —— 这是本机工具，不是网站，不对外。
 *   · 静态路径先 realpath 再校验必须落在允许的根里，挡住 `../` 穿越。
 *   · 不用任何外部依赖，也不 spawn 子进程（这个环境里管道受限）。
 *
 * 跑法：node console/server.mjs [--port 8791] [--no-open]
 *   或者直接双击项目根的 控制台.cmd / 跑 ./控制台.sh
 *
 * headless 预览服务（只供站点根，不要界面）：
 *   node console/server.mjs server [--port 8790] [--no-open]
 *   即 ./控制台.sh server
 */
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { consoleDir, isFile, siteRoot, webDir, workspaceRoot } from './lib/paths.mjs';
import { resolveStatic as resolveStaticIn, sendFile, sendJson } from './lib/http-static.mjs';
import { mermaidClientFile } from './lib/md-extras.mjs';
import * as api from './lib/api.mjs';
import * as preview from './lib/preview.mjs';

/* ── 参数 ── */
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.CONSOLE_PORT || 8791));
const HOST = '127.0.0.1';
const OPEN = !argv.includes('--no-open');
/* 不带子命令就是控制台本体；`server` 是 headless 的预览服务 */
const COMMAND = argv[0] && !argv[0].startsWith('-') ? argv[0] : '';

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
  'POST /api/archive/reshell': (q, b) => api.postArchiveReshell(b),
  'POST /api/archive/rollback': (q, b) => api.postArchiveRollback(b),
  'POST /api/unarchive': (q, b) => api.postUnarchive(b),
  'POST /api/queue': (q, b) => api.postQueuePreview(b),
  'POST /api/publish-drop': (q, b) => api.postPublishDrop(b),
  'POST /api/preview': (q, b) => api.postPreview(b),
  /* 预览面板：页面树 + 预览服务（起/停/看状态） */
  'GET /api/pages': (q) => api.getPages(q),
  'GET /api/preview/status': () => api.getPreviewStatus(),
  'POST /api/preview/start': (q, b) => api.postPreviewStart(b),
  'POST /api/preview/stop': () => api.postPreviewStop(),
};

/* ── 静态资源类型 ──
   MIME 表 / 越界判断 / Range 流都在 lib/http-static.mjs：
   预览服务（另一个端口）用的是同一套，不重复实现。 */

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
 * 越界判断和 Range 流在 lib/http-static.mjs（预览服务共用同一份）。
 */
function resolveStatic(urlPath) {
  return resolveStaticIn(urlPath, STATIC_ROOTS);
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

  /* 预览里的第三方运行时：mermaid 的浏览器包。
     它是 build/node_modules 里的本地文件（不走任何 CDN），装了就有；
     没装就 404 加一句人话 —— 前端据此在预览里给提示，不静默少东西。 */
  if (urlPath === '/vendor/mermaid.min.js') {
    const f = mermaidClientFile();
    if (f) { sendFile(req, res, f); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('没装 mermaid（预览里 mermaid 围栏不会渲染）。\n在 build/ 里跑：npm i mermaid\n');
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
      const pv = preview.previewStatus();
      if (pv.running) console.log('  预览服务  ' + pv.url + '   （只服务站点根）');
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

/**
 * `node console/server.mjs server` —— headless 预览服务
 * ---------------------------------------------------
 * 只要一个「把站点根按线上路径供出来」的静态服务，不要控制台界面。
 * 给脚本、别的机器、或者单纯想省一个窗口的时候用：
 *   ./控制台.sh server              默认端口（设置里的 previewPort，8790）
 *   ./控制台.sh server --port 8793  换端口
 *   ./控制台.sh server --no-open    不开浏览器
 *
 * 端口上已经有一个预览服务（可能是控制台窗口里点的那个）就不重复起，
 * 直接把地址指过去 —— 和 main() 处理控制台端口占用是同一个思路。
 */
async function serverMain() {
  const port = Number(argOf('--port', process.env.PREVIEW_PORT || preview.DEFAULT_PORT));

  const already = await preview.probePreview(port);
  if (already) {
    console.log('');
    console.log(`  预览服务已经开着了：${already.url}`);
    console.log('  （可能是控制台窗口里点开的。要另起一个：./控制台.sh server --port ' + (port + 1) + '）');
    console.log('');
    if (OPEN) openBrowser(already.url);
    return;
  }

  let st;
  try {
    st = await preview.startPreview({ port });
  } catch (e) {
    console.error('\n  预览服务起不来：' + (e && e.message ? e.message : e));
    console.error('  换个端口：./控制台.sh server --port ' + (port + 1) + '\n');
    process.exit(2);
  }

  console.log('');
  console.log('  预览服务已启动（headless，只服务站点根）');
  console.log('  ' + st.url);
  console.log('');
  console.log('  站点根    ' + st.root);
  console.log('  页面清单  ' + st.url + 'index.html   （控制台「预览」面板里那份树）');
  console.log('');
  console.log('  按 Ctrl+C 停掉。');
  console.log('');

  if (OPEN) openBrowser(st.url);

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log('\n  预览服务已停止。\n');
      preview.stopPreview().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 600);
    });
  }
}

if (isMain) {
  if (COMMAND === 'server') serverMain();
  else main();
}



