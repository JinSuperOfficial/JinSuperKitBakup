/**
 * 预览服务：把站点根按静态站点供出来，给「预览」面板和 headless 用
 * ---------------------------------------------------
 * 和控制台自己不是一回事：
 *   · 控制台服务（8791）同时挂 console/web/ 和站点根，`/index.html` 会被
 *     控制台自己的页面顶掉 —— 拿来预览站点是不准的。
 *   · 预览服务（默认 8790）**只**服务站点根 `jinsuper.rth1.xyz/`，
 *     路径和线上一致：/p/docs.html、/Skills/index.html、/811/…
 *
 * 两处和线上对齐的细节：
 *   · `/p/raw.php?f=…` 照 build/.serve.mjs 的语义模拟（线上是云函数），
 *     这样文档站在预览里也能拿到 Markdown 真原文；
 *   · `/__preview.json` 是本服务自己的名片，用来认「端口上是不是我们」。
 *
 * 跑法：
 *   node console/server.mjs server [--port 8790]     headless（也可以 ./控制台.sh server）
 *   控制台界面里点「Server On」
 */
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_SETTINGS, isDir, siteRoot } from './paths.mjs';
import { resolveStatic, sendFile, sendJson } from './http-static.mjs';

export const APP_ID = 'jinsuper-preview';
export const DEFAULT_PORT = DEFAULT_SETTINGS.previewPort;
const HOST = '127.0.0.1';

/** 当前跑着的那个（一个进程只开一个预览服务） */
let current = null;

export function previewStatus() {
  if (!current) {
    return { running: false, port: DEFAULT_PORT, url: null, root: siteRoot, app: APP_ID };
  }
  return {
    running: true,
    app: APP_ID,
    port: current.port,
    host: current.host,
    url: `http://${current.host}:${current.port}/`,
    root: siteRoot,
    startedAt: current.startedAt,
  };
}

/* ── 请求处理 ── */

function handle(req, res, ctx) {
  let url;
  try {
    url = new URL(req.url, `http://${ctx.host}:${ctx.port}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('URL 不合法');
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    urlPath = url.pathname;
  }

  /* 名片：headless 起服务前用它确认「这个端口上是不是预览服务」 */
  if (urlPath === '/__preview.json') {
    sendJson(res, 200, previewStatus());
    return;
  }

  /* 模拟线上的 raw.php 云函数：?f=/p/xxx.md 读原文（同 build/.serve.mjs） */
  if (urlPath === '/p/raw.php') {
    const target = path.resolve(siteRoot, String(url.searchParams.get('f') || '').replace(/^[/\\]+/, ''));
    const inside = target === siteRoot || target.startsWith(siteRoot + path.sep);
    const hit = inside ? resolveStatic('/' + path.relative(siteRoot, target), [siteRoot]) : null;
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到文件');
      return;
    }
    sendFile(req, res, hit.file);
    return;
  }

  let p = urlPath === '/' ? '/index.html' : urlPath;
  if (p.endsWith('/')) p += 'index.html';

  const hit = resolveStatic(p, [siteRoot]);
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + p + '\n\n预览服务只服务站点根：' + siteRoot);
    return;
  }
  sendFile(req, res, hit.file);
}

/* ── 起 / 停 ── */

/**
 * 起预览服务。已经开在同一个端口上就直接返回现状；换了端口会先停旧的。
 * @returns {Promise<object>} previewStatus()
 */
export function startPreview({ port, host = HOST } = {}) {
  const want = Number(port) || DEFAULT_PORT;
  if (current && current.port === want && current.host === host) {
    return Promise.resolve(previewStatus());
  }

  const boot = () => new Promise((resolve, reject) => {
    if (!isDir(siteRoot)) {
      reject(Object.assign(new Error('站点根不是目录：' + siteRoot), { status: 500 }));
      return;
    }
    const ctx = { port: want, host };
    const server = http.createServer((req, res) => handle(req, res, ctx));

    const onError = (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(Object.assign(new Error(`端口 ${want} 被占用了（换个端口，或先关掉那边）`), { status: 409 }));
      } else if (e.code === 'EACCES') {
        reject(Object.assign(new Error(`没有权限监听 ${want}（1024 以下的端口通常要管理员）`), { status: 403 }));
      } else {
        reject(e);
      }
    };
    server.once('error', onError);
    server.listen(want, host, () => {
      server.removeListener('error', onError);
      /* 启动之后再出错误（连接层的）就只记一笔，别把控制台带崩 */
      server.on('error', (e) => console.error('[preview]', e && e.message ? e.message : e));
      current = { server, port: want, host, startedAt: Date.now() };
      resolve(previewStatus());
    });
  });

  return current ? stopPreview().then(boot) : boot();
}

/** 停预览服务；没开就返回现状（幂等，关页面时随便调） */
export function stopPreview() {
  if (!current) return Promise.resolve(previewStatus());
  const { server } = current;
  current = null;
  return new Promise((resolve) => {
    const done = () => resolve(previewStatus());
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close(done);
      /* 浏览器可能挂着 keep-alive，最多等半秒 */
      setTimeout(done, 500);
    } catch {
      done();
    }
  });
}

/**
 * 端口上是不是已经有一个预览服务（可能是另一个进程 / 控制台窗口）。
 * 用名片认，别把别人的服务当成自己的。
 */
export async function probePreview(port) {
  const p = Number(port) || DEFAULT_PORT;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    const res = await fetch(`http://${HOST}:${p}/__preview.json`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.app === APP_ID ? data : null;
  } catch {
    return null;
  }
}
