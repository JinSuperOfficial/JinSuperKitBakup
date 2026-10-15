'use strict';
/**
 * src/main.js —— JinSuper 百宝箱 桌面版主进程
 * ---------------------------------------------------------------
 * 窗口结构（一个窗口里两个 WebContentsView，谁都不注入 DOM）：
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ topbarView   46px  ← 统一 topbar（我们自己的页面）│
 *   ├──────────────────────────────────────────────┤
 *   │ pageView          ← 站点本身（云端 / 内置离线副本）│
 *   │ panelView（可选）  ← 设置面板，叠在页面之上        │
 *   └──────────────────────────────────────────────┘
 *
 * 为什么用 WebContentsView 而不是往网页里注入 topbar：
 *   · 站点有几十个页面、各有各的 CSS，注入就得跟它们抢布局；分层则是两套完全独立的文档，
 *     一个像素都不会互相影响；
 *   · 换页、跨域跳转时 topbar 不重建，所以「每个页面都有退出按钮」是结构性成立的，
 *     而不是每个页面各写一遍；
 *   · 网页源码一行都不用改（符合仓库「加东西不要改 HTML」的约定）。
 *
 * 来源与回落见 src/origins.js：默认主站 www.jinsuper.cn，连不上依次退到
 * 热铁盒 / GitHub Pages，最后是随包内置的离线副本。
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BaseWindow, WebContentsView, ipcMain, shell, Menu, screen, dialog, nativeTheme } = require('electron');

const { ORIGINS, NAV, DEFAULT_ORIGIN, getOrigin, buildChain } = require('./origins');
const store = require('./settings-store');
const localServer = require('./local-server');
const { modeFromArgv, getMode } = require('./modes');
const { createHwkStore } = require('./hwk-store');
const { createSyncService } = require('./sync');

const APP_TITLE = 'JinSuper 百宝箱';
const BAR_H = 46;
const UI_DIR = path.join(__dirname, 'ui');
/* 打包之后 __dirname 在 app.asar 里（只读），冒烟截图与临时设置得挪到可写的地方 */
const SMOKE_DIR = app.isPackaged
  ? path.join(app.getPath('temp'), 'jinsuper-desktop-smoke')
  : path.join(__dirname, '..', '.smoke');
const IS_SMOKE = process.argv.includes('--smoke');
/* 冒烟**默认不开窗**：跑测试的时候不要在别人屏幕上闪一个窗口出来。
   代价是截不了图（这个环境里隐藏窗口 capturePage 会报
   "Current display surface not available"），所以截图那几步自动跳过。
   要看窗口和截图：`npm run smoke:show`（= --smoke --show）。
   窗口本身永远是暗色的：原生主题钉成 dark（见 whenReady）。 */
const SHOW_WINDOWS = !IS_SMOKE || process.argv.includes('--show');
const IS_DEV = !app.isPackaged;
const LOAD_TIMEOUT = 15000;
/* 这次开哪个窗口：班级百宝箱（浏览）还是作业编辑器（--app=homework）。
   两个快捷方式指向同一个 exe，差别就在这一个参数上（见 src/modes.js）。 */
const APP_MODE = IS_SMOKE ? 'browse' : modeFromArgv(process.argv);

/** `--origin=<id>`：这一次运行先用哪个来源（不落盘，给冒烟测试和排障用） */
const ARG_ORIGIN = (() => {
  const hit = process.argv.find((a) => a.startsWith('--origin='));
  const id = hit ? hit.slice('--origin='.length) : '';
  return ORIGINS.some((o) => o.id === id) ? id : null;
})();

/* 对 Cloudflare 之类的网关来说，带 Electron 字样的 UA 更容易被拦；
   站点自己的广告/统计脚本也更愿意相信一个普通 Chrome。 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/* 冒烟测试不碰用户真正的设置：窗口位置、缩放的读写都落在 .smoke/ 里 */
if (IS_SMOKE) app.setPath('userData', path.join(SMOKE_DIR, 'userdata'));

/** @type {BaseWindow|null} */ let win = null;
/** @type {WebContentsView|null} */ let topbarView = null;
/** @type {WebContentsView|null} */ let pageView = null;
/** @type {WebContentsView|null} */ let panelView = null;

let settings = null;
let currentOriginId = DEFAULT_ORIGIN;
let chain = [];
let intendedPath = '/';
let mode = 'cloud'; // cloud | local | error
let lastError = null;
let watchdog = null;
let saveBoundsTimer = null;

/* ─────────────────────────── 小工具 ─────────────────────────── */

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.pathname : '';
  } catch {
    return '';
  }
}

function baseOf(id) {
  if (id === 'local') return localServer.url();
  return getOrigin(id).url;
}

function targetUrl(id, p) {
  const base = baseOf(id);
  if (!base) return null;
  try {
    return new URL(p || '/', base.replace(/\/+$/, '') + '/').toString();
  } catch {
    return null;
  }
}

function history() {
  const wc = pageView?.webContents;
  if (!wc) return { back: false, forward: false };
  const h = wc.navigationHistory;
  if (h && typeof h.canGoBack === 'function') {
    return { back: h.canGoBack(), forward: h.canGoForward() };
  }
  return { back: !!wc.canGoBack?.(), forward: !!wc.canGoForward?.() };
}

function publicState() {
  const wc = pageView?.webContents;
  const h = history();
  return {
    appTitle: APP_TITLE,
    version: app.getVersion(),
    url: wc && !wc.isDestroyed() ? wc.getURL() : '',
    path: wc && !wc.isDestroyed() ? pathOf(wc.getURL()) : '',
    title: wc && !wc.isDestroyed() ? wc.getTitle() : '',
    loading: !!(wc && !wc.isDestroyed() && wc.isLoading()),
    canGoBack: h.back,
    canGoForward: h.forward,
    maximized: !!(win && win.isMaximized()),
    fullscreen: !!(win && win.isFullScreen()),
    panelOpen: !!panelView,
    originId: currentOriginId,
    originLabel: getOrigin(currentOriginId).label,
    isLocal: currentOriginId === 'local',
    mode,
    error: lastError,
    nav: NAV,
    origins: ORIGINS.map((o) => ({ id: o.id, label: o.label, host: o.host, desc: o.desc, url: o.url })),
    settings: { ...settings },
    dev: IS_DEV,
  };
}

function pushState() {
  if (!win) return;
  const state = publicState();
  for (const v of [topbarView, panelView]) {
    if (v && v.webContents && !v.webContents.isDestroyed()) {
      v.webContents.send('app:state', state);
    }
  }
}

/* ─────────────────────── 加载 / 回落链 ─────────────────────── */

function clearWatchdog() {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

function armWatchdog() {
  clearWatchdog();
  watchdog = setTimeout(() => {
    watchdog = null;
    const wc = pageView?.webContents;
    if (wc && !wc.isDestroyed() && wc.isLoading()) {
      onLoadFailed(-7, 'TIMED_OUT', wc.getURL() || '', true);
    }
  }, LOAD_TIMEOUT);
}

function loadUrl(url) {
  armWatchdog();
  pageView.webContents.loadURL(url).catch(() => {
    /* 失败会走 did-fail-load，这里吞掉 Promise 拒绝 */
  });
}

/** 从某个来源开始打开首页（会按设置依次回落） */
function openOrigin(startId) {
  intendedPath = '/';
  chain = buildChain(settings, startId);
  lastError = null;
  nextInChain();
}

function nextInChain() {
  const id = chain.shift();
  if (!id) {
    showOfflinePage();
    return;
  }
  const go = (base) => {
    currentOriginId = id;
    const url = targetUrl(id, intendedPath);
    pushState();
    if (url) loadUrl(url);
    else nextInChain();
  };
  if (id === 'local') {
    localServer
      .ensure()
      .then(() => go())
      .catch((err) => {
        lastError = { code: 0, desc: `内置离线副本打不开：${err.message}`, url: '' };
        nextInChain();
      });
    return;
  }
  currentOriginId = id;
  go();
}

function onLoadFailed(code, desc, url, isMainFrame) {
  if (!isMainFrame) return;
  if (code === -3) return; // ERR_ABORTED：是我们自己导航走了，不算失败
  clearWatchdog();
  lastError = { code, desc, url };
  if (IS_DEV) console.log(`[nav] 打不开（${code} ${desc}）：${url}${chain.length ? ' → 换下一个来源' : ''}`);
  const failedPath = pathOf(url);
  if (failedPath) intendedPath = failedPath;

  if (chain.length) {
    nextInChain();
    return;
  }
  // 链走完了还没成：云端全都打不开时，最后退到内置离线副本
  if (currentOriginId !== 'local' && settings.offlineFallback) {
    chain = ['local'];
    nextInChain();
    return;
  }
  showOfflinePage();
}

function showOfflinePage() {
  mode = 'error';
  pushState();
  const query = {
    desc: lastError?.desc || '打不开',
    code: String(lastError?.code ?? ''),
    url: lastError?.url || '',
  };
  pageView.webContents
    .loadFile(path.join(UI_DIR, 'error', 'index.html'), { query })
    .catch(() => {});
}

/* ─────────────────────────── 视图 ─────────────────────────── */

function makeView(preload, extra) {
  return new WebContentsView({
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      ...(extra || {}),
    },
  });
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const pageH = Math.max(1, h - BAR_H);
  topbarView?.setBounds({ x: 0, y: 0, width: w, height: BAR_H });
  pageView?.setBounds({ x: 0, y: BAR_H, width: w, height: pageH });
  panelView?.setBounds({ x: 0, y: BAR_H, width: w, height: pageH });
}

function onScreen(x, y) {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return x >= b.x - 32 && y >= b.y - 32 && x < b.x + b.width - 32 && y < b.y + b.height - 32;
  });
}

function saveBounds() {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const maximized = win.isMaximized();
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  settings = store.save({
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized },
  });
}

function createWindow() {
  const b = settings.bounds || {};
  const opts = {
    width: b.width || 1180,
    height: b.height || 800,
    minWidth: 420,
    minHeight: 360,
    frame: false,
    show: false,
    backgroundColor: '#14120E',
    title: APP_TITLE,
    autoHideMenuBar: true,
  };
  if (Number.isFinite(b.x) && Number.isFinite(b.y) && onScreen(b.x, b.y)) {
    opts.x = b.x;
    opts.y = b.y;
  }
  win = new BaseWindow(opts);
  if (b.maximized) win.maximize();

  topbarView = makeView(path.join(UI_DIR, 'preload.js'));
  pageView = makeView(path.join(UI_DIR, 'page-preload.js'), { backgroundThrottling: false });
  win.contentView.addChildView(topbarView);
  win.contentView.addChildView(pageView);

  const paint = (v, color) => {
    if (v && typeof v.setBackgroundColor === 'function') v.setBackgroundColor(color);
  };
  paint(topbarView, '#14120E');
  paint(pageView, '#14120E');

  const wc = pageView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    openSmart(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!/^(https?|file):/i.test(url)) {
      event.preventDefault();
      openSmart(url);
    }
  });
  wc.on('did-start-loading', pushState);
  wc.on('did-stop-loading', pushState);
  wc.on('did-navigate', () => {
    applyZoom();
    pushState();
  });
  wc.on('did-navigate-in-page', pushState);
  wc.on('page-title-updated', pushState);
  wc.on('did-finish-load', () => {
    clearWatchdog();
    const url = wc.getURL();
    if (url.startsWith('http')) {
      mode = currentOriginId === 'local' ? 'local' : 'cloud';
      chain = [];
      lastError = null;
      applyZoom();
    }
    pushState();
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => onLoadFailed(code, desc, url, isMainFrame));
  wc.on('render-process-gone', (_e, details) => {
    lastError = { code: 0, desc: `页面进程挂了（${details.reason}）`, url: wc.getURL() };
    showOfflinePage();
  });
  wc.on('enter-html-full-screen', () => win.setFullScreen(true));
  wc.on('leave-html-full-screen', () => win.setFullScreen(false));
  wc.on('before-input-event', onKey);

  topbarView.webContents.once('did-finish-load', () => {
    layout();
    if (SHOW_WINDOWS) win.show();
    openOrigin(ARG_ORIGIN || settings.originId);
    pushState();
  });
  topbarView.webContents.on('did-finish-load', pushState);
  topbarView.webContents
    .loadFile(path.join(UI_DIR, 'topbar', 'index.html'))
    .catch((err) => console.error('[topbar] 加载失败：', err && err.message));

  win.on('resize', () => {
    layout();
    pushState();
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(saveBounds, 400);
  });
  win.on('move', () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(saveBounds, 400);
  });
  win.on('maximize', pushState);
  win.on('unmaximize', pushState);
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', () => {
    layout();
    pushState();
  });
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') goBack();
    if (cmd === 'browser-forward') goForward();
  });
  win.on('close', () => {
    saveBounds();
    clearWatchdog();
  });
  win.on('closed', () => {
    win = null;
    topbarView = null;
    pageView = null;
    panelView = null;
  });

  layout();
}

/** 站点自己的链接留在窗口里（topbar 不会消失），别人的链接交给系统浏览器 */
function openSmart(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const known = [...ORIGINS.map((o) => o.host), '127.0.0.1', 'localhost'];
  let here = '';
  try {
    here = new URL(pageView?.webContents.getURL() || '').hostname;
  } catch {
    here = '';
  }
  if (/^https?:/i.test(url) && (known.includes(host) || host === here)) {
    loadUrl(url);
    return;
  }
  if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {});
}

/* ═══════════════════════════════════════════════════
   作业编辑器（第二种模式）与跨网同步
   ---------------------------------------------------
   两个快捷方式 = 同一个 exe 的两种模式（src/modes.js）：
     · 班级百宝箱：原来的窗口（topbar + 站点 + 设置面板）
     · 作业编辑器：一个独立小窗口，界面全在 src/ui/hwk/ 里，**不加载站点**，
       所以在完全断网的学校机器上也能录作业
   单实例锁保留：两个快捷方式点开的是同一个进程里的两个窗口，设置文件
   只有一个写者，不会互相覆盖。
   ═══════════════════════════════════════════════════ */

/** @type {BaseWindow|null} */ let hwkWin = null;
/** @type {WebContentsView|null} */ let hwkView = null;
/** @type {ReturnType<typeof createHwkStore>|null} */ let hwkStore = null;
/** @type {ReturnType<typeof createSyncService>|null} */ let syncService = null;

/** 本机服务（作业存储 + 同步）—— 只建一次 */
function initServices() {
  if (!hwkStore) {
    hwkStore = createHwkStore({
      dir: path.join(app.getPath('userData'), 'hwk'),
      baselineDir: path.join(localServer.siteRoot(), 'class', 'data', 'hwk'),
      outboxDir: path.join(app.getPath('userData'), 'sync', 'outbox'),
    });
  }
  if (!syncService) {
    syncService = createSyncService({
      userDataDir: app.getPath('userData'),
      siteRoot: () => localServer.siteRoot(),
      projectRoot: path.resolve(__dirname, '..', '..'),
      log: (m) => console.log('[sync]', m),
    });
  }
  return { hwkStore, syncService };
}

function hwkLayout() {
  if (!hwkWin || hwkWin.isDestroyed() || !hwkView) return;
  const [w, h] = hwkWin.getContentSize();
  hwkView.setBounds({ x: 0, y: 0, width: w, height: h });
}

/** 作业编辑器窗口：一个视图铺满，没有 topbar（它不浏览网页） */
function createHomeworkWindow() {
  if (hwkWin && !hwkWin.isDestroyed()) {
    if (hwkWin.isMinimized()) hwkWin.restore();
    hwkWin.focus();
    return hwkWin;
  }
  const meta = getMode('homework');
  initServices();
  hwkStore.seed().catch((e) => console.error('[hwk] 导入基线失败：', e && e.message));

  hwkWin = new BaseWindow({
    width: meta.width,
    height: meta.height,
    minWidth: 420,
    minHeight: 420,
    frame: false,
    show: false,
    backgroundColor: '#14120E',
    title: meta.title,
    autoHideMenuBar: true,
  });
  hwkView = makeView(path.join(UI_DIR, 'hwk-preload.js'));
  hwkWin.contentView.addChildView(hwkView);
  if (typeof hwkView.setBackgroundColor === 'function') hwkView.setBackgroundColor('#14120E');

  const wc = hwkView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (mod && input.key === 'q') { event.preventDefault(); app.quit(); }
    if (input.key === 'Escape') { event.preventDefault(); hwkWin.close(); }
    if (input.key === 'F12') { event.preventDefault(); wc.toggleDevTools(); }
  });
  hwkWin.on('resize', hwkLayout);
  hwkWin.on('closed', () => {
    hwkWin = null;
    hwkView = null;
  });
  hwkLayout();
  wc.loadFile(path.join(UI_DIR, 'hwk', 'index.html')).catch((err) => {
    console.error('[hwk] 界面加载失败：', err && err.message);
  });
  wc.once('did-finish-load', () => {
    if (SHOW_WINDOWS) hwkWin.show();
  });
  return hwkWin;
}

/** 按模式开窗（第二个实例的请求也走这里） */
function openModeWindow(modeId) {
  if (modeId === 'homework') return createHomeworkWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return win;
  }
  return createWindow();
}

async function handleHwkAction(action, payload) {
  const { hwkStore: st, syncService: sy } = initServices();
  switch (action) {
    case 'list':
      return st.list();
    case 'read':
      return st.read(payload && payload.id);
    case 'save': {
      const saved = await st.save(payload && payload.input);
      return { ...saved, state: await st.list() };
    }
    case 'snapshot': {
      const snap = await st.snapshot();
      return { ...snap, state: await st.list() };
    }
    case 'sync': {
      /* 「先同步到本地」→ 再上传：本地快照先落盘，上传失败也不丢 */
      const snap = await st.snapshot();
      if (!snap.files.length) return { ok: false, reason: '本机还没有作业内容' };
      try {
        const res = await sy.upload({ root: 'hwk', files: [snap.dir] });
        st.markSynced(res.stamp);
        return { ok: true, uploaded: res, state: await st.list() };
      } catch (e) {
        const queued = sy.enqueue({ root: 'hwk', files: [snap.dir] });
        return { ok: false, queued, error: String(e && e.message ? e.message : e), state: await st.list() };
      }
    }
    case 'flush': {
      try {
        const done = await sy.flushQueue();
        if (done.length) st.markSynced(done[done.length - 1].stamp);
        return { ok: true, done, state: await st.list() };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e), state: await st.list() };
      }
    }
    case 'syncState':
      return sy.state();
    case 'openDataDir':
      shell.openPath(st.dir).catch(() => {});
      return { ok: true, dir: st.dir };
    case 'close':
      if (hwkWin) hwkWin.close();
      return { ok: true };
    default:
      return { ok: false, error: '未知操作：' + action };
  }
}

/** 设置面板里的「云端同步」用这些（浏览窗口那一侧）。
    动作名一律带 sync 前缀，IPC 那边一眼能分出来。 */
async function handleSyncAction(action, payload) {
  const { syncService: sy } = initServices();
  switch (action) {
    case 'syncState':
      return sy.state();
    case 'syncUpdateSite': {
      try {
        const res = await sy.updateSite({ onProgress: (p) => sendSyncProgress(p) });
        if (res.ok) {
          /* 离线副本换了 → 让站点页面重新加载，看到的立刻是新版 */
          try {
            if (currentOriginId === 'local') openOrigin('local');
          } catch { /* 没在离线副本上就算了 */ }
        }
        return { ...res, state: await sy.state() };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e), state: await sy.state() };
      }
    }
    case 'syncFlush':
      try {
        const done = await sy.flushQueue({ onProgress: (p) => sendSyncProgress(p) });
        return { ok: true, done, state: await sy.state() };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e), state: await sy.state() };
      }
    case 'syncUpload': {
      const root = payload && payload.root === 'hwk' ? 'hwk' : (payload && payload.root === 'site' ? 'site' : 'misc');
      const picked = await dialog.showOpenDialog(win || hwkWin, {
        title: '选择要传到云端收件箱的文件',
        buttonLabel: '上传',
        properties: ['openFile', 'multiSelections'],
      });
      if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
      return uploadToInbox(root, picked.filePaths);
    }
    case 'syncUploadPaths': {
      const root = payload && payload.root ? payload.root : 'misc';
      return uploadToInbox(root, (payload && payload.files) || []);
    }
    case 'syncSaveSettings': {
      const saved = sy.settings.save(payload || {});
      return { ok: true, settings: saved, state: await sy.state() };
    }
    case 'syncOpenFolder':
      shell.openPath(sy.offlineDir).catch(() => {});
      return { ok: true, dir: sy.offlineDir };
    case 'openUrl': {
      const url = String((payload && payload.url) || '');
      /* 只放行备案办理的官方入口 —— 别让界面变成随便开网页的后门 */
      if (/^https:\/\/([a-z0-9-]+\.)*(miit\.gov\.cn|beian\.miit\.gov\.cn)\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
        return { ok: true };
      }
      return { ok: false, error: '只允许打开备案官方站点' };
    }
    default:
      return { ok: false, error: '未知操作：' + action };
  }
}

async function uploadToInbox(root, files) {
  const { syncService: sy } = initServices();
  try {
    const res = await sy.upload({ root, files, onProgress: (p) => sendSyncProgress(p) });
    return { ok: true, uploaded: res, state: await sy.state() };
  } catch (e) {
    const queued = (() => {
      try {
        return sy.enqueue({ root, files });
      } catch {
        return null;
      }
    })();
    return { ok: false, queued, error: String(e && e.message ? e.message : e), state: await sy.state() };
  }
}

function sendSyncProgress(p) {
  try {
    panelView?.webContents.send('sync:progress', p);
  } catch {
    /* 面板已经关了 */
  }
}

/* ─────────────────────────── 操作 ─────────────────────────── */

function applyZoom() {
  const wc = pageView?.webContents;
  if (wc && !wc.isDestroyed()) {
    try {
      wc.setZoomFactor(settings.zoom);
    } catch {
      /* 个别页面还没准备好，忽略 */
    }
  }
}

function setZoom(next) {
  settings = store.save({ zoom: Math.min(2.5, Math.max(0.6, Math.round(next * 100) / 100)) });
  applyZoom();
  pushState();
}

function goBack() {
  const wc = pageView?.webContents;
  if (!wc) return;
  const h = wc.navigationHistory;
  if (h && typeof h.goBack === 'function') {
    if (h.canGoBack()) h.goBack();
  } else if (wc.canGoBack?.()) {
    wc.goBack();
  }
}

function goForward() {
  const wc = pageView?.webContents;
  if (!wc) return;
  const h = wc.navigationHistory;
  if (h && typeof h.goForward === 'function') {
    if (h.canGoForward()) h.goForward();
  } else if (wc.canGoForward?.()) {
    wc.goForward();
  }
}

function openPanel() {
  if (panelView || !win) return;
  panelView = makeView(path.join(UI_DIR, 'preload.js'));
  if (typeof panelView.setBackgroundColor === 'function') panelView.setBackgroundColor('#00000000');
  win.contentView.addChildView(panelView);
  layout();
  panelView.webContents.once('did-finish-load', pushState);
  panelView.webContents.on('did-finish-load', pushState);
  panelView.webContents.loadFile(path.join(UI_DIR, 'settings', 'index.html')).catch(() => {});
}

function closePanel() {
  if (!panelView || !win) return;
  const v = panelView;
  panelView = null;
  try {
    win.contentView.removeChildView(v);
  } catch {
    /* 已经不在树上 */
  }
  try {
    v.webContents.close();
  } catch {
    /* Electron 版本差异：关不掉就算了，视图已经摘掉 */
  }
  if (win && !win.isDestroyed()) win.focus();
  pushState();
}

function quitApp() {
  saveBounds();
  app.quit();
}

function onKey(event, input) {
  if (input.type !== 'keyDown') return;
  const key = (input.key || '').toLowerCase();
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const stop = () => event.preventDefault();

  if (input.key === 'F12' || (mod && input.shift && key === 'i')) return stop(pageView.webContents.toggleDevTools());
  if (input.key === 'F11') return stop(toggleFullScreen());
  if (mod && input.shift && key === 'r') return stop(pageView.webContents.reloadIgnoringCache());
  if (input.key === 'F5' || (mod && key === 'r')) return stop(pageView.webContents.reload());
  if (mod && input.key === ',') return stop(openPanel());
  if (mod && (input.key === '=' || input.key === '+')) return stop(setZoom(settings.zoom + 0.1));
  if (mod && input.key === '-') return stop(setZoom(settings.zoom - 0.1));
  if (mod && input.key === '0') return stop(setZoom(1));
  if (input.alt && input.key === 'ArrowLeft') return stop(goBack());
  if (input.alt && input.key === 'ArrowRight') return stop(goForward());
  if (input.key === 'Escape' && panelView) return stop(closePanel());
  if (mod && key === 'q') return stop(quitApp());
}

function toggleFullScreen() {
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
}

async function handleAction(action, payload) {
  const wc = pageView?.webContents;
  switch (action) {
    case 'back':
      goBack();
      break;
    case 'forward':
      goForward();
      break;
    case 'reload':
      pendingReload();
      break;
    case 'hardReload':
      wc?.reloadIgnoringCache();
      break;
    case 'home':
      intendedPath = '/';
      chain = [];
      currentOriginId = currentOriginId || settings.originId;
      if (currentOriginId === 'local' && !localServer.url()) await localServer.ensure().catch(() => {});
      loadUrl(targetUrl(currentOriginId, '/'));
      break;
    case 'goto': {
      const item = NAV.find((n) => n.id === payload?.id);
      if (!item) break;
      if (currentOriginId === 'local' && !localServer.url()) await localServer.ensure().catch(() => {});
      intendedPath = item.path;
      chain = [];
      loadUrl(targetUrl(currentOriginId, item.path));
      break;
    }
    case 'retry':
      openOrigin(settings.originId);
      break;
    case 'openSettings':
      openPanel();
      break;
    case 'closeSettings':
      closePanel();
      break;
    case 'setOrigin': {
      const id = ORIGINS.some((o) => o.id === payload?.id) ? payload.id : DEFAULT_ORIGIN;
      settings = store.save({ originId: id });
      mode = id === 'local' ? 'local' : 'cloud';
      closePanel();
      openOrigin(id);
      break;
    }
    case 'setSetting': {
      const key = payload?.key;
      if (key === 'autoFallback' || key === 'offlineFallback') {
        settings = store.save({ [key]: !!payload.value });
      }
      pushState();
      break;
    }
    case 'reset':
      settings = store.reset();
      applyZoom();
      closePanel();
      openOrigin(settings.originId);
      break;
    case 'zoom':
      setZoom(payload?.value != null ? Number(payload.value) : settings.zoom + Number(payload?.delta || 0));
      break;
    case 'devtools':
      wc?.toggleDevTools();
      break;
    case 'minimize':
      win?.minimize();
      break;
    case 'maximize':
      if (!win) break;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      pushState();
      break;
    case 'closeWindow':
      quitApp();
      break;
    case 'quit':
      quitApp();
      break;
    default:
      break;
  }
  return publicState();
}

function pendingReload() {
  const wc = pageView?.webContents;
  if (!wc) return;
  if (wc.getURL().startsWith('file:')) openOrigin(settings.originId);
  else wc.reload();
}

/* ─────────────────────────── 冒烟 ─────────────────────────── */

function waitFor(event, wc, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wc.removeListener(event, on);
      resolve(false);
    }, ms);
    function on() {
      clearTimeout(timer);
      resolve(true);
    }
    wc.once(event, on);
  });
}

/** 等到这个 webContents 不再转圈（已经在加载就等 did-stop-loading，否则直接过） */
async function waitIdle(wc, ms) {
  const deadline = Date.now() + ms;
  while (wc.isLoading() && Date.now() < deadline) {
    await Promise.race([waitFor('did-stop-loading', wc, 1000), new Promise((r) => setTimeout(r, 250))]);
  }
  await new Promise((r) => setTimeout(r, 250));
}

/** 隐藏窗口下只提示一次「跳过截图」，别把冒烟日志刷成一堆失败 */
let shotNoticeShown = false;

async function shot(view, name) {
  if (!SHOW_WINDOWS) {
    if (!shotNoticeShown) {
      shotNoticeShown = true;
      console.log('[smoke] 窗口是隐藏的（不闪屏）——跳过所有截图；要看图跑 npm run smoke:show');
    }
    return;
  }
  try {
    const img = await view.webContents.capturePage();
    const file = path.join(SMOKE_DIR, name);
    fs.writeFileSync(file, img.toPNG());
    console.log(`[smoke] 截图 ${name}（${img.getSize().width}×${img.getSize().height}）`);
  } catch (err) {
    console.error(`[smoke] 截图 ${name} 失败：`, err.message);
  }
}

async function runSmoke() {
  fs.mkdirSync(SMOKE_DIR, { recursive: true });
  console.log('[smoke] 截图目录：', SMOKE_DIR);
  console.log('[smoke] 等待首页……');
  await waitIdle(pageView.webContents, 25000);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('[smoke] 首页加载完成');
  await shot(topbarView, '1-topbar.png');
  await shot(pageView, '2-page.png');
  console.log('[smoke] 状态：', JSON.stringify({
    url: pageView.webContents.getURL(),
    title: pageView.webContents.getTitle(),
    originId: currentOriginId,
    mode,
  }));
  openPanel();
  await waitIdle(panelView.webContents, 8000);
  await new Promise((r) => setTimeout(r, 1200));
  await shot(panelView, '3-settings.png');
  /* 滚到底再拍一张：设置面板下半部分是新加的「云端同步」（云端/本机版本、
     访问方式含备案那一项、令牌与仓库），不滚就看不到它到底画出来没有 */
  await panelView.webContents.executeJavaScript(
    "(function(){var el=document.getElementById('syncChannel');if(el&&el.scrollIntoView)el.scrollIntoView({block:'start'});"
    + "var b=document.querySelector('.pb');if(b)b.scrollTop=Math.max(0,b.scrollTop-56);return true;})()",
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await shot(panelView, '3b-settings-sync.png');
  await panelView.webContents.executeJavaScript(
    "(function(){var b=document.querySelector('.pb');if(b)b.scrollTop=b.scrollHeight;return true;})()",
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await shot(panelView, '3c-settings-beian.png');
  // 再走一趟「班级工具箱」，确认 topbar 换页正常
  await handleAction('goto', { id: 'class' });
  await waitIdle(pageView.webContents, 20000);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(pageView, '4-class.png');
  console.log('[smoke] 班级工具箱：', pageView.webContents.getURL());
  // 顺手看一眼新加的运动会赛程页
  loadUrl(targetUrl(currentOriginId, '/class/run.html'));
  await waitIdle(pageView.webContents, 20000);
  await new Promise((r) => setTimeout(r, 1200));
  await shot(pageView, '5-run.png');
  console.log('[smoke] 运动会赛程：', pageView.webContents.getURL(), '|', pageView.webContents.getTitle());

  // topbar 上的按钮真按一遍：上一页 / 缩放 / 最大化
  await handleAction('back');
  await waitIdle(pageView.webContents, 8000);
  console.log('[smoke] 上一页 →', pageView.webContents.getURL());
  await handleAction('zoom', { delta: 0.1 });
  console.log('[smoke] 缩放 →', publicState().settings.zoom);
  await handleAction('zoom', { value: 1 });
  await handleAction('maximize');
  await new Promise((r) => setTimeout(r, 400));
  console.log('[smoke] 最大化 →', publicState().maximized);
  await handleAction('maximize');
  await new Promise((r) => setTimeout(r, 600));
  console.log('[smoke] 还原 →', publicState().maximized);

  // 设置面板里换来源：切到离线副本，再切回主站
  // （local 的静态服务是懒启动的，导航不是同步开始，先让出一拍再等）
  await handleAction('setOrigin', { id: 'local' });
  await new Promise((r) => setTimeout(r, 600));
  await waitIdle(pageView.webContents, 15000);
  console.log('[smoke] 切到离线副本 →', publicState().originId, publicState().mode, pageView.webContents.getURL());
  await handleAction('setOrigin', { id: 'cn' });
  await new Promise((r) => setTimeout(r, 600));
  await waitIdle(pageView.webContents, 25000);
  console.log('[smoke] 切回主站 →', publicState().originId, publicState().mode, pageView.webContents.getURL());

  /* 顺带把「作业编辑器」那一半也走一遍：它是第二个快捷方式
     （同一个 exe 加 --app=homework），界面与本地存储都得能跑。 */
  createHomeworkWindow();
  await runHwkSmoke();

  console.log('[smoke] 完成');
  app.quit();
}

/** 冒烟：作业编辑器那一半（第二个快捷方式 = 同一个 exe 加 --app=homework） */
async function runHwkSmoke() {
  fs.mkdirSync(SMOKE_DIR, { recursive: true });
  console.log('[smoke] 作业编辑器：等界面……');
  await waitIdle(hwkView.webContents, 20000);
  await new Promise((r) => setTimeout(r, 900));
  await shot(hwkView, '6-hwk.png');
  /* 真写一天进去，看本机文件是不是按同一套规则落下来了 */
  const written = await hwkView.webContents.executeJavaScript(`(function () {
    var d = document.getElementById('date');
    d.value = '2026-10-15'; d.dispatchEvent(new Event('change'));
    document.getElementById('notes').value = '冒烟测试写的';
    var rows = document.querySelectorAll('#subjects .subj');
    if (rows[0]) {
      var inputs = rows[0].querySelectorAll('input, textarea');
      inputs[0].value = '语文'; inputs[0].dispatchEvent(new Event('input'));
      inputs[1].value = '背上今天的古诗'; inputs[1].dispatchEvent(new Event('input'));
    }
    document.getElementById('btnSave').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          status: document.getElementById('status').textContent,
          days: document.querySelectorAll('#days li').length,
          firstDay: (document.querySelector('#days b') || {}).textContent || ''
        });
      }, 1500);
    });
  })()`);
  console.log('[smoke] 作业编辑器：', JSON.stringify(written));
  await shot(hwkView, '7-hwk-saved.png');
  console.log('[smoke] 作业编辑器完成');
}

/* ─────────────────────────── 生命周期 ─────────────────────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    /* 第二个快捷方式点开时，argv 里带着它的 --app=…：开（或聚焦）对应那个窗口 */
    openModeWindow(modeFromArgv(argv));
  });

  app.setAppUserModelId('xyz.jinsuper.desktop');

  // 开发机上常挂着本地代理（WSL 里尤其如此）；打包后的正式版不掺这一脚，
  // 交给系统代理设置。
  if (IS_DEV) {
    const proxy = process.env.JSD_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxy) app.commandLine.appendSwitch('proxy-server', proxy);
  }

  app.whenReady().then(() => {
    settings = store.load();
    app.userAgentFallback = CHROME_UA;
    Menu.setApplicationMenu(null);
    /* 桌面版自带界面（topbar / 设置 / 作业编辑器）只有暗色一套，
       站点主题是「跟随系统」——系统是亮色时，窗口里就是一片亮底，
       和外壳不是一套。这里把原生主题钉成 dark，站点就会走它的暗色分支
       （不是往页面里注入样式，只是告诉 Chromium「系统是暗的」）。 */
    nativeTheme.themeSource = 'dark';

    ipcMain.handle('app:getState', () => publicState());
    ipcMain.handle('app:action', (_e, action, payload) => {
      const name = String(action || '');
      /* 「云端同步」那几条走另一条处理链（浏览窗口的设置面板发起的） */
      if (name.startsWith('sync') || name === 'openUrl') return handleSyncAction(name, payload);
      return handleAction(name, payload);
    });
    ipcMain.handle('hwk:action', (_e, action, payload) => handleHwkAction(action, payload));

    if (APP_MODE === 'homework') createHomeworkWindow();
    else createWindow();
    if (IS_SMOKE) {
      pageView.webContents.once('did-finish-load', () => {
        runSmoke().catch((err) => {
          console.error('[smoke] 挂了：', err);
          app.quit();
        });
      });
    }

    app.on('activate', () => {
      if (APP_MODE === 'homework') {
        if (!hwkWin) createHomeworkWindow();
      } else if (!win) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    saveBounds();
    localServer.close();
  });
}
