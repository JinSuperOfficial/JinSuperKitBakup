/**
 * 样式与字体产物
 * ---------------------------------------------------
 * 组成：
 *   1. KaTeX 官方样式（精简版：只留 woff2 的 @font-face + 排版规则）
 *   2. 原有 p/docs-md.css 的扩展元素样式
 *   3. 本次新增的样式（剧透块 / 已砍掉的 Mermaid 的降级提示）
 *
 * 产出：
 *   p/docs-md.css        —— 单一样式文件，页面只引这一个
 *   p/fonts/*.woff2      —— KaTeX 数学字体，本地自托管
 *
 * 字体为什么不能省：KaTeX 的 HTML 渲染层依赖这些度量字体，
 * 缺了它公式会错位。woff2 全部加起来只有 254KB，比任何 CDN 往返都便宜。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/* 卡片插件是 CommonJS，ESM 里要用 createRequire 拿它 */
const require = createRequire(import.meta.url);

const KATEX_DIST = 'node_modules/katex/dist';

/** KaTeX 字体路径：css 在 p/，字体在 p/fonts/ */
const FONT_DIR = 'fonts';

function readKatexCss(root) {
  const cssPath = path.join(root, KATEX_DIST, 'katex.css');
  return fs.readFileSync(cssPath, 'utf8');
}

/**
 * 精简 KaTeX 样式：
 *   · 丢掉 woff / ttf 两套 @font-face（只留 woff2，现代浏览器全支持）
 *   · src 里剩下的 woff / ttf 回退地址一并删掉，
 *     因为产物只拷 woff2，留着就是 40 个 404
 *   · fonts/ 路径改成 ./fonts/
 */
function slimKatexCss(css) {
  let out = css;

  /* 删掉 src 里没有 woff2 的 @font-face 整块 */
  out = out.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    if (/\.woff2["')]/.test(block)) return block;
    return '';
  });

  /* 只留 woff2 那一段 src */
  out = out.replace(
    /src:\s*url\(([^)]*\.woff2)\)\s*format\((["'])woff2\2\)[^;]*;/g,
    'src: url($1) format("woff2");',
  );

  /* 路径改为相对当前样式表 */
  out = out.replace(/url\((["']?)fonts\//g, `url($1./${FONT_DIR}/`);

  /* 压掉多余空行 */
  out = out.replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

/** 拷 woff2 字体 */
function copyFonts(root, siteRoot) {
  const from = path.join(root, KATEX_DIST, 'fonts');
  const to = path.join(siteRoot, 'p', FONT_DIR);
  fs.mkdirSync(to, { recursive: true });

  let count = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(from)) {
    if (!name.endsWith('.woff2')) continue;
    const buf = fs.readFileSync(path.join(from, name));
    fs.writeFileSync(path.join(to, name), buf);
    count++;
    bytes += buf.length;
  }
  return { count, bytes };
}

/** 原有扩展元素样式：清掉 Mermaid 相关段落 */
function readDocCss(root) {
  let css = fs.readFileSync(path.join(root, 'template', 'docs-md.css'), 'utf8');

  /* Mermaid 已砍掉，相关规则块整个移除 */
  css = css.replace(/\/\* ── Mermaid 图表 ── \*\/[\s\S]*?(?=\/\* ── 表情 ── \*\/)/, '');

  return css.trim();
}

/** 本次新增的样式 */
function extraCss() {
  return `
/* ═══════════════════════════════════════════════════
   markdown-it-texmath 的外层标签
   ---------------------------------------------------
   它不是官方插件，输出会多包一层 <eq>（行内）/<eqn>（块级）。
   这两个标签不在 KaTeX 官方样式表里，不给规则的话
   块级公式在某些浏览器上会被当成行内元素，导致不居中、左右贴边。
   ═══════════════════════════════════════════════════ */
.md eq{
  display:inline;
}
.md eqn{
  display:block;
  text-align:center;
  margin:1.35em 0;
}
.md eqn > .katex-display{
  margin:0;
}
/* 公式里的错误提示（throwOnError:false 时 KaTeX 会输出红色源码） */
.md .katex-error{
  color:var(--accent);
}

/* ═══════════════════════════════════════════════════
   剧透块  >! 内容
   与行内 !!剧透!! 的区别：这是块级、默认折起、可键盘操作
   ═══════════════════════════════════════════════════ */
.md .md-spoiler{
  margin:1.2em 0;
  border:1px solid var(--line);
  border-left:3px solid var(--accent-line);
  border-radius:0 var(--radius-card) var(--radius-card) 0;
  overflow:hidden;
  background:color-mix(in srgb,var(--ink) 3%,transparent);
}
.md .md-spoiler-head{
  display:flex;align-items:center;gap:8px;
  width:100%;
  padding:9px 14px;
  margin:0;
  border:0;
  background:transparent;
  color:var(--dim);
  font-family:var(--mono);font-size:12px;
  text-align:left;
  cursor:pointer;
  transition:color .14s var(--ease),background .14s var(--ease);
}
.md .md-spoiler-head:hover{
  color:var(--ink);
  background:color-mix(in srgb,var(--ink) 5%,transparent);
}
.md .md-spoiler-head:active{ transform:translateY(1px) }
.md .md-spoiler-head:focus-visible{ outline:2px solid var(--accent);outline-offset:-2px }
.md .md-spoiler-mark{
  flex:none;
  width:15px;height:15px;
  display:grid;place-items:center;
  border-radius:var(--radius-badge);
  border:1px solid var(--accent-line);
  background:var(--accent-soft);
  color:var(--accent);
  font-size:10px;font-weight:700;line-height:1;
}
.md .md-spoiler-body{
  display:none;
  padding:2px 16px 12px;
  border-top:1px solid var(--line-soft);
}
.md .md-spoiler-body > :first-child{ margin-top:.8em }
.md .md-spoiler-body > :last-child{ margin-bottom:0 }
.md .md-spoiler[data-open="true"] .md-spoiler-body{ display:block }
.md .md-spoiler[data-open="true"] .md-spoiler-head{ color:var(--ink) }
.md .md-spoiler[data-open="true"] .md-spoiler-mark::before{ content:'−' }
.md .md-spoiler[data-open="false"] .md-spoiler-mark::before,
.md .md-spoiler:not([data-open]) .md-spoiler-mark::before{ content:'!' }

/* ═══════════════════════════════════════════════════
   告示（> [!NOTE]）的自定义名字
   ---------------------------------------------------
   写了名字 → 标题行显示你写的；没写 → 不画标题行，
   只剩内容 + 左侧色条。类型仍通过 aria-label 暴露给读屏。
   ═══════════════════════════════════════════════════ */
.md .markdown-alert[data-untitled="true"]{
  padding-top:13px;
  padding-bottom:13px;
}
.md .markdown-alert[data-untitled="true"] > :first-child{ margin-top:0 }
.md .markdown-alert[data-untitled="true"] > :last-child{ margin-bottom:0 }

/* ═══════════════════════════════════════════════════
   代码组 ::: code-group
   ---------------------------------------------------
   结构由渲染器输出（.code-group > .cg-tabs + .cg-body > .cg-panel*），
   标签按钮由客户端按真实面板数生成。
   ═══════════════════════════════════════════════════ */
.md .code-group{
  margin:1.2em 0;
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  overflow:hidden;
  background:var(--md-code-bg);
}
.md .cg-tabs{
  display:flex;
  flex-wrap:wrap;
  gap:2px;
  padding:6px 8px 0;
  border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--ink) 3%,transparent);
}
.md .cg-tab{
  padding:6px 12px;
  border:0;
  border-bottom:2px solid transparent;
  background:transparent;
  color:var(--dim);
  font-family:var(--mono);
  font-size:12px;
  cursor:pointer;
  border-radius:var(--radius-xs) var(--radius-xs) 0 0;
  transition:color .14s var(--ease),border-color .14s var(--ease),background .14s var(--ease);
}
.md .cg-tab:hover{
  color:var(--ink);
  background:color-mix(in srgb,var(--ink) 5%,transparent);
}
.md .cg-tab:focus-visible{
  outline:2px solid var(--accent);
  outline-offset:-2px;
}
.md .cg-tab.is-active{
  color:var(--accent);
  border-bottom-color:var(--accent);
}
/* 面板：JS 没跑起来时第一个也是显示的，不会整块空白 */
.md .cg-panel[hidden]{ display:none }
.md .cg-panel > pre{
  margin:0;
  border:0;
  border-radius:0;
  background:transparent;
}
/* 一组里只有一个代码块时，标签行没意义，藏掉 */
.md .code-group[data-single="true"] .cg-tabs{ display:none }

/* ═══════════════════════════════════════════════════
   标签页 ::: tabs / @tab（@mdit/plugin-tab）
   ---------------------------------------------------
   渲染器输出：
     .tabs-tabs-wrapper[data-single]
       .tabs-tabs-header > button.tabs-tab-button(.active)
       .tabs-tabs-container > .tabs-tab-content(.active)
   类名沿用插件的默认约定，方便它对外的客户端脚本也能用。

   注意：插件自带的 tab.css 是一套写死的浅色（#f8fafc / #64748b / #2563eb），
   在暗色主题下对比度直接不合格，所以这里不用它的样式表，
   全部走本站在用的主题变量（--line / --ink / --dim / --accent）。
   ═══════════════════════════════════════════════════ */
.md .tabs-tabs-wrapper{
  margin:1.2em 0;
  border:1px solid var(--line);
  border-radius:var(--radius-card);
  overflow:hidden;
  background:color-mix(in srgb,var(--ink) 2%,transparent);
}
.md .tabs-tabs-header{
  display:flex;
  flex-wrap:wrap;
  gap:2px;
  padding:6px 8px 0;
  border-bottom:1px solid var(--line);
  background:color-mix(in srgb,var(--ink) 4%,transparent);
}
.md .tabs-tab-button{
  padding:6px 12px;
  border:0;
  border-bottom:2px solid transparent;
  border-radius:var(--radius-xs) var(--radius-xs) 0 0;
  background:transparent;
  color:var(--dim);
  font-family:inherit;
  font-size:13px;
  font-weight:500;
  line-height:1.5;
  white-space:nowrap;
  cursor:pointer;
  transition:color .14s var(--ease),border-color .14s var(--ease),background .14s var(--ease);
}
.md .tabs-tab-button code{
  font-size:.92em;
  padding:1px 4px;
  border-radius:var(--radius-badge);
  background:color-mix(in srgb,var(--ink) 8%,transparent);
}
.md .tabs-tab-button:hover{
  color:var(--ink);
  background:color-mix(in srgb,var(--ink) 6%,transparent);
}
.md .tabs-tab-button:focus-visible{
  outline:2px solid var(--accent);
  outline-offset:-2px;
}
.md .tabs-tab-button.active{
  color:var(--accent);
  border-bottom-color:var(--accent);
}
.md .tabs-tabs-container{ padding:14px 16px }
/* 只靠 .active 控制显隐（不用 hidden）：
   这样官方 register-tab 客户端脚本切 .active 时也是对的。
   渲染期一定会有一个 .active，所以没有 JS 也看得见内容。 */
.md .tabs-tab-content{ display:none }
.md .tabs-tab-content.active{ display:block }
.md .tabs-tab-content > :first-child{ margin-top:0 }
.md .tabs-tab-content > :last-child{ margin-bottom:0 }
/* 只有一个标签页时标签行没意义 */
.md .tabs-tabs-wrapper[data-single="true"] .tabs-tabs-header{ display:none }

/* ═══════════════════════════════════════════════════
   代码块复制按钮
   ---------------------------------------------------
   由客户端 addCodeCopyButtons() 插进每个 <pre>。
   图标来自 asset/icon/file-copy-fill.svg（常态）
   和 file-copy.svg（悬停/聚焦）—— 内联成 SVG，
   这样 fill:currentColor 能跟着主题色走。
   图标取不到就退回「复制」文字，功能不受影响。
   ═══════════════════════════════════════════════════ */
.md pre{ position:relative }
.md pre > .code-copy{
  position:absolute;
  top:8px; right:8px;          /* 比原来略微内收一点 */
  z-index:2;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:4px;
  min-width:26px;
  height:26px;
  padding:0 7px;
  border:1px solid transparent;
  border-radius:var(--radius-control);
  background:transparent;
  color:var(--faint);
  font-family:var(--mono);
  font-size:11px;
  line-height:1;
  cursor:pointer;
  opacity:.45;
  transition:opacity .14s var(--ease), color .14s var(--ease),
             background .14s var(--ease), border-color .14s var(--ease),
             transform .1s var(--ease);
}
.md pre:hover > .code-copy{ opacity:1 }

/* 有图标时：常态显示填充版，悬停/聚焦换成描边版 */
.md pre > .code-copy.with-icon{ padding:0 }
.md pre > .code-copy .cc-ico{
  display:flex; align-items:center; justify-content:center;
  width:15px; height:15px;
}
.md pre > .code-copy .cc-ico svg{
  width:15px; height:15px; display:block;
  fill:currentColor;
}
.md pre > .code-copy .cc-ico-line{ display:none }
.md pre > .code-copy.with-icon:hover .cc-ico-fill,
.md pre > .code-copy.with-icon:focus-visible .cc-ico-fill{ display:none }
.md pre > .code-copy.with-icon:hover .cc-ico-line,
.md pre > .code-copy.with-icon:focus-visible .cc-ico-line{ display:flex }

.md pre > .code-copy:hover{
  color:var(--ink);
  border-color:var(--line);
  background:color-mix(in srgb,var(--ink) 7%,transparent);
}
.md pre > .code-copy:focus-visible{
  opacity:1;
  outline:2px solid var(--accent);
  outline-offset:2px;
}
.md pre > .code-copy:active{ transform:scale(.92) }

/* 复制成功 / 失败：颜色变化，不靠文字 */
.md pre > .code-copy.ok{
  opacity:1;
  color:var(--accent);
  border-color:var(--accent-line);
  background:var(--accent-soft);
}
.md pre > .code-copy.err{
  opacity:1;
  color:#D9605A;
  border-color:rgba(217,96,90,.4);
  background:color-mix(in srgb,#D9605A 10%,transparent);
}

/* 触摸设备没有 hover，按钮必须常显，否则点不到 */
@media (hover:none){
  .md pre > .code-copy{ opacity:1 }
}

/* ═══════════════════════════════════════════════════
   已砍掉的图表语法降级
   mermaid / plantuml / flow / echarts 这几类围栏现在就是普通代码块
   ═══════════════════════════════════════════════════ */
.md .md-chart-off{
  margin:-0.9em 0 1.4em;
  font-family:var(--mono);font-size:11.5px;
  color:var(--faint);
}

/* ═══════════════════════════════════════════════════
   顶栏 static 角标：说明这是预渲染的静态页面
   ═══════════════════════════════════════════════════ */
.load-badge.static,
.load-badge[title*="预渲染"]{
  cursor:default;
  font-family:var(--mono);
}
.load-badge[title*="预渲染"] .load-dot{
  animation:none;
  opacity:.9;
}
`;
}

/**
 * 卡片样式：直接问插件要（docs-card.cjs 是 p/docs-card.js 的同步副本，
 * 构建时由 build.mjs 复制过来）。拿不到就返回空，不影响其余样式。
 *
 * 插件自己在浏览器里也会往 <head> 注入一份（同样内容，有 id 去重），
 * 这里内联进来是为了让预渲染稿在首屏就有样式，不闪一下。
 */
function readCardCss(root) {
  try {
    const mod = require(path.join(root, 'lib', 'docs-card.cjs'));
    const api = mod && mod.default ? mod.default : mod;
    return api && typeof api.css === 'string' ? api.css.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 正文排版：从 build/template/docs-content.css 读（阅读器与静态文章页共用）。
 *
 * 以前这一份住在 build/template/docs.html 的 <style> 里，只有阅读器吃得到 ——
 * 归档产物和 /p/post/ 的静态文章页都是独立页面，只引 docs-md.css，
 * 于是标题、表格、代码块全是浏览器默认样式。现在并到这里，谁引谁有。
 */
function readContentCss(root) {
  try {
    return fs.readFileSync(path.join(root, 'template', 'docs-content.css'), 'utf8').trim();
  } catch (e) {
    /* 缺文件不该让构建挂掉，但必须吼一声 —— 缺了它正文会退回浏览器默认排版 */
    console.warn('  ⚠ 没找到 build/template/docs-content.css：' + (e && e.message ? e.message : e));
    return '';
  }
}

/**
 * 生成完整样式并落盘
 * @returns {{ bytes:number, fontCount:number, fontBytes:number }}
 */
export function buildDocsCss({ root, siteRoot }) {
  const katex = slimKatexCss(readKatexCss(root));
  const doc = readDocCss(root);
  const extra = extraCss();
  const card = readCardCss(root);
  const content = readContentCss(root);

  const header = `/* ═══════════════════════════════════════════════════
   文档站样式 · 由 build/lib/css.mjs 生成，请勿手改
   组成：KaTeX 数学排版 + 扩展元素样式 + 剧透块 + 卡片 + 正文排版
   字体：./fonts/ 本地自托管，无任何 CDN
   ═══════════════════════════════════════════════════ */

/* ─────────── 1. KaTeX（精简：仅 woff2） ─────────── */
`;

  const mid = `

/* ─────────── 2. 扩展元素样式 ─────────── */
`;

  const tail = `

/* ─────────── 3. 新增样式 ─────────── */
`;

  const cardBlock = card
    ? `

/* ─────────── 4. 卡片（来自 p/docs-card.js） ─────────── */
${card}
`
    : '';

  /* 正文排版放在最后：它以前待在 docs.html 的行内 <style> 里，
     位置就在 docs-md.css 之后；保持这个先后关系，层叠结果才不会变。 */
  const contentBlock = content
    ? `

/* ─────────── 5. 正文排版（阅读器 / 静态文章页共用） ─────────── */
${content}
`
    : '';

  const css = header + katex + mid + doc + tail + extra + cardBlock + contentBlock;
  const outPath = path.join(siteRoot, 'p', 'docs-md.css');
  fs.writeFileSync(outPath, css, 'utf8');

  const fonts = copyFonts(root, siteRoot);

  return {
    bytes: Buffer.byteLength(css, 'utf8'),
    text: css,
    fontCount: fonts.count,
    fontBytes: fonts.bytes,
  };
}
