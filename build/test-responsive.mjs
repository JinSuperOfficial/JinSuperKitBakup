#!/usr/bin/env node
/**
 * build/test-responsive.mjs —— 响应式与触摸目标的静态断言
 * ===========================================================
 * 「布局对不对」这件事 jsdom 测不了（它不算布局），真正要靠人眼在几个视口下对照截图。
 * 所以这一套只钉**能从源码里查证的东西** —— 恰恰也是最容易被以后改回去的东西：
 *
 *   ① 每个页面都有 viewport meta，且带 `viewport-fit=cover`（吃满刘海屏安全区）
 *   ② 移动端断点确实存在（`@media (max-width: 767px)` / `1023px` / `400px`）
 *   ③ 新增的响应式规则里用了 `env(safe-area-inset-*)`（底部固定元素必须留位）
 *   ④ 触摸目标：可点元素的最小高度不是 30px 这种「手指点不到」的值
 *   ⑤ **没有横向溢出的常见写法**：不出现 `width:100vw`（会带出横向滚动条）
 *   ⑥ 页面 CSS 里没写死十六进制颜色（颜色一律走 token，否则亮色模式会花一块）
 *
 * 不测的（写在这里免得以后有人以为是漏了）：
 *   · 真实布局 / 折行 / 溢出 —— jsdom 不支持
 *   · 桌面端「逐像素不变」 —— 靠人眼对照 `docs/responsive/` 里的截图
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = path.join(ROOT, 'jinsuper.rth1.xyz');

/** 站点页面（会被上传的那些） */
const SITE_PAGES = [
  'index.html',
  '404.html',
  'Skills/index.html',
  'class/index.html',
  'class/homework.html',
  'class/english.html',
  'class/classtable.html',
  'class/run.html',
];

/**
 * 构建模板。
 * 这些不是产物，是**源头** —— 改产物会被下次构建冲掉（PROJECT.md §10.1）。
 * 只查它们有没有把响应式规则带上（模板的结构和站点页面不完全一样，
 * 所以只跑最普适的那几条断言）。
 */
const TEMPLATES = [
  'build/template/docs.html',
  'build/template/blog.html',
  'build/template/post.html',
  'build/template/post-chrome.css',
  'build/template/docs-md.css',
];

/** 需要补移动端的断点（统一口径，别各写各的） */
const BREAKPOINTS = ['767px', '1023px', '400px'];

function read(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `文件不存在：${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function styleOf(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}

/* ═══════════════ ① viewport meta ═══════════════ */

test('每个站点页面都有 viewport meta，且带 viewport-fit=cover', () => {
  for (const rel of SITE_PAGES) {
    const html = read(path.join(SITE, rel));
    const m = html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']*)["']/i);
    assert.ok(m, `${rel}：没有 viewport meta`);
    const content = m[1];
    assert.ok(/width=device-width/.test(content), `${rel}：viewport 里没有 width=device-width`);
    assert.ok(/initial-scale=1/.test(content), `${rel}：viewport 里没有 initial-scale=1`);
    assert.ok(
      /viewport-fit=cover/.test(content),
      `${rel}：viewport 缺 viewport-fit=cover（刘海屏安全区吃不满）`,
    );
  }
});

test('构建模板也带 viewport-fit=cover', () => {
  for (const rel of ['build/template/docs.html', 'build/template/blog.html', 'build/template/post.html']) {
    const html = read(rel);
    const m = html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']*)["']/i);
    assert.ok(m, `${rel}：没有 viewport meta`);
    assert.ok(/viewport-fit=cover/.test(m[1]), `${rel}：viewport 缺 viewport-fit=cover`);
  }
});

/* ═══════════════ ② 断点 ═══════════════ */

/**
 * 这个页面在**源码里**（HTML 的 style 块或它引用的 css）出现了哪些断点。
 * 只认 `max-width` 那条 —— 我们一律用 max-width 覆盖，桌面端才不会被改到。
 */
function breakpointsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/@media[^{]*max-width\s*:\s*(\d+)px/gi)) found.add(`${m[1]}px`);
  return found;
}

test('每个站点页面的 CSS 里有手机断点（max-width: 767px 那一档）', () => {
  for (const rel of SITE_PAGES) {
    const html = read(path.join(SITE, rel));
    const css = styleOf(html);
    const bp = breakpointsIn(css);
    /* 各页既有断点不完全一样（历史上就是 640 / 560 / 760 混着），
       所以这里只要求**至少有一个 <= 767px 的 max-width 断点** ——
       这一档是「手机」那条线，没有它就等于没做移动端。 */
    const hasMobile = [...bp].some((b) => parseInt(b, 10) <= 767);
    assert.ok(
      hasMobile,
      `${rel}：没有任何 <=767px 的 max-width 断点（实际：${[...bp].join(', ') || '没有'}）`,
    );
  }
});

test('重点页面（作业页）三档断点齐全：1023 / 767 / 400', () => {
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  const bp = breakpointsIn(css);
  for (const want of BREAKPOINTS) {
    assert.ok(bp.has(want), `class/homework.html 缺 @media (max-width: ${want})`);
  }
});

test('桌面模板的响应式规则只用 max-width（不许出现 min-width 覆盖）', () => {
  for (const rel of ['build/template/post-chrome.css', 'build/template/docs-md.css']) {
    const css = read(rel);
    const minWidths = [...css.matchAll(/@media[^{]*min-width\s*:\s*(\d+)px/gi)].map((m) => m[1]);
    assert.deepEqual(
      minWidths,
      [],
      `${rel}：出现了 min-width 断点（${minWidths.join(', ')}）—— 一律用 max-width 覆盖，` +
        'min-width 会把桌面端一起改到',
    );
  }
});

/* ═══════════════ ③ 安全区 ═══════════════ */

test('底部固定元素用了 env(safe-area-inset-bottom)', () => {
  /* 作业页有底部动作面板、听力页有迷你播放条 —— 这两个必须给 home 指示条留位 */
  for (const rel of ['class/homework.html', 'class/english.html']) {
    const css = styleOf(read(path.join(SITE, rel)));
    assert.ok(
      /env\(\s*safe-area-inset-bottom/.test(css),
      `${rel}：底部固定元素没有用 env(safe-area-inset-bottom)`,
    );
  }
});

test('页面留白用 env(safe-area-inset-left/right)', () => {
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  assert.ok(/env\(\s*safe-area-inset-left/.test(css), 'homework.html 缺 safe-area-inset-left');
  assert.ok(/env\(\s*safe-area-inset-right/.test(css), 'homework.html 缺 safe-area-inset-right');
});

/* ═══════════════ ④ 触摸目标 ═══════════════ */

test('手机断点里的可点元素不是「手指点不到」的高度', () => {
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  const mobile = css.slice(css.indexOf('@media (max-width:767px)'));
  assert.ok(mobile.length > 0, '找不到 767px 那一档');

  /* 顶部动作按钮 / 弹窗里的按钮 / 条目行 —— 这几类都要求 >= 48px */
  const rules = [
    { name: '.head-acts > .more-btn', re: /\.head-acts\s*>\s*\.more-btn\s*\{[^}]*min-height\s*:\s*(\d+)px/ },
    { name: '.logwin-close', re: /\.logwin-close\s*\{[^}]*height\s*:\s*(\d+)px/ },
    { name: '.hw-item', re: /\.hw-item\s*\{[^}]*min-height\s*:\s*(\d+)px/ },
  ];  for (const r of rules) {
    const m = mobile.match(r.re);
    assert.ok(m, `${r.name}：手机断点里没写 min-height/height（触摸目标要 >= 48px）`);
    assert.ok(
      parseInt(m[1], 10) >= 48,
      `${r.name}：手机上是 ${m[1]}px，小于 48px`,
    );
  }
});

/* ═══════════════ ⑤ 横向溢出 ═══════════════ */

test('没有 100vw 这种会带出横向滚动条的写法', () => {
  for (const rel of SITE_PAGES) {
    const css = styleOf(read(path.join(SITE, rel)));
    assert.ok(
      !/width\s*:\s*100vw/.test(css),
      `${rel}：出现 width:100vw（含滚动条时会横向溢出，用 100% 替）`,
    );
  }
});

/* ═══════════════ ⑥ 颜色走 token ═══════════════ */

test('新增的响应式块里没有写死的十六进制颜色', () => {
  /* 只看**响应式那一段**（本次改造加的部分）。
     整份文件里确实还有历史遗留的字面色（彩蛋两侧竖排字、暗色便签那几处），
     那些属于另一件事，不该由这个测试来管 —— 钉住「新加的别写死」才是它的职责。 */
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  const start = css.indexOf('响应式：桌面 / 平板 / 手机');
  assert.ok(start > 0, '找不到响应式段落');
  const block = css.slice(start);

  /* 定义 token 是允许的（那是唯一该写死的地方），先把自定义属性的值抠掉 */
  const withoutTokens = block.replace(/--[\w-]+\s*:[^;}]*/g, '');
  const hits = [...withoutTokens.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(
    hits,
    [],
    `响应式块里出现写死的颜色：${[...new Set(hits)].join(', ')} —— ` +
      '一律走 --tx-* / --sf-* / --bd-* 这些 token，否则亮色模式会花一块',
  );
});

test('响应式块里也没有写死 rgba 字面色', () => {
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  const block = css.slice(css.indexOf('响应式：桌面 / 平板 / 手机'));
  /* rgba(…) 里带具体数字 = 写死颜色；用 rgba(var(--accent-rgb), .1) 这种才合格。
     所以这里查的是「rgba 里第一段是数字」。 */
  const hits = [...block.matchAll(/rgba?\(\s*\d/g)].map((m) => m[0]);
  assert.deepEqual(
    hits,
    [],
    `响应式块里出现写死的 rgba 数字：${hits.length} 处`,
  );
});

/* ═══════════════ ⑦ 响应式块的存在性与可维护性 ═══════════════ */

test('作业页的响应式块集中在一个带说明的段落里', () => {
  const css = styleOf(read(path.join(SITE, 'class/homework.html')));
  assert.ok(
    /响应式：桌面 \/ 平板 \/ 手机/.test(css),
    'class/homework.html 找不到响应式段落的注释头 —— 以后的改动要能一眼找到这块',
  );
  /* 断点应当只在这一个段落里再声明一遍；散落各处会很难维护 */
  assert.ok(
    /桌面\s*≥\s*1024px|桌面\s+≥ 1024px|≥ 1024px/.test(css),
    '响应式段落里要写明断点口径（桌面 ≥1024 / 平板 768–1023 / 手机 ≤767 / 窄屏 ≤400）',
  );
});

/* ═══════════════ ⑧ 作业页手机面板（真浏览器抓出来的两个坑） ═══════════════ */

/**
 * 这两条是**真浏览器**（390×844）抓出来的，静态断言原本一条都拦不住：
 *
 *   坑① `display`：开关的基础规则是 `display:none`（桌面永不显示），
 *        手机档必须把它翻成 flex —— 漏了就是「手机上没有任何入口能打开面板」。
 *   坑② `transform` 成为 fixed 后代的包含块：面板在手机上用
 *        `transform:translate3d(0, calc(100% + 14px), 0)` 滑出屏幕，
 *        开关若留在面板里，即使 `position:fixed` 也会被钉在那条**已经移出屏幕**的
 *        坐标系里，可见面积 = 0（DevTools 报 element not visible，
 *        而源码 / 选择器 / DOM 全都正常）。
 *        所以开关必须是面板的**兄弟**（`acts.parentNode.insertBefore(btn, acts)`）。
 *
 * 这两条都无法用「布局」测（jsdom 不算布局），但可以钉住**形状**：
 * 手机档里开关的 display 必须是 flex、它不能是 .head-acts 的孩子。
 */
test('手机档里开关确实「出生」了（display 翻成 flex）', () => {
  const html = read(path.join(SITE, 'class/homework.html'));
  const css = styleOf(html);
  const at = css.indexOf('@media (max-width:767px)');
  assert.ok(at > 0, '找不到 767px 那一档');
  const mobile = css.slice(at, css.indexOf('@media (max-width:400px)'));

  const m = mobile.match(/\.acts-toggle\s*\{([^}]*)\}/);
  assert.ok(m, '手机档里没有 .acts-toggle 规则 —— 开关在手机上不会出现');
  const body = m[1];
  assert.match(
    body,
    /display\s*:\s*flex/,
    '★ 手机档里必须把 .acts-toggle 的 display 从 none 翻成 flex，' +
      '否则手机上根本没有入口能打开底部动作面板（真浏览器抓出来的坑）',
  );
  assert.match(
    body,
    /position\s*:\s*fixed/,
    '手机档里开关要 position:fixed —— 相对视口定位，不受面板位移影响',
  );
});

test('★ 开关不是面板的孩子（避开 transform 当包含块的坑）', () => {
  const html = read(path.join(SITE, 'class/homework.html'));
  const css = styleOf(html);

  /* ① 面板在手机上确实是「滑出屏幕」（有 transform）—— 这条一旦不成立，
        下面那条「开关不能在里面」的理由也就变了，所以一起钉住。 */
  const at = css.indexOf('@media (max-width:767px)');
  const mobile = css.slice(at, css.indexOf('@media (max-width:400px)'));
  const acts = mobile.match(/\.head-acts\s*\{([^}]*)\}/);
  assert.ok(acts, '手机档里没有 .head-acts 规则');
  assert.match(
    acts[1],
    /transform\s*:/,
    '手机档里面板是靠 transform 滑出屏幕的 —— 这正是「fixed 后代被它当包含块」的前提',
  );

  /* ② 所以 CSS 里不许出现 `.head-acts > .acts-toggle` 这种「孩子」写法 */
  assert.doesNotMatch(
    css,
    /\.head-acts\s*>\s*\.acts-toggle/,
    '★ 开关不能写成面板的孩子：面板带 transform，会把 position:fixed 的开关' +
      '钉在它已经移出屏幕的坐标系里，可见面积为 0（真浏览器抓出来的坑）',
  );

  /* ③ JS 里必须是插到面板前面（兄弟），不是插进面板 */
  const js = html.slice(html.indexOf('function initMobileActs'));
  assert.match(
    js,
    /(parentNode|parentElement)\.insertBefore\(btn,\s*acts\)/,
    '★ 开关要插到面板**前面**（兄弟节点），不能 acts.insertBefore(btn, acts.firstChild)',
  );
});

test('残留检查：响应式改造没有引入新的外部请求', () => {
  /* 硬规则：禁 CDN、禁外部字体。响应式改造最容易「顺手加个字体」。 */
  for (const rel of SITE_PAGES) {
    const html = read(path.join(SITE, rel));
    const externals = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)]
      .map((m) => m[1])
      /* 站点里本来就有的、指向自己域名的绝对地址允许保留 */
      .filter((u) => !/^https?:\/\/(www\.)?jinsuper\.(cn|rth1\.xyz)|^https?:\/\/jinsuperofficial\.github\.io/i.test(u));
    assert.deepEqual(
      externals,
      [],
      `${rel}：出现站外绝对地址 ${externals.join(', ')} —— 站点硬规则禁 CDN / 禁外部字体`,
    );
  }
});
