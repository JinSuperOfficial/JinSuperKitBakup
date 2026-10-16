#!/usr/bin/env node
/**
 * build/shoot-responsive.mjs —— 给响应式改造拍对照截图
 * ===========================================================
 * 为什么要它：`build/test-responsive.mjs` 只能做**静态断言**（viewport / 断点 / 安全区 /
 * 触摸目标…），真实布局（折行、溢出、遮挡、桌面端有没有被改到）它测不了 ——
 * jsdom 不算布局。所以那些部分必须**人眼在几个视口下对照**，而对照要有图。
 *
 * 这台机器上没有 chromium / playwright / puppeteer，但 **`~/.dsh/electron` 里那份
 * Electron 自带一个完整的 Chromium** —— 用它开真窗口、按视口截图，就是最省事的一条路。
 *
 * 为什么是「先在窗口里量、再单独开页面截全页」：
 *   Electron 的 `capturePage()` 只截**当前可视区域**。要一张完整长图得靠 CDP 的
 *   `Page.captureScreenshot({ captureBeyondViewport: true })`，而它的 `clip` 必须
 *   等于整页高度 —— 那就得先在一个临时窗口里把布局跑一遍量出高度。
 *   所以流程是：量（临时窗口）→ 关了 → 开页面 → 截全页 + 截首屏。
 *   量出来的高度写进 `_index.json`，检查脚本（--check）靠它盯**横向溢出**。
 *
 * ⚠️ 现状（如实说明，别当成能直接跑）：
 *   这台开发机（WSL）里 Electron **连不上 WSL 自己的 127.0.0.1 服务**
 *   （`ERR_FAILED (-2)`，而 curl / 浏览器都正常）—— 所以下面这条命令在这台机器上
 *   跑不通。**能用的那条路是 `browser_*` 工具**（浏览器在 Windows 侧，
 *   bsk 通过扩展连过去），已验证：390×844 的手机档 + 1440×900 的桌面档都拍到了，
 *   而且**正是这条路抓出了两个真 bug**（手机面板开关的 `display` 与 `transform`
 *   包含块问题 —— 静态断言一条都拦不住）。
 *   这个脚本留给「本机有能正常跑的 Chromium」的环境：思路是一样的
 *   （CDP `Page.captureScreenshot` + `captureBeyondViewport` 出全页长图），
 *   顺手也把「量布局」那部分做成了 `--check`，能报横向溢出。
 *
 * 用法：
 *   node build/shoot-responsive.mjs                 # 拍全部（7 视口 × N 页）
 *   node build/shoot-responsive.mjs --only=homework # 只拍某一页
 *   node build/shoot-responsive.mjs --check         # 只量不拍，报横向溢出
 *   node build/shoot-responsive.mjs --base=http://127.0.0.1:8788
 *
 * ★ 需要站点先跑起来（页面要 fetch 清单，`file://` 会被 CORS 拦）：
 *     node build/.serve.mjs 8788
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'responsive');

const args = process.argv.slice(2);
const arg = (n, d = '') => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const has = (n) => args.includes(`--${n}`);
const ONLY = arg('only');
const CHECK = has('check');
const BASE = arg('base', 'http://127.0.0.1:8788').replace(/\/+$/, '');

/* ── 要拍的视口（与 project.md 的验收清单一致） ── */
const VIEWPORTS = [
  { id: '375x667',   w: 375,  h: 667,  note: 'iPhone SE' },
  { id: '390x844',   w: 390,  h: 844,  note: 'iPhone 12/13/14' },
  { id: '360x640',   w: 360,  h: 640,  note: 'Android 小屏' },
  { id: '412x915',   w: 412,  h: 915,  note: 'Android 中屏' },
  { id: '768x1024',  w: 768,  h: 1024, note: 'iPad 竖屏（平板档下沿）' },
  { id: '1024x768',  w: 1024, h: 768,  note: 'iPad 横屏（桌面档下沿）' },
  { id: '1440x900',  w: 1440, h: 900,  note: '桌面（必须与改造前一致）' },
];

/* ── 要拍的页面 ── */
const PAGES = [
  { id: 'home',        url: '/index.html',              label: '百宝箱首页' },
  { id: 'skills',      url: '/Skills/index.html',       label: '工具站' },
  { id: 'class',       url: '/class/index.html',        label: '811 专区' },
  { id: 'homework',    url: '/class/homework.html',     label: '★ 作业页' },
  { id: 'english',     url: '/class/english.html',      label: '英语听力' },
  { id: 'classtable',  url: '/class/classtable.html',   label: '课程表' },
  { id: 'run',         url: '/class/run.html',          label: '运动会赛程' },
  { id: 'notfound',    url: '/404.html',                label: '404' },
  { id: 'docs',        url: '/p/docs.html',             label: '阅读器（构建产物）' },
  { id: 'blog',        url: '/p/index.html',            label: '博客首页（构建产物）' },
];

/** Electron 可执行文件：优先环境变量，其次 ~/.dsh/electron */
function findElectron() {
  const cands = [
    process.env.JINS_ELECTRON,
    path.join(os.homedir(), '.dsh', 'electron', 'electron'),
    '/usr/bin/electron',
  ].filter(Boolean);
  for (const c of cands) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch { /* 试下一个 */ }
  }
  return null;
}

/* ═══════════════════════════════════════════════
   主进程：跑在 electron 里（这个文件被 electron 当主进程执行）
   ═══════════════════════════════════════════════ */

const IS_ELECTRON = !!process.versions.electron;

if (IS_ELECTRON) {
  const { app, BrowserWindow } = await import('electron');

  /* 关掉 GPU / 沙箱：headless 容器里 GPU 起不来会直接挂；
     我们只是截图，不需要合成加速。 */
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('hide-scrollbars');   // 别让滚动条进截图（它是 overlay，本来就窄）

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 等页面「稳定」：字体 + 图片 + 两帧 rAF + 一段静置（动画最长 700ms）。
   *
   * ★ 用 CDP 的 `Runtime.evaluate`，**不要用 `webContents.executeJavaScript`** ——
   *   在这台机器的 Electron 上那个 Promise 会永远不 resolve（窗口都建好了、
   *   页面也 load 完了，就是卡在它上面，连超时都不报）。CDP 这条稳。
   */
  async function settle(win, extraMs = 900) {
    try {
      await evalInPage(win, `(async () => {
        if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
        await Promise.all(Array.from(document.images || []).map(im => im.complete ? null :
          new Promise(res => { im.addEventListener('load', res, {once:true}); im.addEventListener('error', res, {once:true}); })));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      })()`, true);
    } catch { /* 页面自己报错也不该拦住截图 */ }
    await sleep(extraMs);
  }

  /** 在页面里求值（走 CDP，见 settle 上面那段说明） */
  async function evalInPage(win, expression, awaitPromise = false) {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) await dbg.attach('1.3');
    try {
      await dbg.sendCommand('Runtime.enable');
    } catch { /* 已经 enable 过就算了 */ }
    const r = await dbg.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (r && r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text || '页面里求值报错');
    }
    return r && r.result ? r.result.value : undefined;
  }

  /** 量一份布局：可见尺寸 / 整页高度 / 横向溢出 / 有几处溢出元素 */
  async function measure(win, vp) {
    return evalInPage(win, `(() => {
      const de = document.documentElement;
      const vw = window.innerWidth;
      const over = [];
      const all = document.body ? document.body.querySelectorAll('*') : [];
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        // 右边缘超出视口 1px 以上，且不是「自己会横滑的容器」
        if (r.right > vw + 1) {
          const st = getComputedStyle(el);
          if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue;
          if (st.position === 'fixed' && r.width <= 40) continue;   // 贴边的滚动轨道之类
          over.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), right: Math.round(r.right) });
        }
      }
      return {
        viewport: { w: vw, h: window.innerHeight },
        scrollWidth: de.scrollWidth,
        scrollHeight: de.scrollHeight,
        horizontalOverflow: de.scrollWidth > vw + 1,
        overflowCount: over.length,
        overflowSample: over.slice(0, 5),
      };
    })()`, true);
  }

  async function shootOne(vp, page) {
    const url = BASE + page.url;
    const outDir = path.join(OUT, vp.id);
    fs.mkdirSync(outDir, { recursive: true });

    /* ① 量（临时窗口，用目标视口尺寸） */
    const mw = new BrowserWindow({
      width: vp.w, height: vp.h, show: false,
      webPreferences: { offscreen: false, backgroundThrottling: false },
    });
    let m;
    try {
      await mw.loadURL(url);
      await settle(mw, 700);
      m = await measure(mw, vp);
    } catch (e) {
      m = { error: String(e && e.message || e) };
    }
    mw.destroy();

    if (CHECK) return { vp: vp.id, page: page.id, ...m };

    /* ② 拍（另开一个窗口，全页 + 首屏） */
    const fullH = Math.min(Math.max((m && m.scrollHeight) || vp.h, vp.h), 20000);
    const w = new BrowserWindow({
      width: vp.w, height: fullH, show: false,
      webPreferences: { offscreen: false, backgroundThrottling: false },
    });
    const result = { vp: vp.id, page: page.id, files: [], ...m };
    try {
      await w.loadURL(url);
      await settle(w);
      const cdp = w.webContents.debugger;
      await cdp.sendCommand('Page.enable');
      const shot = await cdp.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: vp.w, height: fullH, scale: 1 },
      });
      const fullName = `${page.id}.full.png`;
      fs.writeFileSync(path.join(outDir, fullName), Buffer.from(shot.data, 'base64'));
      result.files.push({ name: fullName, kind: 'full', h: fullH });
    } catch (e) {
      result.shotError = String(e && e.message || e);
    }
    w.destroy();

    /* 首屏（就是用户点开看到的那一屏）—— 用可见尺寸窗口直接 capturePage，最省事 */
    const v = new BrowserWindow({
      width: vp.w, height: vp.h, show: false,
      webPreferences: { offscreen: false, backgroundThrottling: false },
    });
    try {
      await v.loadURL(url);
      await settle(v);
      const img = await v.capturePage();
      const vpName = `${page.id}.viewport.png`;
      fs.writeFileSync(path.join(outDir, vpName), img.toPNG());
      result.files.push({ name: vpName, kind: 'viewport', h: vp.h });
    } catch (e) {
      result.shotError = (result.shotError || '') + ' | ' + String(e && e.message || e);
    }
    v.destroy();

    return result;
  }

  app.whenReady().then(async () => {
    const vps = has('all') ? VIEWPORTS : VIEWPORTS;
    const pages = ONLY ? PAGES.filter((p) => p.id === ONLY) : PAGES;
    if (!pages.length) {
      console.error(`✗ --only=${ONLY} 认不出（可用：${PAGES.map((p) => p.id).join(' / ')}）`);
      app.exit(1);
      return;
    }

    const results = [];
    for (const vp of vps) {
      for (const page of pages) {
        try {
          const r = await shootOne(vp, page);
          results.push(r);
          const tail = CHECK
            ? (r.horizontalOverflow ? `✗ 横向溢出 scrollWidth=${r.scrollWidth} > ${vp.w}（${r.overflowCount} 处）` : `✓ 无横向溢出`)
            : `✓ ${(r.files || []).map((f) => f.name).join(' + ')}`;
          console.log(`  ${vp.id.padEnd(9)} ${page.id.padEnd(10)} ${tail}`);
        } catch (e) {
          results.push({ vp: vp.id, page: page.id, error: String(e && e.message || e) });
          console.log(`  ${vp.id.padEnd(9)} ${page.id.padEnd(10)} ✗ ${e && e.message}`);
        }
      }
    }

    const index = {
      note: '由 build/shoot-responsive.mjs 生成。这张表是「量」出来的真数据（Electron/Chromium 里量的），检查脚本靠它盯横向溢出。',
      base: BASE,
      shotAt: new Date().toISOString(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      viewports: VIEWPORTS,
      pages: pages.map((p) => ({ id: p.id, url: p.url, label: p.label })),
      results,
    };
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');

    const bad = results.filter((r) => r.horizontalOverflow);
    console.log('');
    console.log(`拍了 ${results.length} 组 → ${path.relative(ROOT, OUT)}`);
    if (bad.length) {
      console.log(`✗ 有 ${bad.length} 组横向溢出：`);
      for (const b of bad.slice(0, 12)) console.log(`   ${b.vp} ${b.page}  scrollWidth=${b.scrollWidth}（${b.overflowSample?.map((o) => o.tag + '.' + o.cls).join(', ')}）`);
    } else if (CHECK) {
      console.log('✓ 所有视口都没有横向溢出');
    }
    app.exit(bad.length && has('strict') ? 1 : 0);
  });
} else {
  /* ═══════════════════════════════════════════════
     外层：用 electron 跑这个文件自己
     ═══════════════════════════════════════════════ */

  const electron = findElectron();
  if (!electron) {
    console.error('✗ 找不到 Electron 可执行文件。');
    console.error('  找一个完整 Chromium 的路径指给它：JINS_ELECTRON=/path/to/electron node build/shoot-responsive.mjs');
    console.error('  （常见位置：~/.dsh/electron/electron —— DSH 自带的一份）');
    process.exit(1);
  }

  /* 先探一下服务器在不在 —— 页面要 fetch 清单，起不来拍出来全是错误页 */
  if (!CHECK) {
    try {
      const res = await fetch(`${BASE}/class/homework.html`, { method: 'HEAD' });
      if (!res.ok) throw new Error(String(res.status));
    } catch (e) {
      console.error(`✗ 站点没跑起来（${BASE}）：${e.message}`);
      console.error('  先起一个：node build/.serve.mjs 8788');
      process.exit(1);
    }
  }

  console.log(`用 ${electron}`);
  console.log(`站点 ${BASE} · 视口 ${VIEWPORTS.length} 档 · 页面 ${ONLY ? 1 : PAGES.length} 个${CHECK ? ' · 只量不拍' : ''}`);
  console.log('');

  const child = spawn(electron, [fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (e) => {
    console.error('✗ 起 Electron 失败：' + e.message);
    process.exit(1);
  });
  /* 别让 promise 悬着 —— 有 child 在跑，事件循环本来就不会退 */
  void 0;
}
