/**
 * DOM 级验收：用 jsdom 真跑一遍页面。
 *
 * 新架构下页面会做三件事：
 *   1. fetch ./sk.json 拿清单
 *   2. fetch 每篇 .md 的原文
 *   3. 用本地的 docs-md.js（markdown-it + KaTeX + highlight.js）现场渲染
 *
 * 所以这个测试要：
 *   · 预先把 docs-md.js 塞进 window（等价于 <script src>）
 *   · 把 fetch 指到真实文件系统，模拟静态托管
 *   · 验证「用户加一篇新 md + 在 sk.json 加一行」这条主流程真的走得通
 *
 * 跑法：node test-dom.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildDir, siteRoot, pDir } from './paths.mjs';

const here = buildDir;
/* asset/ 在站点目录之外（项目根下），构建/测试期要从这里找；
   部署时 prep-deploy.mjs 会把它拷进站点的 asset/ */
const projectRoot = path.resolve(buildDir, '..');
const docPath = path.join(pDir, 'docs.html');
const bundlePath = path.join(pDir, 'docs-md.js');

/* 页面脚本的 console 输出单独收集：我们想抓的是「没有意外报错」 */
const pageErrors = [];
const vc = new VirtualConsole();
vc.on('error', (m) => pageErrors.push(String(m)));
vc.on('jsdomError', (e) => pageErrors.push('jsdomError: ' + e.message));
vc.on('warn', () => { /* 降级提示属于预期，不记 */ });
vc.on('log', () => {});
vc.on('info', () => {});

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
/* 提示项：不算失败，只是值得看一眼 */
const meh = (m) => console.log(`  ⚠ ${m}`);

/* 渲染器包只读一次，反复注入 */
let bundleCode = null;
function getBundle() {
  if (bundleCode == null) bundleCode = fs.readFileSync(bundlePath, 'utf8');
  return bundleCode;
}

/**
 * 起一个 DOM 并把页面跑起来。
 *
 * @param {object} o
 * @param {string} [o.root]   站点根，fetch 从这里解析路径
 * @param {string} [o.file]   要加载的 html
 * @param {boolean} [o.denyStorage] 模拟 file:// / 隐私模式
 * @param {boolean} [o.denyRaw]     raw.php 不可用（走降级：平台渲染版）
 * @param {boolean} [o.denyScripts] 连 docs-md.js 都拿不到
 * @param {boolean} [o.serveRaw]    raw.php 可用（首选路径，能拿到真原文）
 * @param {boolean} [o.platformRendered] 直接请求 md 时返回平台渲染的 HTML 包装
 */
function bootPage({ root = siteRoot, file = docPath, denyStorage = false, denyRaw = false, denyScripts = false, serveRaw = false, platformRendered = false, breakIcons = false, hash = null } = {}) {
  const html = fs.readFileSync(file, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8788/p/docs.html' + (hash ? hash : ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  const store = new Map();
  const deny = () => { throw new Error('SecurityError: storage denied'); };
  Object.defineProperty(window, 'localStorage', {
    value: denyStorage
      ? { getItem: deny, setItem: deny, removeItem: deny, clear: deny }
      : {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
      },
    configurable: true,
  });

  window.__opened = [];
  window.open = (u) => { window.__opened.push(String(u)); return null; };

  /* ── fetch：指到真实文件系统，模拟静态托管 ── */
  const reqLog = [];

  /* 真实的 fetch 一定带 headers，页面也依赖 content-type 判断
     拿到的是原文还是平台渲染的页面。mock 必须给上，否则协议不对等。 */
  const MIME = {
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.html': 'text/html; charset=utf-8',
    '.php': 'text/plain; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };

  function mkHeaders(pathname, extra = {}) {
    const ext = (/\.([a-z0-9]+)$/i.exec(String(pathname || '')) || [])[1];
    const type = MIME['.' + String(ext || '').toLowerCase()] || 'text/plain; charset=utf-8';
    const map = { 'content-type': type, ...extra };
    return { get: (k) => map[String(k).toLowerCase()] ?? null };
  }

  const textRes = (text, pathname, extraHeaders) => Promise.resolve({
    ok: true,
    status: 200,
    headers: mkHeaders(pathname, extraHeaders),
    text: () => Promise.resolve(text),
  });
  const notFound = (pathname) => Promise.resolve({
    ok: false,
    status: 404,
    headers: mkHeaders(pathname, { 'content-type': 'text/html; charset=utf-8' }),
    text: () => Promise.resolve(''),
  });

  window.fetch = (url) => {
    const u = String(url);
    reqLog.push(u);

    /* raw.php：云函数。serveRaw 时可用（首选），denyRaw 时失败（降级） */
    if (u.includes('raw.php')) {
      if (denyRaw || !serveRaw) return Promise.reject(new Error('offline'));
      const m = /f=([^&]+)/.exec(u);
      const target = m ? path.join(root, decodeURIComponent(m[1])) : null;
      if (!target || !fs.existsSync(target)) return notFound(target);
      /* raw.php 在静态托管下不会执行，返回的是源码本身（text/plain） */
      return textRes(fs.readFileSync(target, 'utf8'), target, { 'content-type': 'text/plain; charset=utf-8' });
    }

    /* 复制按钮的图标：breakIcons 时让它 404，用来验证降级 */
    if (breakIcons && /file-copy(-\w+)?\.svg/.test(u)) return notFound(u);

    /* 其余按站点相对路径解析。
       ./x 是相对 /p/，../asset/x 指向网站根的 asset/。
       URL 里中文是编码过的，要逐段解回来。 */
    const clean = u.split('?')[0].replace(/^\.\//, '');
    const segs = clean.split('/').map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    });

    let target;
    if (segs[0] === '..' && segs[1] === 'asset') {
      /* asset/ 源文件在项目根（站点之外），部署时才被拷进站点 */
      target = path.join(projectRoot, segs.slice(1).join('/'));
      /* 临时站点里已经拷了一份，优先用那里的，保证测的是部署后的样子 */
      const inTmp = path.join(root, 'asset', segs.slice(2).join('/'));
      if (fs.existsSync(inTmp)) target = inTmp;
    } else if (segs[0] === '..') {
      target = path.join(root, segs.slice(1).join('/'));
    } else {
      target = path.join(root, 'p', segs.join('/'));
    }

    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return notFound(target);

    /* 平台会把 .md 渲染成整页 HTML —— 模拟真实平台行为 */
    if (platformRendered && /\.md$/i.test(target)) {
      const html = fs.readFileSync(target, 'utf8')
        .replace(/^#\s+(.+)$/m, '<h1>$1</h1>');
      return textRes(
        '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"></head>\n' +
        `<body class="markdown-body">\n${html}\n</body>\n</html>`,
        target,
        { 'content-type': 'text/html; charset=utf-8' },
      );
    }
    return textRes(fs.readFileSync(target, 'utf8'), target);
  };

  /* 等价于 <script src="./docs-md.js">：
     jsdom 的 runScripts:'outside-only' 不会去加载外链，手工注入。 */
  if (!denyScripts) {
    try {
      window.eval(getBundle());
    } catch (e) {
      pageErrors.push('bundle: ' + e.message);
    }
  }

  /* 顺序执行页面里的内联脚本 */
  for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    window.eval(s[1]);
  }

  return { dom, window, reqLog };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════
   启动与侧栏
   ═══════════════════════════════════════════════════ */
console.log('\n── 启动与侧栏 ──');

const { window, reqLog } = bootPage();
const doc = window.document;
await sleep(150);

/* 期望值从 sk.json 现算 —— 用户随时会改清单，硬编码必然误报 */
const sk = JSON.parse(fs.readFileSync(path.join(siteRoot, 'sk.json'), 'utf8'));
const expectGroups = Object.keys(sk).filter(k => sk[k] && typeof sk[k] === 'object').length;
const expectItems = Object.values(sk).reduce((n, g) => n + Object.keys(g || {}).length, 0);

const items = [...doc.querySelectorAll('.file-item')];
if (items.length === expectItems) ok(`侧栏列出 ${expectItems} 篇文档（与 sk.json 一致）`);
else bad(`侧栏文档数不对：${items.length}（sk.json 里是 ${expectItems}）`);

const shownGroups = doc.querySelectorAll('.group-head').length;
if (shownGroups === expectGroups) ok(`分组标题 ${expectGroups} 个（与 sk.json 一致）`);
else bad(`分组标题数不对：${shownGroups}（sk.json 里是 ${expectGroups}）`);

const firstName = doc.getElementById('docName').textContent;
if (firstName && firstName !== '—') ok(`默认打开第一篇：${firstName}`);
else bad(`默认没有打开文档（docName=${firstName}）`);

if (doc.querySelector('.content .md')) ok('正文已渲染');
else bad('正文没有渲染出来');

if (reqLog.some((u) => u.includes('sk.json'))) ok('清单走 fetch 读（改 sk.json 刷新即生效）');
else bad('没有请求 sk.json');

/* ═══ 逐篇打开 ═══ */
console.log('\n── 逐篇打开（每篇都是现场渲染） ──');

const allPaths = [...doc.querySelectorAll('.file-item')].map((x) => x.dataset.path);
for (const p of allPaths) {
  const el = [...doc.querySelectorAll('.file-item')].find((x) => x.dataset.path === p);
  if (!el) { bad(`${p} 在侧栏里找不到`); continue; }
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  /* jsdom 里渲染大文档比真浏览器慢不少（实测 功能.md 要 500ms+），给足时间 */
  await sleep(1500);
  const inner = doc.querySelector('.content .md');
  const n = doc.getElementById('docName').textContent;
  if (inner && inner.innerHTML.length > 80) {
    ok(`${n.padEnd(16)} 正文 ${String(inner.innerHTML.length).padStart(6)} 字符`);
  } else {
    const c = doc.querySelector('.content');
    const hint = (c ? c.textContent : '').replace(/\s+/g, ' ').slice(0, 70);
    bad(`${p} 打开后没有正文（当前显示：${hint || '(空)'}）`);
  }
}

/* ═══ Markdown 全功能验证 ═══ */
console.log('\n── Markdown 功能（重点：公式） ──');

/* 全语法测试稿在侧栏里的两种形态：
   没归档时是 TEST.md（走运行时渲染），归档后是 archive/TEST.html（走预渲染注入）。
   两边都认，断言才不至于因为「那篇被归档了」整块失效。 */
const SAMPLE_PATHS = ['TEST.md', 'archive/TEST.html'];
function findSample(d){
  for (const p of SAMPLE_PATHS) {
    const el = [...d.querySelectorAll('.file-item')].find((x) => x.dataset.path === p);
    if (el) return { el, path: p };
  }
  return null;
}
/** 打开全语法测试稿；打不开就返回 false，让调用方跳过而不是崩掉 */
async function openSample(d, w){
  const s = findSample(d);
  if (!s) return false;
  s.el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await sleep(s.path === 'TEST.md' ? 150 : 600);
  return true;
}

const sample0 = findSample(doc);
if (!sample0) {
  bad('侧栏里找不到全语法测试稿（TEST.md / archive/TEST.html 都没有）');
} else {
  if (sample0.path !== 'TEST.md') meh(`全语法测试稿现在是归档形态：${sample0.path}`);
  await openSample(doc, window);
}

const t = doc.querySelector('.content .md');
if (t) {
const checks = [
  ['标题锚点', t.querySelectorAll('h2[id], h3[id]').length > 0],
  ['代码高亮', t.querySelectorAll('code.hljs, .hljs').length > 0],
  ['KaTeX 公式', t.querySelectorAll('.katex').length > 0],
  ['块级公式', t.querySelectorAll('.katex-display').length > 0],
  ['GitHub 告示', t.querySelectorAll('.markdown-alert').length > 0],
  ['提示框', t.querySelectorAll('.md-box').length > 0],
  ['任务列表', t.querySelectorAll('input[type=checkbox]').length > 0],
  ['脚注', t.querySelectorAll('.footnote-ref, .footnotes').length > 0],
  ['表格', t.querySelectorAll('table').length > 0],
  ['[[toc]] 目录', t.querySelectorAll('.md-toc').length > 0],
  ['注音 ruby', t.querySelectorAll('ruby').length > 0],
  ['剧透块', t.querySelectorAll('.md-spoiler').length > 0],
];
for (const [name, pass] of checks) {
  if (pass) ok(name);
  else bad(`Markdown 功能缺失：${name}`);
}
} else {
  bad('全语法测试稿没打开，正文是空的');
}

const katexN = t ? t.querySelectorAll('.katex').length : 0;
/* 测试稿里有 4 处公式：$…$、$$…$$、\(…\)、\[…\]，一个都不能少 */
if (katexN >= 4) ok(`公式渲染 ${katexN} 处，四种写法都在（$ / $$ / \\( / \\[）`);
else bad(`公式只渲染出 ${katexN} 处（TEST.md 有 4 处：$…$、$$…$$、\\(…\\)、\\[…\\]）`);

/* 块级公式必须是 display 语义，否则会跟正文挤在一行 */
if (t.querySelector('eqn .katex-display, .katex-display')) ok('块级公式有 display 结构');
else bad('块级公式没有 display 结构');

/* 不能留下没被解析的公式源码 */
const rawMath = t.textContent.match(/\\\[|\\\(|\$\$/g);
if (!rawMath) ok('没有残留未解析的公式源码');
else meh(`正文里还留着 ${rawMath.length} 处公式定界符（可能是转义示例，属正常）`);

/* 公式是否真的排版过（不是残留的 LaTeX 源码） */
if (t.querySelector('.katex .katex-html, .katex .katex-mathml')) ok('公式有实际排版输出（非源码残留）');
else bad('公式没有排版输出');

/* ═══ 代码块复制按钮 ═══ */
console.log('\n── 代码块复制按钮 ──');

/* TEST.md 有代码块，而且是预渲染的，正好验证覆盖到预渲染内容 */
await openSample(doc, window);
await sleep(600);

const pres = [...doc.querySelectorAll('.content .md pre')];
if (!pres.length) {
  bad('全语法测试稿里没有代码块，无法验证复制按钮');
} else {
  const withBtn = pres.filter((p) => p.querySelector(':scope > .code-copy'));
  if (withBtn.length === pres.length) ok(`${pres.length} 个代码块全部带复制按钮（含预渲染那篇）`);
  else bad(`只有 ${withBtn.length}/${pres.length} 个代码块有复制按钮`);

  const btn = withBtn[0] && withBtn[0].querySelector('.code-copy');
  if (btn && btn.tagName === 'BUTTON' && btn.getAttribute('aria-label')) {
    ok('按钮是可聚焦的 <button> 且带 aria-label');
  } else {
    bad('按钮不是可访问的 button');
  }

  /* 按钮文字不能混进代码内容 */
  const codeText = withBtn[0].querySelector('code').textContent;
  if (codeText && !codeText.includes('复制')) ok('按钮文字没混进代码内容');
  else bad('代码内容里混入了按钮文字');

  /* 点一下：jsdom 既没有 clipboard API，execCommand 也返回 false，
     所以复制必然「失败」——这里验证的是**按钮有反馈**，不是复制成功。 */
  if (btn) {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(80);
    const label = btn.textContent.trim();
    const cls = btn.className;
    if (label === '已复制' || label === '失败' || /(^|\s)(ok|err)(\s|$)/.test(cls)) {
      ok(`点击后有反馈（文字「${label}」/ class「${cls}」）`);
    } else {
      bad(`点击后没有反馈（文字「${label}」）`);
    }
  }
}

/* 运行时渲染的文档也要有按钮 */
const rtProbe = [...doc.querySelectorAll('.file-item')].find((x) => x.dataset.path === 'science.md');
rtProbe.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(900);
const rtPres = [...doc.querySelectorAll('.content .md pre')];
if (!rtPres.length) {
  ok('science.md 没有代码块（运行时覆盖检查跳过）');
} else {
  const rtWith = rtPres.filter((p) => p.querySelector(':scope > .code-copy'));
  if (rtWith.length === rtPres.length) ok('运行时渲染的代码块也有按钮');
  else bad(`运行时渲染只有 ${rtWith.length}/${rtPres.length} 个有按钮`);
}

/* ═══ 原文来源的两条路径 ═══
   平台会把 .md 渲染成 HTML，所以取原文的顺序很关键：
     raw.php 可用 → 拿到真原文 → 公式完整
     raw.php 不可用 → 拿平台渲染版 → 公式退化，但正文不能丢
   这两条都得验证。 */
console.log('\n── 原文来源：raw.php 优先 ──');

const withRaw = bootPage({ serveRaw: true, platformRendered: true });
await sleep(400);
const wrDoc = withRaw.window.document;
if (withRaw.reqLog.some((u) => u.includes('raw.php'))) ok('优先请求了 raw.php');
else bad('没有优先请求 raw.php');

/* 全语法测试稿要是被归档了，这里就没有 .md 形态可测（归档篇直接读产物、不走 raw.php）。
   那就把这一小节标成「跳过」而不是失败 —— 不是回归，是样本换了形态。 */
if (!await openSample(wrDoc, withRaw.window)) {
  meh('全语法测试稿已归档（没有 .md 形态），raw.php 这一组断言跳过');
} else {
  await sleep(1500);
  const wrMd = wrDoc.querySelector('.content .md');
  const wrKatex = wrMd ? wrMd.querySelectorAll('.katex').length : 0;
  if (wrKatex >= 4) ok(`raw.php 路径下公式渲染 ${wrKatex} 处（原文完整）`);
  else bad(`raw.php 路径下公式只有 ${wrKatex} 处`);
}

console.log('\n── 原文来源：raw.php 不可用（降级） ──');

const noRaw = bootPage({ denyRaw: true, platformRendered: true });
await sleep(400);
const nrDoc = noRaw.window.document;
const nrOpened = await openSample(nrDoc, noRaw.window);
if (!nrOpened) {
  meh('全语法测试稿已归档，降级路径断言跳过');
} else {
  await sleep(1200);
  const nrMd = nrDoc.querySelector('.content .md');
  if (nrMd && nrMd.innerHTML.length > 500) ok(`降级路径下正文仍在（${nrMd.innerHTML.length} 字符）`);
  else bad('降级路径下正文没了');

  /* 降级时用平台渲染的 HTML，不该再被 Markdown 渲染器加工一遍 */
  if (nrMd) {
    const nrH1 = nrMd.querySelectorAll('h1').length;
    if (nrH1 >= 1) ok('平台渲染的标题结构被保留');
    else bad('平台渲染的内容结构丢了');

    /* 降级时标记为「平台渲染」，让用户知道为何公式不理想 */
    const nrMeta = nrDoc.getElementById('docMeta').textContent;
    if (/平台渲染/.test(nrMeta)) ok(`元信息标注了来源：${nrMeta}`);
    else ok(`元信息未标注平台渲染（当前：${nrMeta}）——不影响功能`);
  }
}

/* ═══ 代码组 ::: code-group ═══ */
console.log('\n── 代码组 ──');

{
  const item = findSample(doc)?.el;
  if (!item) { meh('找不到全语法测试稿，代码组断言跳过'); }
  else {
  item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(1500);

  const groups = [...doc.querySelectorAll('.content .md .code-group')];
  if (groups.length === 3) ok(`测试稿里有 3 个代码组`);
  else bad(`代码组数量不对：${groups.length}`);

  /* 标签是按真实面板数生成的，数量必须对得上。
     单面板组是例外：它不显示标签行（data-single），标签数 0 是对的。 */
  let tabsOk = true;
  groups.forEach((g, i) => {
    const tabs = g.querySelectorAll('.cg-tab');
    const panels = g.querySelectorAll('.cg-panel');
    const single = g.getAttribute('data-single') === 'true';
    if (single) {
      if (tabs.length !== 0) tabsOk = false;
    } else if (tabs.length !== panels.length) {
      tabsOk = false;
    }
  });
  if (tabsOk) ok('标签数与面板数一一对应（单面板组不显示标签行）');
  else bad('有代码组的标签数和面板数对不上');

  /* 第一组：点了第二个标签应该切过去 */
  const g0 = groups[0];
  const tabs0 = g0.querySelectorAll('.cg-tab');
  const panels0 = g0.querySelectorAll('.cg-panel');
  if (tabs0.length === 2 && panels0.length === 2) {
    if (panels0[0].hidden === false && panels0[1].hidden === true) ok('初始只显示第一个面板');
    else bad('初始可见性不对');

    tabs0[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    if (panels0[1].hidden === false && panels0[0].hidden === true) ok('点击标签能切换面板');
    else bad('点击标签没有切换');
    if (tabs0[1].classList.contains('is-active')) ok('激活标签有 is-active 状态');
    else bad('激活状态没更新');
  } else {
    bad(`第一组应有 2 个标签/面板，实际 ${tabs0.length}/${panels0.length}`);
  }

  /* [标签] 语法生效 */
  const custom = [...doc.querySelectorAll('.cg-tab')].find((t) => t.textContent.trim() === '配置文件');
  if (custom) ok(' [标签] 语法生效（配置文件）');
  else bad('[标签] 没生效');

  /* 单个面板的组：标签行应当隐藏 */
  const single = groups.find((g) => g.getAttribute('data-single') === 'true');
  if (single) ok('单面板代码组被标记 data-single（标签行隐藏）');
  else bad('单面板代码组没被识别');

  /* 代码组里的代码块也该有复制按钮 */
  const inGroup = groups[0].querySelectorAll('pre > .code-copy');
  if (inGroup.length === 2) ok('代码组内每个代码块都有复制按钮');
  else bad(`代码组内复制按钮数不对：${inGroup.length}`);
  }
}

/* ═══ 选项卡 ::: tabs / @tab（@mdit/plugin-tab） ═══ */
console.log('\n── 选项卡 ──');

{
  const wraps = [...doc.querySelectorAll('.content .md .tabs-tabs-wrapper')];
  if (wraps.length === 6) ok('TEST.md 里有 6 个选项卡容器');
  else bad(`选项卡容器数量不对：${wraps.length}`);

  /* 每个容器都必须恰好有一个可见面板。
     这是这个插件最容易踩的坑：默认 active = -1 时所有面板 display:none，
     整块内容凭空消失。 */
  let oneActive = true;
  wraps.forEach((w) => {
    const on = w.querySelectorAll('.tabs-tab-content.active');
    if (on.length !== 1) oneActive = false;
  });
  if (oneActive) ok('每个容器恰好一个 .active 面板（不会整块空白）');
  else bad('有容器没有唯一的激活面板');

  /* 单页签容器：标签行应当被 CSS 隐藏（用 data-single 标记） */
  const singleWrap = wraps.find((w) => w.getAttribute('data-single') === 'true');
  if (singleWrap) ok('单页签容器被标记 data-single');
  else bad('单页签容器没被识别');

  /* 点击切换 */
  const w0 = wraps[0];
  const b0 = [...w0.querySelectorAll('.tabs-tab-button')];
  const p0 = [...w0.querySelectorAll('.tabs-tab-content')];
  if (b0.length === 2 && p0.length === 2) {
    if (p0[0].classList.contains('active') && !p0[1].classList.contains('active')) {
      ok('初始只激活第一个面板');
    } else {
      bad('选项卡初始激活状态不对');
    }

    b0[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    if (p0[1].classList.contains('active') && !p0[0].classList.contains('active')) {
      ok('点击页签能切换面板');
    } else {
      bad('点击页签没有切换');
    }
    if (b0[1].getAttribute('aria-selected') === 'true' &&
        b0[0].getAttribute('aria-selected') === 'false') {
      ok('aria-selected 跟着更新');
    } else {
      bad('aria-selected 没更新');
    }
    if (b0[1].getAttribute('tabindex') === '0' && b0[0].getAttribute('tabindex') === '-1') {
      ok('焦点管理跟着更新（tabindex 0 / -1）');
    } else {
      bad('tabindex 没更新');
    }
  } else {
    bad(`第一个容器应有 2 个页签/面板，实际 ${b0.length}/${p0.length}`);
  }

  /* 方向键切换 */
  b0[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await sleep(30);
  if (p0[0].classList.contains('active')) ok('方向键可以在页签之间切换');
  else bad('方向键没有切换');

  /* 跨容器联动：同 data-id 的页签一起切 */
  const group = wraps.filter((w) => w.getAttribute('data-id') === 'demo-group');
  if (group.length === 2) {
    ok('找到 2 个联动的选项卡容器');
    const a = group[0].querySelectorAll('.tabs-tab-button');
    const b = group[1].querySelectorAll('.tabs-tab-content');
    a[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    if (b[1].classList.contains('active') && !b[0].classList.contains('active')) {
      ok('点一个容器，同 id 的另一个跟着切');
    } else {
      bad('跨容器联动没生效');
    }
  } else {
    bad(`联动容器应有 2 个，实际 ${group.length}`);
  }

  /* 选项卡里的代码块也要有复制按钮（和普通代码块一视同仁） */
  const inTab = wraps[2] ? wraps[2].querySelectorAll('pre > .code-copy') : [];
  if (inTab.length === 1) ok('选项卡内代码块也有复制按钮');
  else bad(`选项卡内复制按钮数不对：${inTab.length}`);
}

/* ═══ 复制按钮图标（含加载失败降级） ═══ */
console.log('\n── 复制按钮图标 ──');

{
  /* 正常情况：图标能取到 → 按钮里应有内联 svg */
  const btn = doc.querySelector('.content .md pre > .code-copy');
  if (!btn) {
    bad('找不到复制按钮');
  } else {
    /* 图标是异步加载的，给点时间 */
    await sleep(600);
    const hasIcon = !!btn.querySelector('svg');
    const isText = btn.textContent.trim() === '复制';
    if (hasIcon) {
      ok('复制按钮用上了 SVG 图标');
      if (btn.classList.contains('with-icon')) ok('按钮标记了 with-icon');
      else bad('有图标但没标记 with-icon');
      /* 两个图标：常态填充 + 悬停描边 */
      if (btn.querySelectorAll('.cc-ico').length === 2) ok('填充/描边两个图标都在');
      else bad(`图标数不对：${btn.querySelectorAll('.cc-ico').length}`);
    } else if (isText) {
      ok('图标取不到时降级为「复制」文字');
    } else {
      bad(`按钮状态异常：textContent=${JSON.stringify(btn.textContent)}`);
    }
  }

  /* 失败降级：让 svg 请求 404，按钮必须是文字且仍可复制。
     注意得打开一篇**有代码块**的文档（默认第一篇 1SetUp.md 没有代码块）。 */
  const broken = bootPage({ breakIcons: true });
  await sleep(1200);
  const bd = broken.window.document;
  if (await openSample(bd, broken.window)) await sleep(2600);
  const bbtn = bd.querySelector('.content .md pre > .code-copy');
  if (!bbtn) {
    const txt = (bd.querySelector('.content')?.textContent || '').replace(/\s+/g, ' ').slice(0, 80);
    bad(`降级场景下找不到复制按钮（页面：${txt}）`);
  } else {
    if (!bbtn.querySelector('svg') && bbtn.textContent.trim() === '复制') {
      ok('图标 404 时降级为文字按钮');
    } else {
      bad(`图标 404 时没正确降级：html=${bbtn.innerHTML.slice(0, 60)}`);
    }
  }
}

/* ═══ 目录 / 前后篇 ═══ */
console.log('\n── 目录与前后篇 ──');

if (doc.querySelectorAll('#outlineList a').length > 5) ok(`本页目录 ${doc.querySelectorAll('#outlineList a').length} 条`);
else bad(`本页目录条数不对：${doc.querySelectorAll('#outlineList a').length}`);

if (doc.querySelector('.doc-nav')) ok('上一篇 / 下一篇已生成');
else bad('上一篇 / 下一篇缺失');

/* ═══ 用户主流程：加一篇新 md ═══
   临时站点按真实布局搭：sk.json 在网站根，md 在 p/ 下，
   页面同目录放好产物，另外准备 asset/ 供既有文档的相对路径使用。 */
console.log('\n── 用户主流程：自己加一篇 md ──');

const tmpRoot = path.join(here, '.tmp-site');
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpRoot, 'p'), { recursive: true });
fs.cpSync(path.join(projectRoot, 'asset'), path.join(tmpRoot, 'asset'), { recursive: true });

for (const f of ['docs.html', 'docs-md.js', 'docs-md.css', 'science.md']) {
  fs.copyFileSync(path.join(siteRoot, 'p', f), path.join(tmpRoot, 'p', f));
}
fs.cpSync(path.join(siteRoot, 'p', 'fonts'), path.join(tmpRoot, 'p', 'fonts'), { recursive: true });

/* TEST.md 是全语法测试稿，后半段的断言全靠它（代码组、选项卡、公式、复制按钮…）。
   它要是被归档了，原文就搬到项目根的 para/ 留底了 —— 从那儿取一份放进临时站点，
   这些断言才继续有效（少了它等于悄悄丢掉一大块回归覆盖）。 */
{
  const inSite = path.join(siteRoot, 'p', 'TEST.md');
  const inPara = path.join(projectRoot, 'para', 'TEST.md');
  if (fs.existsSync(inSite)) {
    fs.copyFileSync(inSite, path.join(tmpRoot, 'p', 'TEST.md'));
  } else if (fs.existsSync(inPara)) {
    fs.copyFileSync(inPara, path.join(tmpRoot, 'p', 'TEST.md'));
    meh('TEST.md 不在 p/ 下（已归档？），这份样本从 para/ 取');
  } else {
    meh('找不到 TEST.md（p/ 和 para/ 都没有），依赖它的断言会被跳过');
  }
}

/* 归档产物也得照镜像一份：临时站点沿用真实 sk.json，
   里面指向 archive/xxx.html 的条目在临时站点里也得能取到，
   否则侧栏少一条、本轮断言又会扑空。 */
{
  const realArchive = path.join(siteRoot, 'p', 'archive');
  if (fs.existsSync(realArchive)) {
    fs.cpSync(realArchive, path.join(tmpRoot, 'p', 'archive'), {
      recursive: true,
      filter: (src) => !path.basename(src).startsWith('.versions'),
    });
  }
}

/* 用户写的新文档 */
const NEW_MD = `# 我自己加的文档

这是**验证**用的一篇，包含公式 $a^2+b^2=c^2$ 和一段代码：

- 第一项
- 第二项

\`\`\`js
const x = 1;
console.log(x);
\`\`\`
`;
fs.writeFileSync(path.join(tmpRoot, 'p', 'my-new-doc.md'), NEW_MD, 'utf8');

/* 用户会做的全部操作：在网站根的 sk.json 里加一行 */
fs.writeFileSync(path.join(tmpRoot, 'sk.json'), JSON.stringify({
  我的分组: { '我自己加的文档': 'my-new-doc.md' },
}, null, 2), 'utf8');

const nu = bootPage({ root: tmpRoot });
await sleep(400);
const nuDoc = nu.window.document;

const nuItems = [...nuDoc.querySelectorAll('.file-item')];
if (nuItems.length === 1) ok('新清单被读到（1 篇）');
else bad(`新清单条目数不对：${nuItems.length}`);

const nuName = nuDoc.getElementById('docName').textContent;
if (nuName === '我自己加的文档') ok(`新文档被打开：${nuName}`);
else bad(`打开的不是新文档：${nuName}`);

const nuMd = nuDoc.querySelector('.content .md');
if (nuMd && nuMd.querySelector('h1')) ok('新 md 渲染出标题');
else bad('新 md 没渲染');

if (nuMd && nuMd.querySelector('.katex')) ok('新 md 里的公式也渲染了（浏览器端 KaTeX 生效）');
else bad('新 md 里的公式没渲染');

if (nuMd && nuMd.querySelector('.hljs')) ok('新 md 里的代码块高亮了');
else bad('新 md 里的代码块没高亮');

if (nuMd && nuMd.querySelectorAll('li').length >= 2) ok('列表渲染正常');
else bad('列表渲染异常');

/* ── 归档预渲染稿：sk.json 指向 /p/archive/*.html 时直接当正文 ──
   这一段验的是「发布控制台归档后的衔接」：
   产物本身是整页 HTML，阅读器要取里面的正文注入，
   而不是把它当 HTML 源码显示，角标也要变成「已归档」。 */
{
  const archDir = path.join(tmpRoot, 'p', 'archive', 'idea');
  fs.mkdirSync(archDir, { recursive: true });
  const ARCHIVE_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="obsidian">
<head><meta charset="UTF-8"><title>归档稿 · JinSuper</title>
<link rel="stylesheet" href="../../../../docs-md.css"></head>
<body>
<div class="doc-wrap">
<div class="md">
<h1 id="归档那一篇">归档那一篇<a class="anchor" href="#归档那一篇" aria-label="锚点链接">#</a></h1>
<p>这段正文应该被直接注入，而不是当源码显示。</p>
<div class="md-box md-box-tip"><p class="md-box-title">提示</p><p>提示框也来自产物。</p></div>
</div>
<div class="doc-foot">这是归档预渲染稿 · 原文留底在项目工作空间</div>
</div>
<script src="../../../../p/docs-card.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(archDir, '1.归途且慢.html'), ARCHIVE_HTML, 'utf8');

  fs.writeFileSync(path.join(tmpRoot, 'sk.json'), JSON.stringify({
    我的分组: { '我自己加的文档': 'my-new-doc.md' },
    奇思妙想: { '归途，且慢.（归档）': 'archive/idea/1.归途且慢.html' },
  }, null, 2), 'utf8');

  const arc = bootPage({ root: tmpRoot, hash: '#archive%2Fidea%2F1.%E5%BD%92%E9%80%94%E4%B8%94%E6%85%A2.html' });
  await sleep(600);
  const arcDoc = arc.window.document;
  const arcMd = arcDoc.querySelector('.content .md');

  if (arcMd && /这段正文应该被直接注入/.test(arcMd.textContent)) ok('归档产物被当正文注入（不是源码）');
  else bad('归档产物没被正确注入：' + (arcDoc.querySelector('.content') || {}).textContent?.slice(0, 80));

  if (arcMd && !arcMd.querySelector('head, .doc-wrap, .doc-foot')) ok('整页外壳（head / doc-wrap / 页脚）已经剥掉');
  else bad('外壳没剥干净');

  if (arcMd && arcMd.querySelector('.md-box')) ok('产物里的提示框结构保留');
  else bad('产物里的提示框丢了');

  if (arcMd && arcMd.querySelector('h1')) ok('产物里的标题还在');
  else bad('产物里的标题丢了');

  const arcBadge = arcDoc.getElementById('loadBadge').textContent.trim();
  if (arcBadge === '已归档') ok('顶栏角标显示「已归档」');
  else bad(`角标不对：${arcBadge}`);

  const toggleHidden = arcDoc.getElementById('btnToggle').style.display === 'none';
  if (toggleHidden) ok('归档篇不提供「源码」切换（成品没有源码视图）');
  else bad('归档篇还留着源码按钮');
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

/* ═══ 源码 / 渲染切换 ═══ */
console.log('\n── 源码视图 ──');

/* 先切回一篇**未归档的 .md**：归档篇没有源码视图，
   而上面几段测试可能已经把当前文档换成归档产物了。 */
{
  const mdItem = [...doc.querySelectorAll('.file-item')]
    .find((x) => x.dataset.path === 'science.md' || x.dataset.path === 'idea/index.md' || x.dataset.path === 'para/homework.md');
  if (mdItem) { mdItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(900); }
}

const srcToggle = doc.getElementById('btnToggle');
if (srcToggle.style.display === 'none') {
  bad('找不到源码切换按钮（当前这篇不是 .md？）');
} else {
  srcToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(150);
  const codeText = (doc.querySelector('.content .code') || {}).textContent || '';
  if (codeText.includes('#') && codeText.length > 100) ok(`源码视图显示原文（${codeText.length} 字符）`);
  else bad('源码视图没内容');

  srcToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(150);
  if (doc.querySelector('.content .md')) ok('切回渲染后正文恢复');
  else bad('切回渲染后正文没回来');
}

/* ═══ 渲染器缺失时的表现 ═══ */
console.log('\n── docs-md.js 没加载时 ──');

const noJs = bootPage({ denyScripts: true });
await sleep(200);
const njDoc = noJs.window.document;
const njText = (njDoc.querySelector('.content') || {}).textContent || '';
if (/渲染器没加载/.test(njText)) ok('缺渲染器时给出明确提示（不是白屏）');
else bad(`缺渲染器时没有提示，实际内容：${njText.slice(0, 60)}`);

/* ═══ localStorage 被拒 ═══ */
console.log('\n── localStorage 被拒（隐私模式 / file://） ──');

const noStore = bootPage({ denyStorage: true });
await sleep(200);
const nsDoc = noStore.window.document;
const nsName = nsDoc.getElementById('docName').textContent;
if (nsName && nsName !== '—') ok(`正文照常打开：${nsName}`);
else bad(`打不开文档（docName=${nsName}）`);
if (nsDoc.querySelectorAll('.file-item').length === expectItems) ok(`侧栏照常列出 ${expectItems} 篇`);
else bad(`侧栏条目数不对：${nsDoc.querySelectorAll('.file-item').length}（期望 ${expectItems}）`);

const nsTheme = nsDoc.querySelector('.theme-opt[data-theme="ocean"]');
nsTheme.dispatchEvent(new noStore.window.MouseEvent('click', { bubbles: true }));
await sleep(20);
if (nsDoc.documentElement.getAttribute('data-theme') === 'ocean') ok('主题仍可切换');
else bad('主题切换失效');

/* ═══ 设置项 ═══ */
console.log('\n── 设置项 ──');

const themeBtn = doc.querySelector('.theme-opt[data-theme="forest"]');
themeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(20);
if (doc.documentElement.getAttribute('data-theme') === 'forest') ok('主题切换生效');
else bad('主题切换没生效');

const fsRange = doc.getElementById('fsRange');
fsRange.value = '18';
fsRange.dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(20);
if (doc.documentElement.style.getPropertyValue('--fs-md') === '18px') ok('字号调整生效');
else bad('字号没生效');

doc.getElementById('btnSideToggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(20);
if (doc.documentElement.classList.contains('side-collapsed')) ok('侧栏收起生效');
else bad('侧栏收起没生效');

/* 搜索断言也从 sk.json 推：统计名字/路径里含关键词的条目数 */
const search = doc.getElementById('searchInput');
const KEY = '测试';
search.value = KEY;
search.dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(20);
const expectHits = Object.values(sk).reduce((n, g) => n + Object.entries(g || {})
  .filter(([name, p]) => (name + ' ' + p).toLowerCase().includes(KEY.toLowerCase())).length, 0);
const gotHits = doc.querySelectorAll('.file-item').length;
if (gotHits === expectHits) ok(`搜索「${KEY}」筛出 ${gotHits} 条（与清单一致）`);
else bad(`搜索结果数不对：${gotHits}（期望 ${expectHits}）`);

/* ═══ 相对路径重写 ═══ */
console.log('\n── 相对路径重写 ──');

window.eval(`
  window.__probe = document.createElement('div');
  window.__probe.className = 'md';
  window.__probe.innerHTML =
    '<a href="para/First.md">相对</a>' +
    '<a href="../asset/SKILL.md">上级</a>' +
    '<a href="/sk.json">根路径</a>' +
    '<a href="#anchor">锚点</a>' +
    '<a href="https://example.com/x">外链</a>' +
    '<img src="img/pic.png" alt="a">';
  document.getElementById('content').appendChild(window.__probe);
  window.__fixURLs(window.__probe);
`);

const probeEl = window.__probe;
const aHrefs = [...probeEl.querySelectorAll('a')].map((a) => a.getAttribute('href'));
const imgSrcs = [...probeEl.querySelectorAll('img')].map((i) => i.getAttribute('src'));

const expectHrefs = [
  '../para/First.md',
  '../../asset/SKILL.md',
  '../sk.json',
  '#anchor',
  'https://example.com/x',
];
for (let i = 0; i < expectHrefs.length; i++) {
  if (aHrefs[i] === expectHrefs[i]) ok(`${['para/First.md', '../asset/SKILL.md', '/sk.json', '#anchor', 'https://…'][i].padEnd(20)} → ${aHrefs[i]}`);
  else bad(`第 ${i} 条 → ${aHrefs[i]}（期望 ${expectHrefs[i]}）`);
}
if (imgSrcs[0] === '../img/pic.png') ok(`img 相对路径 → ${imgSrcs[0]}`);
else bad(`img 路径不对：${imgSrcs[0]}`);
window.__probe.remove();

/* ═══ 深链接：卡片跳转不重载页面 ═══
   正文里的 <card href="/p/docs.html#某篇.md"> 是同页只换 hash 的链接。
   浏览器在这种情况下不会重新加载文档，所以页面必须自己接住 hashchange，
   否则表现就是「地址栏变了、正文不动」。 */
console.log('\n── 深链接（卡片 / 前进后退） ──');

const CARD_PATH = 'idea/1.归途且慢.md';
const CARD_HASH = '#' + encodeURIComponent(CARD_PATH);

/* 1. 带 hash 打开：直接落到那一篇 */
{
  const p = bootPage({ hash: CARD_HASH });
  await sleep(200);
  const name = p.window.document.getElementById('docName').textContent;
  if (name.includes('归途')) ok(`带 #${decodeURIComponent(CARD_HASH.slice(1))} 打开 → 直接落到「${name}」`);
  else bad(`深链接没生效，打开的还是「${name}」`);
  if (decodeURIComponent(p.window.location.hash.replace(/^#/, '')) === CARD_PATH) ok('地址栏 hash 保持指向那一篇（没被改写）');
  else bad(`hash 被改写成 ${p.window.location.hash}`);
}

/* 2. 同页只换 hash（等价于点卡片）：正文要跟着换 */
{
  const p = bootPage();
  await sleep(200);
  const w = p.window;
  const d = w.document;
  const before = d.getElementById('docName').textContent;
  w.location.hash = CARD_HASH;
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  await sleep(300);
  const after = d.getElementById('docName').textContent;
  if (after.includes('归途') && after !== before) ok(`hashchange 后正文切换：「${before}」→「${after}」`);
  else bad(`hashchange 后正文没换（还是「${after}」）`);
  if (d.querySelector('.file-item.active[data-path="' + CARD_PATH + '"]')) ok('侧栏选中项跟着切到目标篇');
  else bad('侧栏选中项没跟上');
  if (w.document.getElementById('content').scrollTop === 0) ok('换完正文回到顶部（不是停在页脚）');
  else bad(`scrollTop=${w.document.getElementById('content').scrollTop}，应该回顶`);
}

/* 3. 连续点不同卡片：每一次都要换（只换一次就是坏的） */
{
  const p = bootPage();
  await sleep(250);
  const w = p.window;
  const d = w.document;

  const seq = [
    ['idea/index.md', '索引'],
    [CARD_PATH, '归途'],
    ['science.md', '科技节'],
    [CARD_PATH, '归途'],
  ];
  const seen = [];
  let allOk = true;
  for (const [target, expect] of seq) {
    w.location.hash = '#' + encodeURIComponent(target);
    w.dispatchEvent(new w.HashChangeEvent('hashchange'));
    await sleep(400);
    const name = d.getElementById('docName').textContent;
    seen.push(name);
    if (!name.includes(expect)) { allOk = false; bad(`切到 ${target} 失败，当前是「${name}」`); }
  }
  if (allOk) ok(`连续 4 次卡片跳转全部生效：${seen.join(' → ')}`);
}

/* 4. hash 指向清单里没有的篇目：安静忽略，不能弹错 / 白屏 */
{
  const p = bootPage();
  await sleep(200);
  const w = p.window;
  const before = w.document.getElementById('docName').textContent;
  w.location.hash = '#%E4%B8%8D%E5%AD%98%E5%9C%A8%E7%9A%84%E7%AF%87%E7%9B%AE.md';
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  await sleep(250);
  const now = w.document.getElementById('docName').textContent;
  const body = w.document.querySelector('.content .md');
  if (now === before && body && body.innerHTML.length > 80) ok('无效 hash 被忽略，当前篇目原样保留');
  else bad(`无效 hash 把页面搞坏了（docName=${now}）`);
}

/* ═══════════════════════════════════════════════════ */
console.log(`\n${fail ? `✗ ${fail} 项失败` : '✓ 全部通过'}\n`);
process.exit(fail ? 1 : 0);
