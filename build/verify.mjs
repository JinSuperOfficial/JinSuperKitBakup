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
import { decodeSitePath } from './lib/posts.mjs';

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

/* ═══ 10. 博客首页（/p/index.html）+ 文章页 ═══
   这一页是构建产出的（模板 build/template/blog.html）。
   检查点都是「少了就一定坏」的那种：导航、列表、标签筛选、时间线、RSS。 */
console.log('\n── 10. 博客首页与文章页 ──');
{
  const homePath = path.join(pDir, 'index.html');
  if (!fs.existsSync(homePath)) {
    bad('p/index.html 不存在（博客首页是构建产出的，跑 node build/build.mjs）');
  } else {
    const home = fs.readFileSync(homePath, 'utf8');
    ok(`p/index.html 在（${(fs.statSync(homePath).size / 1024).toFixed(1)} KB）`);
    const checks = [
      [/<header class="topnav">/, '顶栏'],
      [/<nav class="nav" aria-label="站点导航">[\s\S]*?时间线[\s\S]*?标签/, '顶栏导航项（时间线 / 标签）'],
      [/id="latestCards"/, '最新列表容器'],
      [/class="post-card"/, '最新卡片'],
      [/id="tagbar"/, '标签筛选栏'],
      [/class="tag-chip"[^>]*data-tag=/, '标签按钮'],
      [/id="timelineBody"/, '时间线容器'],
      [/class="tl-year"/, '时间线年份分组'],
      [/href="\.\/feed\.xml"/, 'RSS 链接'],
      [/rel="canonical" href="https:\/\/www\.jinsuper\.cn\/p\/"/, 'canonical'],
      [/application\/ld\+json/, '结构化数据'],
      [/data-tags="/, '标签筛选用的 data-tags'],
    ];
    for (const [re, label] of checks) {
      if (re.test(home)) ok(`博客首页：${label}`);
      else bad(`博客首页缺少：${label}`);
    }
    if (/__[A-Z_]+__/.test(home)) bad('博客首页里还有没替换掉的占位符');
    /* 归档稿也要在时间线 / 标签里（不能只在阅读器侧栏看得到） */
    const archivedRows = [...home.matchAll(/<li data-tags="[^"]*"[^>]*data-archived="1"/g)].length;
    if (archivedRows > 0) ok(`博客首页：时间线里有归档稿 ${archivedRows} 条`);
    else bad('博客首页的时间线里一条归档稿都没有（/p/archive/** 的该列出来）');
    if (/data-tag="归档"/.test(home)) ok('博客首页：有「归档」标签可以单独筛');
    else bad('博客首页缺少「归档」标签');
    /* 导航里不再单列「工具站」，只留「百宝箱」 */
    const navHtml = (home.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
    if (navHtml.includes('百宝箱') && !navHtml.includes('工具站')) ok('博客首页：顶栏只留百宝箱，没有工具站');
    else bad('博客首页顶栏导航不对：' + navHtml);
    /* 文章链接要真的指得着：抽前 5 个 post-card 的 href 验存在 */
    const hrefs = [...home.matchAll(/<a class="pc-link" href="([^"]+)"/g)].map((m) => m[1]).slice(0, 5);
    for (const h of hrefs) {
      /* 地址里的中文是 percent-encoded 的，磁盘上是原文，比之前先解码 */
      const disk = h.split('#')[0].split('/').map((seg) => {
        try { return decodeURIComponent(seg); } catch { return seg; }
      }).join('/');
      const f = path.resolve(pDir, disk);
      if (fs.existsSync(f)) ok(`  文章页 ${h} 存在`);
      else bad(`  文章页 ${h} 不存在`);
    }
    /* 归档稿的链接也要存在（时间线里那些 /p/archive/**） */
    for (const [, h] of home.matchAll(/<a href="(archive\/[^"]+)"/g)) {
      const f = path.resolve(pDir, decodeSitePath(h));
      if (fs.existsSync(f)) ok(`  归档稿 ${h} 存在`);
      else bad(`  归档稿 ${h} 不存在`);
    }

    /* 侧栏目录的布局开关：没有目录的文章页不能还是两列（否则正文被挤进 212px 那一列） */
    const postDir = path.join(pDir, 'post');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.html') ? [path.join(dir, e.name)] : []));
    let tocPages = 0, plainPages = 0, badWrap = 0;
    for (const f of (fs.existsSync(postDir) ? walk(postDir) : [])) {
      const html = fs.readFileSync(f, 'utf8');
      const hasToc = /<aside class="ptoc"/.test(html);
      const wrapHasToc = /<main class="wrap has-toc">/.test(html);
      const wrapPlain = /<main class="wrap">/.test(html);
      if (hasToc) tocPages++; else plainPages++;
      if (hasToc !== wrapHasToc || (!hasToc && !wrapPlain)) {
        bad(`文章页 .wrap 的类名和目录对不上：${path.relative(pDir, f)}`);
        badWrap++;
      }
      /* 「本页目录」现在每篇都有：没有小节的短文也有一条「文章标题 → #post」兜底 */
      if (!hasToc) {
        bad(`文章页没有「本页目录」：${path.relative(pDir, f)}`);
        badWrap++;
      }
    }
    if (!badWrap) ok(`文章页布局：${tocPages} 篇都带侧栏目录（含没有小节的短文），两列 / 单列对得上`);
    /* 带目录的文章页，标题层级要有缩进（归一成 lv-1 起，且至少两个层级才对得上） */
    const sciPath = path.join(postDir, 'science.html');
    if (fs.existsSync(sciPath)) {
      const sci = fs.readFileSync(sciPath, 'utf8');
      const okLv = /class="lv-1"/.test(sci) && /class="lv-2"/.test(sci) && /class="lv-3"/.test(sci);
      if (okLv) ok('文章页目录：层级（lv-1 / lv-2 / lv-3）都在');
      else bad('文章页目录缺少层级标记');
    }
  }
}

/* ═══ 11. 归档产物（/p/archive/**）
   控制台烘出来的成品，外壳必须和静态文章页**同一套**：
   站点顶栏、侧栏目录、正文容器、共享的 chrome 样式/脚本。
   这一节就是钉住「归档的也得有顶栏和目录」这件事。 */
console.log('\n── 11. 归档产物：外壳与文章页一致 ──');
{
  const archiveDir = path.join(pDir, 'archive');
  const walkAll = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkAll(path.join(dir, e.name))
      : (e.name.endsWith('.html') ? [path.join(dir, e.name)] : []));
  const files = fs.existsSync(archiveDir) ? walkAll(archiveDir) : [];
  if (!files.length) {
    ok('还没有归档产物（没归档过就跳过这一节）');
  } else {
    let withToc = 0;
    for (const f of files) {
      const rel = path.relative(pDir, f).split(path.sep).join('/');
      const html = fs.readFileSync(f, 'utf8');
      const checks = [
        [/<header class="top">/, '站点顶栏'],
        [/<nav class="top-nav" aria-label="站点导航">[\s\S]*?百宝箱/, '顶栏导航项'],
        [/<article class="md" id="post">/, '正文容器'],
        [/build\/template\/post-chrome\.css|文章外壳的样式/, '共享的 chrome 样式'],
        [/\/docs-md\.css/, 'docs-md.css'],
      ];
      let badThis = 0;
      for (const [re, label] of checks) {
        if (!re.test(html)) { bad(`归档产物缺${label}：${rel}`); badThis++; }
      }
      /* 与文章页同一条规矩：**每一篇都有**侧栏目录（没有小节的短文也有兜底那一条） */
      const heads = (html.match(/<h[123]\b[^>]*\bid="/g) || []).length;
      const hasToc = /<aside class="ptoc"/.test(html);
      if (!hasToc) { bad(`归档产物没有侧栏目录：${rel}`); badThis++; }
      if (hasToc) {
        withToc++;
        if (!/<main class="wrap has-toc">/.test(html)) { bad(`归档产物有目录但不是两列：${rel}`); badThis++; }
        if (!/<ul id="ptocList">[\s\S]*?class="lv-1"/.test(html)) { bad(`归档产物目录没有层级：${rel}`); badThis++; }
      } else if (!/<main class="wrap">/.test(html)) {
        bad(`归档产物没有目录时 .wrap 该是单列：${rel}`); badThis++;
      }
      /* canonical 不能空着（老产物没写这一行，重刷外壳时要落回自己的地址） */
      if (/<link rel="canonical" href="">/.test(html)) { bad(`归档产物 canonical 是空的：${rel}`); badThis++; }
      if (!badThis) ok(`  ${rel}`);
    }
    ok(`归档产物 ${files.length} 篇：顶栏 / 目录 / 正文容器都在（其中 ${withToc} 篇带侧栏目录）`);
  }
}

/* ═══ 汇总 ═══ */
console.log(`\n${fail ? `✗ ${fail} 项失败` : '✓ 全部通过'}${warn ? `，${warn} 项提示` : ''}\n`);
process.exit(fail ? 1 : 0);
