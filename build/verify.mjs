/**
 * 产物自检：不依赖浏览器，把生成页面的「结构性错误」挑出来。
 *
 * 新架构下页面长这样：
 *   · 内联一份 sk.json 兜底 + 预渲染稿（只有 TEST.md 这类）
 *   · <script src="./docs-md.js">  —— 本地打包的完整渲染器
 *   · 一段内联客户端脚本，负责 fetch 清单、fetch md、调渲染器
 *
 * 检查项：
 *   1. 客户端脚本能不能被解析（语法错误 = 整页死掉）
 *   2. script 标签配对、没有未转义的 </script> 混进正文
 *   3. 引用的本地资源是否真实存在
 *   4. script 里 $('x') 引用的 id 在 HTML 里都存在吗
 *   5. querySelector 的选择器命中得到吗
 *   6. window.__SK__ 是合法 JSON 吗
 *   7. 页面有没有残留外链（CDN / preconnect）
 *   8. 字体引用是否都指向真实存在的文件
 *   9. 预渲染稿是否只有约定的那几篇
 *
 * 跑法：node verify.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDir, siteRoot, pDir } from './paths.mjs';

const here = buildDir;
const docPath = path.join(pDir, 'docs.html');
const html = fs.readFileSync(docPath, 'utf8');

let fail = 0;
let warn = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); }
function bad(msg) { console.log(`  ✗ ${msg}`); fail++; }
function meh(msg) { console.log(`  ⚠ ${msg}`); warn++; }

/* ═══ 1. 脚本语法 ═══ */
console.log('\n── 1. 客户端脚本语法 ──');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) bad('页面里一个内联 <script> 都没有');
else ok(`找到 ${scripts.length} 段内联脚本`);

/* 防回归：正文里若出现未转义的 </script>，会把后面的 HTML 吞进脚本里 */
for (const [i, s] of scripts.entries()) {
  if (/<script[\s>]/.test(s)) {
    bad(`第 ${i} 段脚本内部出现了 <script 字样，说明上游有标签没被转义`);
  }
}
const openTags = (html.match(/<script[\s>]/g) || []).length;
const closeTags = (html.match(/<\/script>/g) || []).length;
if (openTags !== closeTags) bad(`script 标签不配对：${openTags} 开 / ${closeTags} 闭`);
else ok(`script 标签配对（${openTags} 对）`);

let client = null;
for (const s of scripts) {
  /* 用只出现在客户端脚本里的标识，别误命中数据注入那段 */
  if (s.includes('INLINE_MANIFEST')) { client = s; break; }
}
if (!client) {
  bad('找不到客户端主脚本');
  client = '';
} else {
  try {
    new Function(client);
    ok(`客户端脚本语法通过（${client.length} 字符）`);
  } catch (e) {
    bad(`客户端脚本语法错误：${e.message}`);
  }
}

/* ═══ 2. 内联数据 ═══ */
console.log('\n── 2. 内联数据 ──');

let inlineSk = null;
for (const s of scripts) {
  const m = /window\.__SK__\s*=\s*([\s\S]*?);\s*(?:\n|$)/.exec(s);
  if (m) {
    try {
      inlineSk = JSON.parse(m[1]);
      const groups = Object.keys(inlineSk);
      ok(`window.__SK__ 是合法 JSON（${groups.length} 个顶层分组）`);
    } catch (e) {
      bad(`window.__SK__ JSON 解析失败：${e.message}`);
    }
    break;
  }
}
if (!inlineSk) bad('找不到 window.__SK__ 内联清单（离线兜底会用不到）');

let preRendered = null;
for (const s of scripts) {
  const m = /window\.__PRERENDERED__\s*=\s*(\{[\s\S]*?\});(?:\s*window|\s*$)/.exec(s);
  if (m) {
    try {
      preRendered = JSON.parse(m[1]);
      const keys = Object.keys(preRendered);
      ok(`window.__PRERENDERED__ 合法，预渲染 ${keys.length} 篇：${keys.join(', ') || '（无）'}`);
    } catch (e) {
      bad(`window.__PRERENDERED__ JSON 解析失败：${e.message}`);
    }
    break;
  }
}
if (!preRendered) meh('没有 window.__PRERENDERED__（全部文档都走浏览器端渲染）');

/* 预渲染稿必须和构建脚本里声明的一致 */
const buildSrc = fs.readFileSync(path.join(here, 'build.mjs'), 'utf8');
const declared = [...buildSrc.matchAll(/^\s*'([^']+\.md)',?\s*$/gm)].map((m) => m[1]);
if (preRendered) {
  const declaredSet = new Set(declared);
  const actual = Object.keys(preRendered);
  const extra = actual.filter((k) => !declaredSet.has(k));
  if (extra.length) meh(`预渲染了未声明的文档：${extra.join(', ')}`);
  else ok('预渲染清单与构建脚本声明一致');
}

/* ═══ 3. 本地资源引用 ═══ */
console.log('\n── 3. 本地资源 ──');

const assets = [...html.matchAll(/<(?:link|script)[^>]*(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^https?:|^data:/.test(u));

if (assets.length) {
  for (const a of assets) {
    const rel = a.split('?')[0].replace(/^\.\//, '');
    const f = path.join(pDir, rel);
    if (fs.existsSync(f)) ok(`${a} 存在（${(fs.statSync(f).size / 1024).toFixed(0)} KB）`);
    else bad(`${a} 不存在`);
  }
} else {
  meh('页面没有引用任何本地资源文件');
}

/* 必须有渲染器 */
if (/src="\.\/docs-md\.js/.test(html)) ok('引用了本地渲染器 docs-md.js');
else bad('没有引用 docs-md.js，浏览器端将无法渲染 Markdown');

/* ═══ 4. $('id') 引用 ═══ */
console.log('\n── 4. 元素 id 引用 ──');

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const refIds = new Set([...client.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

const missingIds = [...refIds].filter((id) => !htmlIds.has(id));
if (missingIds.length) bad(`脚本引用了不存在的 id：${missingIds.join(', ')}`);
else ok(`${refIds.size} 个 id 引用全部命中`);

/* ═══ 5. querySelector 选择器 ═══ */
console.log('\n── 5. 选择器引用 ──');

const selectors = new Set(
  [...client.matchAll(/querySelector(?:All)?\(\s*'([^']+)'/g)].map((m) => m[1]),
);

function selectorLikelyHits(sel) {
  const cls = /\.([a-zA-Z][\w-]*)/.exec(sel);
  if (cls) return new RegExp(`class="[^"]*\\b${cls[1]}\\b`).test(html);
  const tag = /^([a-z][a-z0-9]*)/.exec(sel);
  if (tag) return new RegExp(`<${tag[1]}[\\s>]`).test(html);
  return true;
}

const ghostSelectors = [...selectors].filter((s) => !selectorLikelyHits(s));
if (ghostSelectors.length) meh(`这些选择器在静态 HTML 里找不到对应元素（可能是运行时才生成的）：${ghostSelectors.join(' | ')}`);
else ok(`${selectors.size} 个选择器都有对应元素`);

/* ═══ 6. 外链残留 ═══ */
console.log('\n── 6. 外链残留 ──');

const cdnPatterns = [
  [/cdn\.jsdelivr/, 'jsdelivr'],
  [/unpkg\.com/, 'unpkg'],
  [/cdnjs\.cloudflare/, 'cdnjs'],
  [/<link[^>]+preconnect/, 'preconnect'],
  [/<link[^>]+dns-prefetch/, 'dns-prefetch'],
  [/<script[^>]+src="https?:/, '外链 script'],
  [/<link[^>]+href="https?:[^"]*\.css/, '外链 css'],
  [/base64/, 'base64（平台硬规则禁止）'],
];
for (const [re, name] of cdnPatterns) {
  if (re.test(html)) bad(`发现外链：${name}`);
}
if (!cdnPatterns.some(([re]) => re.test(html))) ok('没有任何外链资源，也没有 base64');

/* ═══ 7. 字体与样式 ═══ */
console.log('\n── 7. 样式与字体 ──');

const cssPath = path.join(pDir, 'docs-md.css');
const css = fs.readFileSync(cssPath, 'utf8');
const fontRefs = [...css.matchAll(/url\(\.?\/?(fonts\/[^)]+)\)/g)].map((m) => m[1]);
const missingFonts = [...new Set(fontRefs)].filter(
  (f) => !fs.existsSync(path.join(pDir, f)),
);
if (missingFonts.length) bad(`CSS 引用了不存在的字体：${missingFonts.join(', ')}`);
else ok(`字体引用 ${new Set(fontRefs).size} 个，全部存在`);

if (/base64/.test(css)) bad('样式里出现 base64');
else ok('样式无 base64');

if (/\.woff\)|\.ttf\)/.test(css)) meh('CSS 里还有 woff/ttf 回退（那些文件没随产物拷贝）');
else ok('CSS 只引用 woff2');

/* KaTeX 样式必须在，否则公式会散架 */
if (/katex/.test(css)) ok('KaTeX 样式已就位（公式排版需要）');
else bad('缺少 KaTeX 样式，公式会排版错乱');

/* ═══ 8. 关键结构 ═══ */
console.log('\n── 8. 关键结构 ──');

const struct = [
  [/<noscript>[\s\S]*?<\/noscript>/, 'noscript 兜底'],
  [/<span class="load-badge on"[\s\S]*?>static<\/span>/, 'static 角标'],
  [/href="\.\/docs-md\.css/, '本地样式表引用'],
  [/<meta name="viewport"/, 'viewport'],
  [/prefers-reduced-motion/, 'reduced-motion 支持'],
];
for (const [re, name] of struct) {
  if (re.test(html)) ok(name);
  else bad(`缺少：${name}`);
}

if (/renderMarkdownBuiltin|fetchDoc|MANIFEST_URL/.test(html)) bad('旧的客户端渲染逻辑还在页面里');
else ok('旧渲染逻辑已清除');

if (/raw\.php/.test(html)) meh('页面里提到了 raw.php（作为可选回退，装了就用）');
else ok('页面不依赖 raw.php');

/* ═══ 9. favicon ═══ */
console.log('\n── 9. favicon ──');

if (/__FAVICON__/.test(html)) bad('模板占位符 __FAVICON__ 没被替换');
else ok('favicon 占位符已替换');

const iconLinks = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
  .map((m) => m[1]);
if (iconLinks.length) {
  ok(`favicon 链接 ${iconLinks.length} 个：${iconLinks.join(', ')}`);
  for (const href of iconLinks) {
    if (/^data:/.test(href)) { bad('favicon 用了 base64（平台禁止）'); continue; }
    const f = path.resolve(pDir, href);
    if (fs.existsSync(f)) ok(`  ${href} 存在（${fs.statSync(f).size} B）`);
    else bad(`  ${href} 不存在`);
  }
} else {
  bad('页面里没有 favicon 链接');
}

/* 站点根的两个图标文件要在（现在是 SVG，不再是之前的 PNG 头像） */
for (const f of ['favicon.svg', 'apple-touch-icon.svg']) {
  const p = path.join(siteRoot, f);
  if (fs.existsSync(p)) ok(`${f} 在站点根（${(fs.statSync(p).size / 1024).toFixed(1)} KB）`);
  else meh(`${f} 缺失（跑 node make-favicon.mjs 生成）`);
}

/* 旧的 PNG 头像图标不该再被任何页面引用 */
for (const f of ['favicon.png', 'apple-touch-icon.png']) {
  const p = path.join(siteRoot, f);
  if (!fs.existsSync(p)) ok(`${f} 已移除`);
  else meh(`${f} 还留在站点根，但已无页面引用，可以删掉`);
}

/* ═══ 汇总 ═══ */
console.log(`\n${fail ? `✗ ${fail} 项失败` : '✓ 全部通过'}${warn ? `，${warn} 项提示` : ''}\n`);
process.exit(fail ? 1 : 0);
