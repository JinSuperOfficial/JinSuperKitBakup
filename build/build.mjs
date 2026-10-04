/**
 * ═══════════════════════════════════════════════════
 *  文档站构建脚本
 * ---------------------------------------------------
 *  做三件事：
 *    1. 把 sk.json 里列出的 Markdown / 文本，在构建期全部
 *       渲染成 HTML，内联进 p/docs.html
 *    2. 把 markdown-it 全家桶 + KaTeX + highlight.js 本地化，
 *       产出 p/docs-md.js（浏览器端，备用）与 p/docs-md.css
 *    3. 拷 KaTeX 字体到 p/fonts/
 *
 *  产物完全不依赖 CDN、不依赖云函数、不依赖任何动态站点特性：
 *  高级版过期之后，直接打开 p/docs.html 就能读到全文。
 *
 *  跑法：  cd build && npm run build
 * ═══════════════════════════════════════════════════
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './lib/markdown.cjs';
import { buildBrowserBundle } from './lib/bundle.mjs';
import { buildDocsCss } from './lib/css.mjs';
import { siteRoot as SITE_ROOT, pDir as P_DIR, templateDir as TEMPLATE_DIR } from './paths.mjs';
import { FAVICON_PLACEHOLDER, relPrefix, faviconTags } from './lib/favicon.mjs';
import { LOGO_PLACEHOLDER, inlineLogo } from './lib/logo.mjs';
import { collectOutputs, writeOutputs } from './lib/site-index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/* 站点位置统一在 paths.mjs 里定义（build/ 不在站点内部） */
const siteRoot = SITE_ROOT;
const srcDir = P_DIR;
const templateDir = TEMPLATE_DIR;

/* 项目根：build/ 的上一级。asset/ 和 dist/ 都在这里 */
const projectRoot = path.resolve(here, '..');

/* ═══════════════════════════════════════════════════
   工具
   ═══════════════════════════════════════════════════ */

const log = (...a) => console.log('  ', ...a);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** JSON 内联进 <script> 时必须转义 </script 和 <!-- */
function safeJson(obj) {
  /* sk.json 原文是「字符串形式的 JSON」，如果直接 stringify 会变成
     再包一层的字符串字面量，页面拿到的就不是对象了。这里先解一层。 */
  let v = obj;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { /* 不是 JSON 就原样留着 */ }
  }
  return JSON.stringify(v)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 解码字节流：兼容 BOM / UTF-8 / UTF-16 / GBK 回退 */
function decodeBytes(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  const s = buf.toString('utf8');
  /* 出现替换字符说明不是合法 UTF-8，试 GBK */
  if (s.includes('\uFFFD')) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return s;
    }
  }
  return s;
}

function extOf(p) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(p || ''));
  return m ? m[1].toLowerCase() : '';
}

/** 只对这些扩展名做 Markdown 渲染 */
const MD_EXT = new Set(['md', 'markdown', 'mdown', 'mkd']);
/** 这些按纯文本内联（源码视图直接显示） */
const TEXT_EXT = new Set([
  'txt', 'log', 'json', 'xml', 'yml', 'yaml', 'csv', 'tsv',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
  'css', 'scss', 'sass', 'less', 'styl',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php',
  'swift', 'kt', 'sh', 'bash', 'zsh', 'fish', 'sql', 'toml', 'ini', 'conf',
  'html', 'htm', 'xhtml', 'svg',
]);
const MEDIA_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'pdf', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a']);

function kindOf(p) {
  const e = extOf(p);
  if (MD_EXT.has(e)) return 'md';
  if (e === 'html' || e === 'htm' || e === 'xhtml') return 'html';
  if (TEXT_EXT.has(e)) return 'code';
  if (MEDIA_EXT.has(e)) return 'media';
  return 'unknown';
}

/* ═══════════════════════════════════════════════════
   1. 读清单
   ═══════════════════════════════════════════════════ */

function readManifest() {
  const raw = fs.readFileSync(path.join(siteRoot, 'sk.json'), 'utf8');
  const data = JSON.parse(raw);

  const groups = [];
  const isGrouped = Object.values(data).some((v) => v && typeof v === 'object');

  if (!isGrouped) {
    const items = Object.entries(data)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([name, p]) => ({ name, path: p.trim() }));
    if (items.length) groups.push({ name: '文档', items });
    return groups;
  }

  for (const [gname, gval] of Object.entries(data)) {
    const items = [];
    if (Array.isArray(gval)) {
      gval.forEach((el, i) => {
        if (typeof el === 'string' && el.trim()) items.push({ name: `${gname} ${i + 1}`, path: el.trim() });
        else if (el && typeof el === 'object') {
          for (const [n, p] of Object.entries(el)) {
            if (typeof p === 'string' && p.trim()) items.push({ name: n, path: p.trim() });
          }
        }
      });
    } else if (gval && typeof gval === 'object') {
      for (const [n, p] of Object.entries(gval)) {
        if (typeof p === 'string' && p.trim()) items.push({ name: n, path: p.trim() });
      }
    } else if (typeof gval === 'string' && gval.trim()) {
      items.push({ name: gname, path: gval.trim() });
    }
    if (items.length) groups.push({ name: gname, items });
  }
  return groups;
}

/* ═══════════════════════════════════════════════════
   2. 预渲染每一篇
   ═══════════════════════════════════════════════════ */

/** markdown 里的相对链接/图片，统一加上这个前缀就回到网站根目录 */
const ROOT_PREFIX = locationPrefix();

/**
 * 静态资源版本号，写进 docs-md.css 的查询串用来破缓存。
 * 改了样式就把它 +1；不要用时间戳，否则每次构建产物哈希都变。
 */
const ASSET_VERSION = 3;

function locationPrefix() {
  /* p/docs.html 在网站根目录下的 p/ 里，所以相对路径要 ../ 才到根 */
  return '../';
}

/**
 * 读一篇文档并（按需）渲染。
 *
 * 路径解析有两个特殊情况：
 *
 * 1. `../asset/xxx.md` 指的是「网站根上一级的 asset/」，而 asset/ 确实放在
 *    站点目录之外（工作区根的 asset/），部署时由 prep-deploy.mjs 组装进 dist/asset/。
 *    所以构建期要从项目根的 asset/ 读，而不是站点里找。
 *
 * 2. 归档产物会被登记成**站点根相对**的写法 `p/archive/x.html`
 *    （发布控制台就是这么写的，sk.json 里对阅读器也一样能认）；
 *    而 sk.json 里绝大多数条目是相对 /p/ 的 `archive/x.html`。
 *    两种都得能读 —— 以前只按 /p/ 解析，遇到 `p/archive/…` 会拼成 `p/p/archive/…`，
 *    报「文件不存在」。所以这里统一把开头的 `p/` 剥掉。
 */
function renderOne(pathFromP) {
  const assetMatch = /^\.\.\/asset\/(.+)$/.exec(pathFromP);
  /* sk.json 里两种写法都收：`p/xxx` 与 `xxx`（都当相对 /p/ 看） */
  const fromP = String(pathFromP).replace(/^\.?\//, '').replace(/^p\//, '');
  const abs = assetMatch
    ? path.join(projectRoot, 'asset', assetMatch[1])
    : path.resolve(srcDir, fromP);

  if (!fs.existsSync(abs)) {
    throw new Error(`文件不存在：${assetMatch ? 'asset/' + assetMatch[1] : path.relative(siteRoot, abs)}`);
  }

  const buf = fs.readFileSync(abs);
  /* 站点内的用相对站点根的路径；asset/ 里的保持 ../asset/ 形式（这就是它在网页上的位置） */
  const rel = assetMatch
    ? '../asset/' + assetMatch[1]
    : path.relative(siteRoot, abs).split(path.sep).join('/');
  const kind = kindOf(rel);

  const out = {
    path: pathFromP,
    root: rel,
    kind,
    bytes: buf.length,
    text: null,
    html: null,
  };

  if (kind === 'md') {
    const src = decodeBytes(buf);
    out.text = src;
    out.html = renderMarkdown(src);
  } else if (kind === 'code' || kind === 'html') {
    out.text = decodeBytes(buf);
  }

  return out;
}

/* ═══════════════════════════════════════════════════
   3. 生成 p/docs.html
   ═══════════════════════════════════════════════════ */

function buildStaticContent(groups, docs) {
  /* noscript 兜底：所有正文按顺序排开，纯 HTML，爬虫能看到 */
  let html = '';
  for (const g of groups) {
    html += `<section class="static-group"><h2 class="static-group-title">${esc(g.name)}</h2>`;
    for (const it of g.items) {
      const d = docs.get(it.path);
      html += `<article class="static-doc" id="static-${esc(slugFor(it.path))}">`;
      html += `<h3 class="static-doc-title">${esc(it.name)}</h3>`;
      if (d && d.html) html += `<div class="md">${d.html}</div>`;
      else if (d && d.text != null) html += `<pre><code>${esc(d.text)}</code></pre>`;
      else html += `<p>无法渲染：<code>${esc(it.path)}</code></p>`;
      html += '</article>';
    }
    html += '</section>';
  }
  return html;
}

function slugFor(s) {
  return String(s).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
}

/* 注意：这里只放 JS 本体，不要带 <script> 标签。
   buildHtml 会连同标签一起写进去，重复套标签会让内层被当成文本。 */
const DOCS_JS = String.raw`/* ═══════════════════════════════════════════════════
   文档站 · 客户端脚本（约 200 行）
   ---------------------------------------------------
   正文已经在构建期预渲染成 HTML 内联在 window.__DOCS__ 里，
   所以这里只负责「切换 + 设置 + 交互」，一行 Markdown 解析都没有。

   不依赖：CDN / 云函数 / 网络请求。
   高级版过期后，这个页面照常工作。
   ═══════════════════════════════════════════════════ */
(function(){
'use strict';

/**
 * 清单来源：构建期把根目录的 sk.json 内联进来（省一次请求，也让断网可用）。
 * 你在 sk.json 里加键值对之后，只要重新构建一次，这个内联副本就会更新；
 * 想完全跳过构建，也可以把 INLINE_MANIFEST 置空，页面就会去 fetch sk.json。
 */
var INLINE_MANIFEST = window.__SK__ || null;

var GROUPS = [];
var ALL = [];

/* 少数文档走预渲染（构建期就把 HTML 渲染好内联），
   其余一律在浏览器里用本地渲染器现场渲染 —— 所以你在 /p/ 放 .md、
   在 sk.json 加一行，刷新这个页面就能看到。 */
var PRE_RENDERED = window.__PRERENDERED__ || {};

/* ═══ 清单 ═══ */

/**
 * 加载 sk.json。
 *
 * 内联副本用来兜底（构建时打进来的），但优先走网络 ——
 * 这样你往 sk.json 加了条目，刷新就能看到，不必重新构建。
 */
function loadManifest(cb){
  var finish = function(text, source){
    var data;
    try { data = JSON.parse(text); }
    catch(e){ cb(new Error('sk.json 不是合法 JSON：' + (e.message || e))); return; }
    try { cb(null, parseManifest(data), source); }
    catch(e){ cb(new Error('清单结构不对：' + (e.message || e))); return; }
  };

  /* 清单在网站根目录，这个页面在 /p/ 下，所以要 ../ */
  fetch(ROOT_PREFIX + 'sk.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function(t){ finish(t, 'network'); })
    .catch(function(e){
      if (INLINE_MANIFEST) finish(INLINE_MANIFEST, 'inline');
      else cb(e);
    });
}

/** 支持三种形态：扁平映射 / 分组映射 / 分组数组 */
function parseManifest(data){
  if (!data || typeof data !== 'object' || Array.isArray(data)){
    throw new Error('清单应该是一个对象');
  }

  var keys = Object.keys(data);
  var isGrouped = keys.some(function(k){
    var v = data[k];
    return v && typeof v === 'object';
  });

  var out = [];

  if (!isGrouped){
    var flat = [];
    keys.forEach(function(k){
      if (typeof data[k] === 'string' && data[k].trim()) flat.push({ name: k, path: data[k].trim() });
    });
    if (flat.length) out.push({ name: '文档', items: flat });
    return out;
  }

  keys.forEach(function(g){
    var val = data[g];
    var items = [];

    if (Array.isArray(val)){
      val.forEach(function(el, i){
        if (typeof el === 'string' && el.trim()){
          items.push({ name: g + ' ' + (i + 1), path: el.trim() });
        } else if (el && typeof el === 'object'){
          Object.keys(el).forEach(function(n){
            if (typeof el[n] === 'string' && el[n].trim()) items.push({ name: n, path: el[n].trim() });
          });
        }
      });
    } else if (val && typeof val === 'object'){
      Object.keys(val).forEach(function(n){
        var p = val[n];
        if (typeof p === 'string' && p.trim()) items.push({ name: n, path: p.trim() });
      });
    } else if (typeof val === 'string' && val.trim()){
      items.push({ name: g, path: val.trim() });
    }

    if (items.length) out.push({ name: g, items: items });
  });

  return out;
}

/** 补上 kind 等派生属性，并摊平进 ALL */
function fillFromGroups(parsed){
  GROUPS = parsed || [];
  ALL = [];
  GROUPS.forEach(function(g){
    g.items.forEach(function(it){
      it.group = g.name;
      it.kind = detectKind(it.path);
      it.root = it.path;
      ALL.push(it);
    });
  });
  return ALL;
}

function detectKind(p){
  var m = /\.([a-zA-Z0-9]+)$/.exec(String(p || ''));
  var e = m ? m[1].toLowerCase() : '';
  if (['md', 'markdown', 'mdown', 'mkd'].indexOf(e) >= 0) return 'md';
  if (['html', 'htm', 'xhtml'].indexOf(e) >= 0) return 'html';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
       'pdf', 'mp4', 'webm', 'ogv', 'mov', 'm4v',
       'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].indexOf(e) >= 0) return 'media';
  if (['txt', 'log', 'json', 'xml', 'yml', 'yaml', 'csv', 'tsv',
       'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
       'css', 'scss', 'sass', 'less', 'styl',
       'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php',
       'swift', 'kt', 'sh', 'bash', 'zsh', 'fish', 'sql', 'toml', 'ini', 'conf'].indexOf(e) >= 0) return 'code';
  return 'unknown';
}

/* ═══ 配置 ═══ */

/* 页面在 /p/ 下，相对路径要 ../ 才回到网站根 */
var ROOT_PREFIX = '../';

var GLASS_NAMES = { mica:'云母', aero:'Aero', acrylic:'亚克力' };

var LIBS = {
  md:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15V9l3 3 3-3v6"/><path d="M17 9v6M15 13l2 2 2-2"/></svg>',
  code:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/></svg>',
  html:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  media:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  unknown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/></svg>'
};

var settings = {
  theme:'obsidian', fontSize:15, glass:'mica',
  barOpacity:78, outline:'docked', sideCollapsed:false
};

var activePath = null;
var codeMode = false;
/* 打开文档的序号：异步回调回来时判断自己有没有被后来的点击取代 */
var openGen = 0;
/* 侧栏分组（fillFromGroups 填）—— 深链接要找「目标在哪一组」时用它 */
var groups = [];
var collapsedGroups = {};

/* ═══ 深链接：#文档路径 ═══
   页面里的 <card href="/p/docs.html#idea%2F…"> 就是靠这个跳的：
   点开时地址栏的 hash 变了，这里接住，正文当场换，不整页重载。
   没有这段的话，点卡片只会改地址栏。

   hash 里的路径按「清单里的 path」原样比对（如 idea/1.归途且慢.md），
   渲染器拼卡片、侧栏列表也是同一套值，不需要额外映射。 */

/* 把 hash / ?f= 里的写法收敛成「清单里的 path」：
   去掉前导斜杠（卡片可能写成 /p/xxx.md），中文保持原样，
   解码失败就按原样再试一次。 */
function normWant(s){
  var v = String(s == null ? '' : s).replace(/^\/+/, '');
  try { return decodeURIComponent(v); }catch(e){ return v; }
}

/* 地址栏里的 hash（没有就 null） */
function rawHashWant(){
  var m = /^#(.+)$/.exec(String(location.hash || ''));
  return m ? m[1] : null;
}

/* ?f= / ?file= 老式写法（没有就 null） */
function queryWant(){
  try {
    var params = new URLSearchParams(location.search);
    return params.get('f') || params.get('file') || null;
  }catch(e){ return null; }
}

/* 按写法找清单里的那一篇。ALL 还没填好时返回 null ——
   所以启动时必须在清单到位之后再调它。 */
function findDoc(want){
  if (!want) return null;
  var w1 = normWant(want);
  for (var i = 0; i < ALL.length; i++){
    if (ALL[i].path === w1 || ALL[i].root === w1 || ALL[i].path === want) return ALL[i];
  }
  return null;
}

function docFromHash(){ return findDoc(rawHashWant()); }

/* 目标在收起的组里就把它展开 —— 跳过去却看不见侧栏选中项很难受 */
function revealInSidebar(doc){
  var g = null;
  for (var i = 0; i < GROUPS.length; i++){
    if (GROUPS[i].items.indexOf(doc) >= 0){ g = GROUPS[i]; break; }
  }
  if (!g || !collapsedGroups[g.name]) return;
  collapsedGroups[g.name] = false;
  try { localStorage.setItem('docs.collapsed', JSON.stringify(collapsedGroups)); }catch(e){}
}

/* 地址栏 hash 变了：切到对应那篇。
   hash 指向清单里没有的篇目时安静忽略，不弹错、不白屏。 */
function syncFromHash(){
  var doc = docFromHash();
  if (!doc) return;
  if (doc.path === activePath) return;

  revealInSidebar(doc);
  openDoc(doc.path, true);       /* hash 已经是这个了，别再写一次 */

  /* 卡片通常在页面底部：换完正文把视口带回顶部，
     不然人是从页脚开始读的。 */
  try { contentEl.scrollTop = 0; }catch(e){}

  toast('已切换：' + doc.name);
}

/**
 * 取文档原文。
 *
 * 顺序很讲究，因为热铁盒会把 .md 直接渲染成 HTML 页面返回：
 *
 *   1. raw.php 云函数 —— 拿回来的是**真原文**，公式、代码围栏、语法标记
 *      一个不少。浏览器端渲染器才能正常工作。
 *   2. 直接 fetch 那个 .md —— 拿到的是平台渲染好的整页 HTML。
 *      正文虽然是对的，但 **LaTeX 源码已经在平台那层丢掉了**，
 *      公式会退化成平台渲染的样子（通常是干巴巴的文本）。
 *      所以这是降级路径：至少能读，别开天窗。
 *
 * 换句话说：raw.php 装了更完整，没装也能用，只是公式会不理想。
 */
var rawCache = {};
var rawInflight = {};

/* raw.php 用不了（404 / 没执行 PHP）就记住，本会话不再重试 ——
   否则每换一篇文档都白跑一次，控制台一直刷 404。
   存 sessionStorage：刷新页面也不用再踩一遍，关掉标签页就忘。 */
var rawPhpDead = false;
try { rawPhpDead = sessionStorage.getItem('docs.rawDead') === '1'; }catch(e){}

/** 这个错误说明「raw.php 根本不在」而不是「这一篇读不到」 */
function rawPhpMissing(err){
  var m = /HTTP (\d{3})/.exec(String((err && err.message) || err));
  if (!m) return true;                       /* 网络层就失败：多半是静态托管不执行 PHP */
  var code = Number(m[1]);
  return code === 404 || code === 405 || code === 501;
}

function killRawPhp(){
  rawPhpDead = true;
  try { sessionStorage.setItem('docs.rawDead', '1'); }catch(e){}
}

/**
 * 判断拿回来的是不是「平台渲染过的整页 HTML」
 */
function looksLikePlatformHtml(text){
  var s = String(text || '').slice(0, 600).toLowerCase();
  return s.indexOf('<!doctype') >= 0 || s.indexOf('<html') >= 0;
}

/**
 * 判断拿回来的是不是**源码文件**，而不是文章内容。
 * ---------------------------------------------------
 * 典型翻车场景：纯静态托管（GitHub Pages 这类）不会执行 .php，
 * 而是把它当普通文本文件原样返回。于是 raw.php 的请求「成功」了，
 * 拿到的却是 1000 多字的 PHP 源码。
 *
 * 更要命的是这段源码进了 Markdown 渲染器后，<?php 会被浏览器
 * 当成「处理指令/注释」，整篇正文变成空白——看起来就是「内容没了」。
 * 所以这里必须把它认出来，然后走降级路径。
 */
function looksLikeSourceCode(text){
  var s = String(text || '');
  if (!s) return false;
  var head = s.slice(0, 3000);
  if (/^\s*<\?php\b/i.test(head)) return true;
  if (/^\s*<\?=/.test(head)) return true;
  if (/^\s*#!\/.*\b(python|node|ruby|perl|bash|sh)\b/.test(head)) return true;
  /* 没有尖括号包裹的纯后端代码特征（避免误伤正常文章，只在有函数迹象时才认） */
  if (/\bfile_get_contents\s*\(/.test(head) && /\$_(GET|POST|REQUEST)\b/.test(head)) return true;
  if (/\bheader\s*\(\s*['"]Content-Type/i.test(head) && /<\?php/i.test(head)) return true;
  return false;
}

/** 从平台渲染的整页 HTML 里拆出正文 */
function stripPlatformWrapper(text){
  var s = String(text == null ? '' : text);
  if (!s) return s;
  if (!looksLikePlatformHtml(s)) return s;
  var m = s.match(/<body[^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/body>/i)
       || s.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
       || s.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  return m ? m[1] : s;
}

/**
 * 把文档相对路径编码成安全 URL。
 * 逐段 encodeURIComponent，但保留 .. 和 . —— 中文文件名必须被编码，
 * 否则请求里出现非 ASCII 字符，不同静态服务器处理方式不一致（可能 404）。
 */
function encodePath(p){
  return String(p || '').split('/').map(function(seg){
    if (seg === '..' || seg === '.' || seg === '') return seg;
    return encodeURIComponent(seg);
  }).join('/');
}

/**
 * 把「相对 /p/ 的路径」换算成「相对站点根的路径」。
 * ---------------------------------------------------
 * 给 raw.php 用。raw.php 是站点根的云函数，它的 file_exists 用的是
 * 进程工作目录（也就是站点根），传 para/x.md 会被当成
 * 「站点根/para/x.md」→ 找不到文件 → 404，于是每次都白跑一趟、
 * 在控制台刷一条 404。传 p/para/x.md 才对。
 * 顺便把 .. 折掉：raw.php 明确拒绝路径里的 ..（防目录穿越）。
 */
function sitePath(root){
  var segs = ('p/' + String(root || '')).split('/');
  var out = [];
  for (var i = 0; i < segs.length; i++){
    var s = segs[i];
    if (!s || s === '.') continue;
    if (s === '..'){ out.pop(); continue; }
    out.push(s);
  }
  return out.join('/');
}

/**
 * 把「相对 /p/ 的路径」变成绝对地址。
 * ---------------------------------------------------
 * 给别的页面用（源码查看器在 /Skills/ 下）。两边的基准目录不同，
 * 传相对路径必然错位：../para/x.md 在 /p/ 下是 /p/para/x.md，
 * 到了 /Skills/ 就变成 /para/x.md —— 站点根，404。
 * 绝对地址不依赖对方的部署位置，站点整体挪进子目录也照样对。
 */
function absURL(rel){
  try { return new URL(String(rel), location.href).href; }
  catch(e){ return ROOT_PREFIX + String(rel); }
}

/**
 * 取文本 + content-type。
 * content-type 是判断「服务器到底给了什么」最可靠的依据：
 *   text/plain / text/markdown → 大概率是真原文
 *   text/html                  → 平台渲染过的页面，得拆正文
 */
function fetchText(url){
  return fetch(url, { cache: 'no-store' }).then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text().then(function(text){
      return { text: text, type: (r.headers.get('content-type') || '').toLowerCase() };
    });
  });
}

/**
 * 给拿到的东西分类。
 * @returns {'raw'|'platform-html'|null|'source-code'} raw=真原文，可直接交给渲染器
 */
function classifyContent(res){
  var text = String(res && res.text != null ? res.text : '');
  if (!text.trim()) return null;
  if (looksLikeSourceCode(text)) return 'source-code';
  if (looksLikePlatformHtml(text) || /text\/html/.test((res && res.type) || '')) return 'platform-html';
  return 'raw';
}

/**
 * 从归档产物里取出正文。
 * ---------------------------------------------------
 * 产物是完整 HTML（有 head、有自己的最小外壳、有页脚），
 * 直接塞进阅读器会把 <html>/<head> 也一起塞进去。
 * 但它内部结构是固定的：正文就是那个 class 为 md 的 div，
 * 所以取这一段即可；万一结构变了（手工改过产物），退回整段 ——
 * 浏览器的解析器会把非法嵌套的标签修好，读是不会读坏的。
 *
 * 注意：这段代码住在 String.raw 模板里，注释里不能出现反引号（见 build/README 的坑清单）。
 */
function extractArchiveBody(html){
  var s = String(html || '');
  var start = s.indexOf('<div class="md">');
  if (start < 0) return s;
  var from = start + '<div class="md">'.length;

  /* 从正文起点往后找配对的 </div>：数一下嵌套层数 */
  var depth = 1, i = from;
  var re = /<div\b|<\/div>/gi;
  re.lastIndex = from;
  var m;
  while ((m = re.exec(s))){
    if (m[0].charAt(1) === '/'){ depth--; if (!depth){ i = m.index; break; } }
    else depth++;
  }
  if (!i || i <= from) return s.slice(from).replace(/<\/div>[\s\S]*$/, '');

  return s.slice(from, i);
}

/** 读文本：raw.php 优先，退回平台渲染版 */
function loadText(doc, cb){
  if (rawCache[doc.path] != null){
    cb(null, rawCache[doc.path].text, rawCache[doc.path].fromPlatform);
    return;
  }
  if (rawInflight[doc.path]){ rawInflight[doc.path].push(cb); return; }
  rawInflight[doc.path] = [cb];
  markLoading(doc);

  var done = function(err, text, fromPlatform){
    var waiting = rawInflight[doc.path] || [];
    delete rawInflight[doc.path];
    if (!err && text != null) rawCache[doc.path] = { text: text, fromPlatform: !!fromPlatform };
    markLoaded(doc);
    waiting.forEach(function(f){ f(err, text, !!fromPlatform); });
  };

  /* 直接取文件：相对当前页面（/p/），平台会把 md 渲染成 HTML */
  var encoded = encodePath(doc.root);
  /* raw.php 在站点根、按站点根解析 f，所以要传 p/… 而不是 para/… */
  var rawURL = './raw.php?f=' + encodePath(sitePath(doc.root));

  /* ① 先要原文。只有真原文才保得住 LaTeX 公式和代码围栏。
        但静态托管会让这个请求「成功却返回 PHP 源码」，所以必须分类。 */
  var askRaw = rawPhpDead
    ? Promise.reject(new Error('raw.php 本会话已判定不可用'))
    : fetchText(rawURL).then(function(res){
        if (classifyContent(res) !== 'raw') throw new Error('raw.php 没给出原文');
        done(null, res.text, false);
      });

  askRaw.catch(function(e1){
    if (!rawPhpDead && rawPhpMissing(e1)) killRawPhp();
    /* ② 退回直接取文件。
            热铁盒会把 md 渲染成 HTML → 拆出正文当成品用（不能再渲染一遍）
            静态托管直接给 .md 原文 → 交给渲染器 */
      fetchText(encoded)
        .then(function(res){
          var kind = classifyContent(res);
          if (kind === 'source-code') throw new Error('取到的还是源码/脚本，不是文章');
          var fromPlatform = (kind === 'platform-html');
          var body = fromPlatform ? stripPlatformWrapper(res.text) : res.text;
          if (!body || !body.trim()) throw new Error('文件是空的');
          done(null, body, fromPlatform);
        })
        .catch(function(e2){
          done(new Error('读不到 ' + doc.root + '（' + (e2.message || e1.message) + '）'));
        });
    });
}

/* ═══ 顶栏角标：加载中 / static / 已归档 ═══ */

/* 正在等哪一篇的原文。只认「当前打开的这一篇」——
   角标按它算，不按「还有几个请求在飞」。 */
var loadingPath = null;
var loadingWatchdog = null;

/** 当前打开的那一篇（清单里的对象） */
function activeDoc(){
  for (var i = 0; i < ALL.length; i++){ if (ALL[i].path === activePath) return ALL[i]; }
  return null;
}

/** 归档预渲染稿：sk.json 里有 archive/x.html 与 p/archive/x.html 两种写法 */
function isArchivedDoc(doc){
  return !!doc && doc.kind === 'html' && /^(?:p\/)?archive\//.test(String(doc.path));
}

/**
 * 刷新顶栏角标。
 * ---------------------------------------------------
 * 判据是 loadingPath（当前这篇还缺不缺原文），不是在途请求数。
 * 旧写法按请求数判断：某次请求收尾时看到别的请求还在飞就 return，
 * 于是正文早渲染完了角标还停在「读取中」，快速连点时必现。
 * 现在不管成功、失败还是被后来的点击取代，它都一定收敛到终态。
 *
 * 归档文章走的是预渲染稿，正文不经过浏览器端渲染器，
 * 所以角标如实写「已归档」——一眼能看出这一篇是成品还是现场渲染。
 */
function updateBadge(doc){
  if (!loadBadgeEl) return;
  var d = doc || activeDoc();
  var waiting = !!(d && loadingPath === d.path);
  var archived = isArchivedDoc(d);
  var txt = waiting ? '读取中' : (archived ? '已归档' : 'static');

  /* 窄屏只留状态点（.lb-txt 被 CSS 藏起来），但文字仍然要写对 */
  var txtEl = loadBadgeEl.querySelector('.lb-txt');
  if (txtEl) txtEl.textContent = txt;
  else loadBadgeEl.innerHTML = '<span class="load-dot" aria-hidden="true"></span>' +
    '<span class="lb-txt">' + esc(txt) + '</span>';

  loadBadgeEl.classList.toggle('on', !!d);
  loadBadgeEl.title = waiting
    ? '正在读取这一篇的原文…'
    : archived
      ? '这一篇是归档预渲染稿，正文直接读成品，不再现场渲染'
      : '正文由本站自带的渲染器现场排版，不调用任何第三方接口';
}

/** 开始等某一篇的原文（只影响「就是当前这篇」时的角标） */
function markLoading(doc){
  if (!doc || doc.path !== activePath) return;
  loadingPath = doc.path;
  updateBadge(doc);
  /* 兜底：请求万一悬着不回来（网络卡死、平台不给响应），
     角标也不能一直转 —— 到点就按「没在等」算，正文那边会给出错误提示。 */
  clearTimeout(loadingWatchdog);
  loadingWatchdog = setTimeout(function(){
    if (loadingPath === doc.path){ loadingPath = null; updateBadge(); }
  }, 12000);
}

/** 这一篇有结果了（成功、失败、被后来的点击取代都算） */
function markLoaded(doc){
  if (doc && loadingPath === doc.path){
    loadingPath = null;
    clearTimeout(loadingWatchdog);
  }
  updateBadge();
}

/* 兼容旧调用点 */
function getRaw(doc, cb){ loadText(doc, function(err, text){ cb(err ? null : text); }); }

/* ═══ DOM ═══ */
var $ = function(id){ return document.getElementById(id); };
var loadBadgeEl = $('loadBadge'), btnSideToggle = $('btnSideToggle'), btnSideCollapse = $('btnSideCollapse');
var glassGridEl = $('glassGrid'), outlineGridEl = $('outlineGrid'), outlineXEl = $('outlineX'), outlinePillEl = $('outlinePill');
var searchInput = $('searchInput'), searchClear = $('searchClear'), fileListEl = $('fileList');
var contentEl = $('content'), docNameEl = $('docName'), docMetaEl = $('docMeta');
var btnToggle = $('btnToggle'), btnViewer = $('btnViewer'), btnCopy = $('btnCopy'), btnOpen = $('btnOpen');
var btnSettings = $('btnSettings'), drawerEl = $('drawer'), scrimEl = $('scrim'), themeGridEl = $('themeGrid');
var toastEl = $('toast'), outlineEl = $('outline'), outlineListEl = $('outlineList');
var progressEl = $('progress'), btnTopEl = $('btnTop');
var sideScrimEl = $('sideScrim');

/* ═══ 工具 ═══ */
function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c];
  });
}

function fmtSize(n){
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/**
 * 把文档里的相对链接补回网站根。
 *
 * 规则与浏览器一致：
 *   · #锚点、//协议相对、http(s):/mailto: 等绝对地址 —— 原样不动
 *   · / 开头的根路径 —— 原样不动（它本来就是相对站点根的）
 *   · 其余（a.md、./a.md、../asset/a.md、img/x.png）—— 补 ROOT_PREFIX
 *
 * 为什么不在构建期写死前缀：站点目录层级将来可能变，运行时算最稳。
 */
function renderURL(u){
  var s = String(u || '');
  if (!s) return s;
  if (s.charAt(0) === '#') return s;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  /* 根路径也要补前缀：这个页面本身就在 /p/ 下，
     "/sk.json" 得变成 "../sk.json" 才真的指向网站根。
     这样整站挪进子目录也不会断。 */
  if (s.charAt(0) === '/') return ROOT_PREFIX + s.replace(/^\/+/, '');
  return ROOT_PREFIX + s.split('/').map(encodeURIComponent).join('/');
}

/* 命中的关键词高亮：先切段再逐段转义，避免注入 */
function highlightText(text, query){
  if (!query) return esc(text);
  var lower = text.toLowerCase(), q = query.toLowerCase();
  var out = '', i = 0, qLen = q.length;
  while (i < text.length){
    var idx = lower.indexOf(q, i);
    if (idx === -1){ out += esc(text.slice(i)); break; }
    out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + qLen)) + '</mark>';
    i = idx + qLen;
  }
  return out;
}

var toastTimer = null;
function toast(msg, isErr){
  toastEl.textContent = String(msg);
  toastEl.className = 'toast show' + (isErr ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.className = 'toast'; }, 2200);
}

/* ═══ 侧栏 ═══ */
function renderSidebar(){
  var q = searchInput.value.trim();
  var ql = q.toLowerCase();
  searchClear.classList.toggle('on', q.length > 0);

  var totalShown = 0, html = '';

  for (var gi = 0; gi < GROUPS.length; gi++){
    var g = GROUPS[gi];
    var items = (g.items || []).filter(function(it){
      if (!ql) return true;
      return (it.name + ' ' + it.path + ' ' + g.name).toLowerCase().indexOf(ql) >= 0;
    });
    if (!items.length) continue;

    if (GROUPS.length > 1 || g.name !== '文档'){
      var isCollapsed = !!collapsedGroups[g.name];
      html += '<div class="group-head' + (isCollapsed ? ' collapsed' : '') + '" data-group="' + esc(g.name) +
        '" role="button" tabindex="0" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' +
        '<span class="caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>' +
        esc(g.name) + '<span class="gcount">' + items.length + '</span></div>';
    }

    html += '<div class="group-items">';
    for (var ii = 0; ii < items.length; ii++){
      var it = items[ii];
      html += '<div class="file-item' + (it.path === activePath ? ' active' : '') + '" data-path="' + esc(it.path) +
        '" role="button" tabindex="0" title="' + esc(it.path) + '">' +
        '<span class="file-icon">' + (LIBS[it.kind] || LIBS.unknown) + '</span>' +
        '<span class="file-name">' + (ql ? highlightText(it.name, q) : esc(it.name)) + '</span></div>';
    }
    html += '</div>';
    totalShown += items.length;
  }

  if (!totalShown){
    fileListEl.innerHTML = q
      ? '<div class="empty-side">没匹配的<br>试试别的关键词</div>'
      : '<div class="empty-side">还没有文档</div>';
    return;
  }
  fileListEl.innerHTML = html;
}

/* ═══ 打开文档 ═══
   fromHash = true 表示「地址栏已经是这个 hash 了」（页面内跳转 / 启动复原），
   这时只换正文，不再写一次 hash，免得来回触发 hashchange。
   其余调用（点侧栏、上一篇下一篇）用 pushState，浏览器后退键才能一篇篇退回去。 */
function openDoc(p, fromHash){
  var doc = null;
  for (var i = 0; i < ALL.length; i++){ if (ALL[i].path === p){ doc = ALL[i]; break; } }
  if (!doc) return;

  /* 这次打开的序号。异步回调回来时拿它判断「我是不是已经被后来的点击取代了」——
     否则连点两篇时，先发的那次请求后回来，会把正文覆盖成上一篇。 */
  var gen = ++openGen;
  function stale(){ return gen !== openGen; }

  activePath = p;
  if (!fromHash){
    try { history.pushState(null, '', '#' + encodeURIComponent(p)); } catch(e){}
  }
  document.title = doc.name + ' · JinSuper';
  renderSidebar();

  /* 手机端：选完文档就把侧栏收回，别让它继续挡着正文 */
  if (isNarrow() && !settings.sideCollapsed) setSideCollapsed(true);

  docNameEl.textContent = doc.name;
  docMetaEl.textContent = '';
  outlineEl.classList.remove('on');
  progressEl.style.transform = 'scaleX(0)';
  btnViewer.disabled = doc.kind === 'media';
  btnOpen.disabled = false;
  btnCopy.disabled = doc.kind === 'media';
  /* 换篇就把角标切到这一篇的状态（归档 / static），别留着上一篇的 */
  updateBadge(doc);

  btnViewer.onclick = function(){
    /* viewer.html 在 /Skills/ 下，但传的 f 必须是**绝对地址**：
       查看器按自己的位置解析相对路径，../para/x.md 在 /p/ 下是
       /p/para/x.md，到 /Skills/ 就变成 /para/x.md（站点根）→ 404。
       绝对地址不依赖对方的部署位置，站点挪进子目录也照样对。 */
    var u = '../Skills/viewer.html?f=' + encodeURIComponent(absURL(doc.root));
    /* 再带上 ?raw=：让查看器去 raw.php 取真原文。
       不然平台会把 .md 渲染成整页 HTML（还挂着一张外链样式表），
       查看器里看到的是一堆转义后的标签，不是源码。
       raw.php 在本站用不了时就不传，省一次 404。 */
    if (!rawPhpDead){
      u += '&raw=' + encodeURIComponent(absURL('./raw.php?f=' + encodePath(sitePath(doc.root))));
    }
    window.open(u, '_blank', 'noopener');
  };
  btnOpen.onclick = function(){
    window.open(renderURL(doc.root), '_blank', 'noopener');
  };

  /* ── 图片 / 视频 / 音频：浏览器直接能放的，不进渲染流程 ── */
  if (doc.kind === 'media'){
    var u = renderURL(doc.root);
    var lower = doc.root.toLowerCase();
    var inner;
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(lower)){
      inner = '<div class="img-view"><img src="' + esc(u) + '" alt="' + esc(doc.name) + '"></div>';
    } else if (/\.(mp4|webm|ogv|mov|m4v)$/.test(lower)){
      inner = '<div class="img-view"><video src="' + esc(u) + '" controls style="max-width:100%;max-height:calc(100dvh - 160px);border-radius:var(--radius-card)"></video></div>';
    } else if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(lower)){
      inner = '<div class="img-view"><audio src="' + esc(u) + '" controls></audio></div>';
    } else if (/\.pdf$/.test(lower)){
      inner = '<iframe class="frame-view" src="' + esc(u) + '" title="PDF"></iframe>';
    } else {
      inner = '';
    }
    btnToggle.style.display = 'none';
    contentEl.innerHTML = inner || ('<div class="empty-main"><div class="inner"><h2>不支持预览</h2>' +
      '<p><code>' + esc(doc.path) + '</code></p></div></div>');
    docMetaEl.textContent = '媒体';
    return;
  }

  var preHtml = PRE_RENDERED[doc.path] || null;
  var cachedEntry = rawCache[doc.path] || null;
  var cachedText = cachedEntry ? cachedEntry.text : null;

  /* ── 源码 / 渲染切换：只有能拿到原文的文本类文档才需要 ── */
  codeMode = false;
  var canShowSource = (doc.kind === 'md' || doc.kind === 'code' || doc.kind === 'html');
  btnToggle.style.display = canShowSource && doc.kind === 'md' ? '' : 'none';
  btnToggle.classList.remove('active');
  btnToggle.querySelector('.lbl').textContent = '源码';

  function showSource(){
    var entry = rawCache[doc.path];
    if (entry == null){ showNoSource(doc); return; }
    renderCodeView(entry.text);
  }

  function showMd(){
    if (codeMode){ showSource(); return; }
    if (cachedText == null && preHtml == null){
      showLoading(doc);
      loadText(doc, function(err, text, fromPlatform){
        if (stale()) return;              /* 已经切到别的篇了，别拿旧正文盖上去 */
        if (codeMode) return;             /* 用户已经切到源码了 */
        if (err || text == null){ showLoadError(doc, err); return; }
        doRenderMarkdown(doc, text, null, fromPlatform);
      });
      return;
    }
    doRenderMarkdown(doc, cachedText, preHtml);
  }

  if (doc.kind === 'md'){
    btnToggle.onclick = function(){
      codeMode = !codeMode;
      btnToggle.classList.toggle('active', codeMode);
      btnToggle.querySelector('.lbl').textContent = codeMode ? '渲染' : '源码';
      if (codeMode){
        if (rawCache[doc.path] != null){ showSource(); return; }
        loadText(doc, function(err, text){
          if (stale()) return;
          if (codeMode && !err) renderCodeView(text);
          else if (codeMode) showNoSource(doc);
        });
      } else {
        showMd();
      }
    };
    showMd();
    return;
  }

  if (doc.kind === 'code'){
    btnToggle.style.display = 'none';
    if (cachedText != null){ renderCodeView(cachedText); return; }
    showLoading(doc);
    loadText(doc, function(err, text){
      if (stale()) return;
      if (err || text == null){ showLoadError(doc, err); return; }
      renderCodeView(text);
      docMetaEl.textContent = '纯文本';
    });
    return;
  }

  /*
   * HTML 文档：/p/archive/ 下的是**归档预渲染稿**（发布控制台产出的成品），
   * 当正文直接注入，不再当「HTML 源码」看。
   * 判据是路径落在 /p/archive/ 下 —— sk.json 里登记的就是这个写法，
   * 之外的手写 .html 仍然按源码显示（免得把一张独立页面糊进阅读器里）。
   * 注释里同样不能出现反引号：整段住在 String.raw 模板里。
   */
  if (doc.kind === 'html'){
    if (!isArchivedDoc(doc)){
      btnToggle.style.display = 'none';
      if (cachedText != null){ renderCodeView(cachedText); return; }
      showLoading(doc);
      loadText(doc, function(err, text){
        if (stale()) return;
        if (err || text == null){ showLoadError(doc, err); return; }
        renderCodeView(text);
        docMetaEl.textContent = 'HTML 源码';
      });
      return;
    }

    btnToggle.style.display = 'none';
    function showPrerendered(text){
      if (!text || !text.trim()){ showLoadError(doc, new Error('产物是空的')); return; }
      contentEl.innerHTML = '<div class="md">' + extractArchiveBody(text) + '</div>';
      /* 后面这几步和 Markdown 路线共用：相对路径、代码组、选项卡、复制按钮、卡片兜底 */
      fixURLs(contentEl);
      fixChartBlocks(contentEl);
      initCodeGroups(contentEl);
      initTabs(contentEl);
      addCodeCopyButtons(contentEl);
      if (window.DocsCard && typeof window.DocsCard.enhance === 'function'){
        try { window.DocsCard.enhance(contentEl); }catch(e){}
      }
      buildOutline();
      appendDocNav();
      contentEl.scrollTop = 0;
      updateProgress();
      docMetaEl.textContent = 'HTML · 归档预渲染';
    }

    if (cachedText != null){ showPrerendered(cachedText); return; }
    showLoading(doc);
    loadText(doc, function(err, text){
      if (stale()) return;
      if (err || text == null){ showLoadError(doc, err); return; }
      showPrerendered(text);
    });
    return;
  }

  /* 认不出类型：给个出口 */
  btnToggle.style.display = 'none';
  contentEl.innerHTML = '<div class="empty-main"><div class="inner"><h2>不支持预览</h2>' +
    '<p><code>' + esc(doc.path) + '</code></p>' +
    '<p style="margin-top:14px">用右上角「原文件」按钮在新标签页打开。</p></div></div>';
}

/** 渲染 Markdown 并接管后续（目录 / 进度 / 前后篇 / 链接重写） */
function doRenderMarkdown(doc, text, preHtml, fromPlatform){
  var html = preHtml;
  var fromPrerender = !!preHtml;

  if (html == null){
    if (fromPlatform){
      /* 平台已经把 md 渲染成 HTML 了（raw.php 不可用时的降级路径）。
         这已经是成品，再交给 Markdown 渲染器处理只会画蛇添足，
         直接当正文用。代价是公式退化成平台渲染的样子。 */
      html = text;
      docMetaEl.textContent = 'Markdown · 平台渲染';
    } else {
      if (!window.DocsMd || !window.DocsMd.ready()){
        showNoRenderer(doc);
        return;
      }
      try {
        html = window.DocsMd.render(text);
      } catch(e){
        renderLoadError(doc, '渲染失败：' + (e && e.message ? e.message : e));
        return;
      }
    }
    if (!fromPlatform) docMetaEl.textContent = 'Markdown';
  }

  if (fromPrerender) docMetaEl.textContent = 'Markdown · 预渲染';
  contentEl.innerHTML = '<div class="md">' + html + '</div>';
  fixURLs(contentEl);
  fixChartBlocks(contentEl);
  initCodeGroups(contentEl);
  initTabs(contentEl);
  addCodeCopyButtons(contentEl);

  /* <card> 兜底：预渲染稿和平台渲染稿没走行内规则，
     里面残留的 <card> 元素到这里才被换成真卡片。 */
  if (window.DocsCard && typeof window.DocsCard.enhance === 'function'){
    try { window.DocsCard.enhance(contentEl); }catch(e){}
  }

  buildOutline();
  appendDocNav();
  contentEl.scrollTop = 0;
  updateProgress();
}

/**
 * 复制按钮的图标。
 * ---------------------------------------------------
 * 用内联 SVG 而不是 <img>：那两个图标靠 fill:currentColor 继承文字颜色，
 * 走 <img> 会丢掉 currentColor，深色主题下直接看不见。
 * 所以这里只把 <path> 抠出来内联，颜色交给 CSS。
 *
 * 路径相对页面（/p/）→ ../asset/icon/…
 */
var CC_ICON = { base: '../asset/icon/', fill: null, line: null };
var CC_ICON_FAILED = false;
var CC_ICON_WAITING = [];

function ccExtractPath(svg){
  var m = /<path[^>]*\sd="([^"]+)"/.exec(svg || '');
  return m ? m[1] : null;
}

function ccSvg(d){
  return '<svg viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">' +
         '<path d="' + d + '"/></svg>';
}

function ccLoad(url){
  return fetch(url, { cache: 'force-cache' })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function(t){ var d = ccExtractPath(t); if (!d) throw new Error('没有 path'); return d; });
}

/**
 * 把图标拿回来。成功→换成图标按钮；失败→保持文字按钮。
 * 两个图标各有用途：fill 是常态，line 是悬停（和站点其它按钮一个路子）。
 */
function ccEnsureIcons(cb){
  if (CC_ICON.fill && CC_ICON.line){ cb(true); return; }
  if (CC_ICON_FAILED){ cb(false); return; }

  CC_ICON_WAITING.push(cb);
  if (CC_ICON_WAITING.length > 1) return;

  var done = function(okk){
    var list = CC_ICON_WAITING;
    CC_ICON_WAITING = [];
    if (!okk) CC_ICON_FAILED = true;
    list.forEach(function(f){ f(okk); });
  };

  Promise.all([
    ccLoad(CC_ICON.base + 'file-copy-fill.svg'),
    ccLoad(CC_ICON.base + 'file-copy.svg'),
  ]).then(function(pair){
    CC_ICON.fill = pair[0];
    CC_ICON.line = pair[1];
    done(true);
  }).catch(function(){
    done(false);
  });
}

/**
 * 代码组标签页
 * ---------------------------------------------------
 * 渲染器只输出 .code-group > .cg-tabs(空) + .cg-body > .cg-panel*
 * （面板上带 data-label）。标签按钮在这里按**真实面板数**生成，
 * 这样标签和面板永远对得上。
 *
 * 面板默认状态：第一个显示，其余 hidden。JS 挂了也至少看得见第一个。
 */
function initCodeGroups(root){
  var groups = root.querySelectorAll('.code-group');
  for (var i = 0; i < groups.length; i++){
    var box = groups[i];
    var tabsEl = box.querySelector('.cg-tabs');
    var panels = [].slice.call(box.querySelectorAll('.cg-panel'));
    if (!tabsEl || !panels.length) continue;

    /* 只有一个面板：标签行没意义 */
    if (panels.length === 1){
      box.setAttribute('data-single', 'true');
      panels[0].hidden = false;
      panels[0].classList.add('is-active');
      continue;
    }

    /* 生成标签 */
    var html = '';
    for (var n = 0; n < panels.length; n++){
      var label = panels[n].getAttribute('data-label') || ('代码 ' + (n + 1));
      html += '<button type="button" class="cg-tab' + (n === 0 ? ' is-active' : '') +
              '" role="tab" aria-selected="' + (n === 0 ? 'true' : 'false') +
              '" data-cg-i="' + n + '" tabindex="' + (n === 0 ? '0' : '-1') +
              '">' + esc(label) + '</button>';
    }
    tabsEl.innerHTML = html;

    /* 初始可见性 */
    for (var m = 0; m < panels.length; m++){
      panels[m].hidden = (m !== 0);
      panels[m].classList.toggle('is-active', m === 0);
    }

    /* 点击 / 键盘切换（委托到标签容器上，一次绑定） */
    (function(list, pnls){
      function pick(idx){
        var btns = list.querySelectorAll('.cg-tab');
        for (var k = 0; k < btns.length; k++){
          var on = (k === idx);
          btns[k].classList.toggle('is-active', on);
          btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
          btns[k].tabIndex = on ? 0 : -1;
          if (pnls[k]){
            pnls[k].hidden = !on;
            pnls[k].classList.toggle('is-active', on);
          }
        }
      }

      list.addEventListener('click', function(e){
        var btn = e.target.closest ? e.target.closest('.cg-tab') : null;
        if (!btn) return;
        pick(Number(btn.getAttribute('data-cg-i')));
      });

      /* 左右方向键切换，符合标签页的键盘习惯 */
      list.addEventListener('keydown', function(e){
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var btns = [].slice.call(list.querySelectorAll('.cg-tab'));
        var cur = btns.findIndex(function(b){ return b.classList.contains('is-active'); });
        if (cur < 0) return;
        e.preventDefault();
        var next = (e.key === 'ArrowRight')
          ? (cur + 1) % btns.length
          : (cur - 1 + btns.length) % btns.length;
        pick(next);
        btns[next].focus();
      });
    })(tabsEl, panels);
  }
}

/**
 * 标签页 ::: tabs / @tab（@mdit/plugin-tab）
 * ---------------------------------------------------
 * 渲染器已经把初始状态定好了（一个 .active + 对应的 aria-selected），
 * 所以这里只负责切换，不负责初始化 —— 没 JS 也至少看得见第一个标签的内容。
 *
 * 类名用的是插件的默认约定，所以官方 register-tab 脚本也能接管这堆 DOM；
 * 这里自己实现是为了和代码组共用一套交互，并且补上左右方向键和跨容器联动。
 */
function activateTab(btn, box){
  var idx = btn.getAttribute('data-tab');
  var btns = box.querySelectorAll('.tabs-tab-button');
  var panels = box.querySelectorAll('.tabs-tab-content');
  var i;
  for (i = 0; i < btns.length; i++){
    var on = btns[i].getAttribute('data-tab') === idx;
    btns[i].classList.toggle('active', on);
    btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    btns[i].tabIndex = on ? 0 : -1;
    if (on) btns[i].setAttribute('data-active', '');
    else btns[i].removeAttribute('data-active');
  }
  for (i = 0; i < panels.length; i++){
    var vis = panels[i].getAttribute('data-index') === idx;
    panels[i].classList.toggle('active', vis);
    if (vis) panels[i].setAttribute('data-active', '');
    else panels[i].removeAttribute('data-active');
  }
}

/* 同 id 的页签一起切：@tab 甲 #tab-a 写在两个容器里，点一个另一个跟着动。
   这是插件自带的行为（官方 register-tab 里也有），这里照实现一份。 */
function syncTabs(btn, box){
  var id = btn.getAttribute('data-id');
  if (!id) return;
  var all = document.querySelectorAll('.tabs-tab-button[data-id="' + id.replace(/"/g, '\\"') + '"]');
  for (var i = 0; i < all.length; i++){
    if (all[i] === btn) continue;
    var other = all[i].closest ? all[i].closest('.tabs-tabs-wrapper') : null;
    if (other && other !== box) activateTab(all[i], other);
  }
}

function initTabs(root){
  var wrappers = root.querySelectorAll('.tabs-tabs-wrapper');
  for (var i = 0; i < wrappers.length; i++){
    (function(box){
      var header = box.querySelector('.tabs-tabs-header');
      if (!header) return;
      var btns = [].slice.call(header.querySelectorAll('.tabs-tab-button'));
      /* 只有一个页签时标签行本来就是隐藏的，没什么可切 */
      if (btns.length < 2) return;

      header.addEventListener('click', function(e){
        var btn = e.target.closest ? e.target.closest('.tabs-tab-button') : null;
        if (!btn) return;
        activateTab(btn, box);
        syncTabs(btn, box);
      });

      header.addEventListener('keydown', function(e){
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var cur = btns.findIndex(function(b){ return b.classList.contains('active'); });
        if (cur < 0) return;
        e.preventDefault();
        var next = (e.key === 'ArrowRight')
          ? (cur + 1) % btns.length
          : (cur - 1 + btns.length) % btns.length;
        activateTab(btns[next], box);
        syncTabs(btns[next], box);
        btns[next].focus();
      });
    })(wrappers[i]);
  }
}

/**
 * 给每个代码块加一个复制按钮。
 * ---------------------------------------------------
 * 放在这里统一处理，是为了同时覆盖两种情况：
 *   · TEST.md 那种构建期预渲染的 HTML
 *   · 其余文档运行时渲染出来的 HTML
 * 改渲染器只能覆盖后者。
 *
 * 有图标就用图标（悬停看到、点一下变对勾）；
 * 图标取不到就退回「复制」文字，功能不受影响。
 */
function addCodeCopyButtons(root){
  var pres = root.querySelectorAll('pre');
  var made = [];
  for (var i = 0; i < pres.length; i++){
    var pre = pres[i];
    if (pre.querySelector(':scope > .code-copy')) continue;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = '复制';                 /* 图标到位前的样子，也是降级形态 */
    btn.setAttribute('aria-label', '复制这段代码');
    btn.title = '复制';
    btn.addEventListener('click', function(ev){
      ev.preventDefault();
      ev.stopPropagation();
      var self = this;
      var block = self.parentNode;
      var code = block.querySelector('code');
      var text = code ? code.textContent : block.textContent;
      /* 末尾那个换行是围栏自带的，复制时去掉更干净 */
      text = String(text).replace(/\n$/, '');
      copyText(text, function(okk){
        self.classList.toggle('ok', okk);
        self.classList.toggle('err', !okk);
        /* 没有图标时才改文字 */
        if (!CC_ICON.copy) self.textContent = okk ? '已复制' : '失败';
        self.title = okk ? '已复制' : '复制失败';
        setTimeout(function(){
          self.classList.remove('ok');
          self.classList.remove('err');
          self.title = '复制';
          if (!CC_ICON.copy) self.textContent = '复制';
        }, 1400);
      });
    });
    pre.appendChild(btn);
    made.push(btn);
  }

  if (!made.length) return;

  ccEnsureIcons(function(okk){
    if (!okk) return;                       /* 保持文字按钮 */
    made.forEach(function(btn){
      btn.classList.add('with-icon');
      btn.innerHTML = '<span class="cc-ico cc-ico-fill">' + ccSvg(CC_ICON.fill) + '</span>' +
                      '<span class="cc-ico cc-ico-line">' + ccSvg(CC_ICON.line) + '</span>';
    });
  });
}

/** 统一的复制入口：先试 Clipboard API，不行降级 execCommand */
function copyText(text, cb){
  var fallback = function(){
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-2000px';
    document.body.appendChild(ta);
    ta.select();
    var okk = false;
    try { okk = document.execCommand('copy'); } catch(e){ okk = false; }
    document.body.removeChild(ta);
    cb(okk);
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ cb(true); }, fallback);
    } else {
      fallback();
    }
  } catch(e){ fallback(); }
}

function showLoading(doc){
  outlineEl.classList.remove('on');
  contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
    '<h2 class="doc-loading-title">加载中…</h2><p>' + esc(doc.root) + '</p></div></div>';
}

function renderLoadError(doc, msg){
  outlineEl.classList.remove('on');
  contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
    '<h2>没能显示这篇</h2>' +
    '<p><code>' + esc(doc.root) + '</code></p>' +
    '<p style="color:var(--accent)">' + esc(String(msg)) + '</p>' +
    '<p style="margin-top:14px">可以用右上角「原文件」在新标签页打开。</p></div></div>';
}

function showLoadError(doc, err){
  renderLoadError(doc, err && err.message ? err.message : '读取失败');
}

/** 渲染器没就位时的说明（正常情况下不会发生，docs-md.js 就在同目录） */
function showNoRenderer(doc){
  outlineEl.classList.remove('on');
  contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
    '<h2>渲染器没加载</h2>' +
    '<p>同目录下的 <code>docs-md.js</code> 负责把 Markdown 画出来，这次没取到。</p>' +
    '<p style="margin-top:14px">确认它和 <code>docs.html</code> 一起上传了，然后刷新。</p></div></div>';
}

/** 原文不在页内时的兜底提示（正常情况下走不到这里） */
function showNoSource(doc){
  outlineEl.classList.remove('on');
  contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
    '<h2>这篇没有内联原文</h2>' +
    '<p><code>' + esc(doc.root) + '</code></p>' +
    '<p style="margin-top:14px">正文渲染稿不受影响，切回「渲染」继续阅读；' +
    '或用右上角「原文件」/「查看器」打开。</p></div></div>';
}

function renderCodeView(text){
  outlineEl.classList.remove('on');
  var lines = String(text).split('\n');
  var g = '';
  for (var i = 1; i <= lines.length; i++) g += '<span class="ln">' + i + '</span>';
  contentEl.innerHTML = '<div class="code-view"><div class="gutter">' + g + '</div>' +
    '<div class="code" id="__code"></div></div>';
  contentEl.querySelector('#__code').textContent = text;
  contentEl.scrollTop = 0;
  updateProgress();
}

/** 把正文里的相对链接补回网站根 */
function fixURLs(root){
  var i, el;
  var as = root.querySelectorAll('a[href]');
  for (i = 0; i < as.length; i++){
    el = as[i];
    el.setAttribute('href', renderURL(el.getAttribute('href')));
    if (/^https?:\/\//i.test(el.getAttribute('href'))){
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    }
  }
  var imgs = root.querySelectorAll('img[src]');
  for (i = 0; i < imgs.length; i++){
    el = imgs[i];
    el.setAttribute('src', renderURL(el.getAttribute('src')));
  }
}

/** 给被砍掉的图表代码块加一行说明 */
function fixChartBlocks(root){
  var pres = root.querySelectorAll('pre > code[class*="language-mermaid"],' +
    'pre > code[class*="language-plantuml"],pre > code[class*="language-flow"],' +
    'pre > code[class*="language-echarts"]');
  for (var i = 0; i < pres.length; i++){
    var pre = pres[i].parentNode;
    var note = document.createElement('p');
    note.className = 'md-chart-off';
    note.textContent = '图表渲染已下线，上方为源码。';
    pre.parentNode.insertBefore(note, pre.nextSibling);
  }
}

/* ═══ 本页目录 ═══ */

/**
 * 还放得下「停靠」的目录吗。
 * ---------------------------------------------------
 * 停靠目录是 226px 的常驻栏位，侧栏又是 280px：窗口不够宽时
 * 正文只剩一两百像素，英文单词都换行、中文一行几个字。
 * 900px 是「正文还能舒服读」的下限（那时正文栏还有 ~310px）。
 */
function fitsDockedOutline(){
  try { return matchMedia('(min-width: 901px)').matches; }
  catch(e){ return true; }
}

/**
 * 这次会话里目录该用哪种形态。
 * ---------------------------------------------------
 * 放不下停靠就用悬浮：它是浮层，不占正文的宽度。
 * 这只影响本次会话的呈现，不动用户存下来的设置 ——
 * 窗口拉宽回来还是他原来挑的那一种。
 */
function outlineMode(){
  if (settings.outline === 'off') return 'off';
  return fitsDockedOutline() ? settings.outline : 'float';
}

/* 悬浮形态默认收起：浮层展开着会压住正文标题（窄屏首屏就只剩它了）。
   要看目录点右上角那颗「本页目录」胶囊。 */
function syncOutlineOpen(){
  if (outlineMode() === 'float') outlineEl.classList.add('hide');
  else outlineEl.classList.remove('hide');
}

function buildOutline(){
  var heads = contentEl.querySelectorAll('.md h1, .md h2, .md h3, .md h4');
  var html = '';
  for (var i = 0; i < heads.length; i++){
    var h = heads[i];
    if (!h.id) continue;
    var lvl = parseInt(h.tagName.charAt(1), 10);
    if (lvl < 1 || lvl > 4) continue;
    var label = h.textContent.replace(/#\s*$/, '').trim();
    html += '<li class="lv-' + lvl + '"><a href="#' + esc(h.id) + '" data-target="' + esc(h.id) + '">' + esc(label) + '</a></li>';
  }
  outlineListEl.innerHTML = html;
  syncOutlineOpen();
  var has = heads.length > 1 && outlineMode() !== 'off';
  outlineEl.classList.toggle('on', has);
  if (has) setupOutlineSpy();
  updateOutlinePill();
}

var outlineSpyOff = null;
function setupOutlineSpy(){
  if (outlineSpyOff) outlineSpyOff();
  var links = outlineListEl.querySelectorAll('a');
  if (!links.length) return;

  function onScroll(){
    var heads = contentEl.querySelectorAll('.md h1, .md h2, .md h3, .md h4');
    if (!heads.length) return;
    var top = contentEl.getBoundingClientRect().top;
    var current = heads[0];
    for (var i = 0; i < heads.length; i++){
      if (heads[i].getBoundingClientRect().top - top <= 90) current = heads[i];
      else break;
    }
    var id = current ? current.id : null;
    for (var j = 0; j < links.length; j++){
      links[j].classList.toggle('active', links[j].dataset.target === id);
    }
    updateProgress();
  }

  contentEl.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  outlineSpyOff = function(){
    contentEl.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
  onScroll();
}

outlineListEl.addEventListener('click', function(e){
  var a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  var target = document.getElementById(a.dataset.target);
  if (!target) return;
  var offset = target.getBoundingClientRect().top - contentEl.getBoundingClientRect().top;
  var bar = document.querySelector('.main-bar');
  var barH = bar ? bar.offsetHeight : 52;
  contentEl.scrollTo({ top: contentEl.scrollTop + offset - barH - 14, behavior: 'smooth' });
});

outlineXEl.addEventListener('click', function(){
  outlineEl.classList.add('hide');
  updateOutlinePill();
});
outlinePillEl.addEventListener('click', function(){
  outlineEl.classList.remove('hide');
  updateOutlinePill();
});

function updateOutlinePill(){
  var has = outlineListEl.children.length > 1;
  outlinePillEl.classList.toggle('shown',
    outlineMode() === 'float' && has && outlineEl.classList.contains('hide'));
}

function refreshOutline(){
  syncOutlineOpen();
  var has = outlineListEl.children.length > 1 && outlineMode() !== 'off';
  outlineEl.classList.toggle('on', has);
  updateOutlinePill();
}

function updateProgress(){
  var max = contentEl.scrollHeight - contentEl.clientHeight;
  var p = max > 0 ? contentEl.scrollTop / max : 0;
  progressEl.style.transform = 'scaleX(' + Math.min(1, Math.max(0, p)) + ')';
  btnTopEl.classList.toggle('on', contentEl.scrollTop > 240);
}

/* ═══ 上一篇 / 下一篇 ═══ */
function appendDocNav(){
  var idx = -1;
  for (var i = 0; i < ALL.length; i++){ if (ALL[i].path === activePath){ idx = i; break; } }
  if (idx < 0) return;
  var prev = idx > 0 ? ALL[idx - 1] : null;
  var next = idx < ALL.length - 1 ? ALL[idx + 1] : null;
  if (!prev && !next) return;

  var mdEl = contentEl.querySelector('.md');
  if (!mdEl) return;

  var nav = document.createElement('nav');
  nav.className = 'doc-nav';

  function card(d, isNext){
    return '<a href="#" data-path="' + esc(d.path) + '"' + (isNext ? ' class="next"' : '') + '>' +
      '<span class="dir">' + (isNext ? '下一篇 →' : '← 上一篇') + '</span>' +
      '<span class="ttl">' + esc(d.name) + '</span></a>';
  }

  /* 目录是两列栅格。只有一边有卡片时（第一篇没有上一篇、最后一篇没有下一篇）
     以前会留一个透明的占位，卡片缩在半边 —— 桌面上右移、手机上是整行，
     两种宽度看着像两个东西。所以单边时干脆占满整行。 */
  var both = !!(prev && next);
  nav.innerHTML =
    (prev ? card(prev, false) : (both ? '<span class="ghost"></span>' : '')) +
    (next ? card(next, true) : (both ? '<span class="ghost"></span>' : ''));
  if (!both) nav.setAttribute('data-single', 'true');

  mdEl.appendChild(nav);
  nav.addEventListener('click', function(e){
    var a = e.target.closest('a[data-path]');
    if (!a) return;
    e.preventDefault();
    openDoc(a.dataset.path);
  });
}

/* ═══ 剧透块展开 ═══ */
document.addEventListener('click', function(e){
  var head = e.target.closest ? e.target.closest('.md-spoiler-head') : null;
  if (head && window.getSelection().toString()) return;
  if (head){
    var box = head.parentNode;
    var open = box.getAttribute('data-open') === 'true';
    box.setAttribute('data-open', open ? 'false' : 'true');
    head.setAttribute('aria-expanded', open ? 'false' : 'true');
  }
});

/* ═══ 图片灯箱 ═══ */
var lightboxEl = null;

function closeLightbox(){
  if (!lightboxEl) return;
  var el = lightboxEl;
  lightboxEl = null;
  el.classList.remove('on');
  setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 200);
}

document.addEventListener('click', function(e){
  var img = e.target.closest ? e.target.closest('.md img') : null;
  if (!img || img.closest('a')) return;
  e.preventDefault();
  closeLightbox();
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'md-lightbox';
  var big = document.createElement('img');
  big.src = img.currentSrc || img.src;
  big.alt = img.alt || '';
  lightboxEl.appendChild(big);
  lightboxEl.addEventListener('click', closeLightbox);
  document.body.appendChild(lightboxEl);
  requestAnimationFrame(function(){ lightboxEl.classList.add('on'); });
});

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') closeLightbox();
});

/* 图片可键盘打开 */
document.addEventListener('keydown', function(e){
  if (e.key !== 'Enter') return;
  var img = e.target;
  if (img && img.tagName === 'IMG' && img.closest('.md')){
    e.preventDefault();
    img.click();
  }
});

/* ═══ 设置 ═══ */
function applySettings(){
  var root = document.documentElement;
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-glass', settings.glass);
  root.setAttribute('data-outline', outlineMode());
  root.style.setProperty('--bar-alpha', settings.barOpacity + '%');
  root.classList.toggle('side-collapsed', !!settings.sideCollapsed);
  btnSideToggle.setAttribute('aria-expanded', String(!settings.sideCollapsed));
  btnSideCollapse.setAttribute('aria-expanded', String(!settings.sideCollapsed));
  root.style.setProperty('--fs-md', settings.fontSize + 'px');

  themeGridEl.querySelectorAll('.theme-opt').forEach(function(b){
    b.setAttribute('aria-pressed', String(b.dataset.theme === settings.theme));
  });
  glassGridEl.querySelectorAll('.opt-btn').forEach(function(b){
    b.setAttribute('aria-pressed', String(b.dataset.glass === settings.glass));
  });
  outlineGridEl.querySelectorAll('.opt-btn').forEach(function(b){
    b.setAttribute('aria-pressed', String(b.dataset.outline === settings.outline));
  });
  $('glassOut').textContent = GLASS_NAMES[settings.glass] || settings.glass;
  var opRange = $('opacityRange');
  if (opRange) opRange.value = settings.barOpacity;
  $('opacityOut').textContent = settings.barOpacity + '%';
  var fsRange = $('fsRange');
  if (fsRange) fsRange.value = settings.fontSize;
  $('fsOut').textContent = settings.fontSize + 'px';
  refreshOutline();
}

function saveSetting(k, v){
  settings[k] = v;
  try { localStorage.setItem('docs.' + k, String(v)); }catch(e){}
  applySettings();
}

(function initSettings(){
  try {
    var t = localStorage.getItem('docs.theme');        if (t) settings.theme = t;
    var g = localStorage.getItem('docs.glass');        if (GLASS_NAMES[g]) settings.glass = g;
    var a = parseInt(localStorage.getItem('docs.barOpacity'), 10);
    if (a >= 10 && a <= 100) settings.barOpacity = a;
    var o = localStorage.getItem('docs.outline');
    if (o === 'docked' || o === 'float' || o === 'off') settings.outline = o;
    settings.sideCollapsed = localStorage.getItem('docs.sideCollapsed') === 'true';
    var f = parseInt(localStorage.getItem('docs.fontSize'), 10);
    if (f && f >= 13 && f <= 20) settings.fontSize = f;
    var c = localStorage.getItem('docs.collapsed');
    if (c) collapsedGroups = JSON.parse(c) || {};
  }catch(e){}
})();

themeGridEl.addEventListener('click', function(e){
  var btn = e.target.closest('.theme-opt');
  if (btn) saveSetting('theme', btn.dataset.theme);
});
$('fsRange').addEventListener('input', function(e){ saveSetting('fontSize', Number(e.target.value) || 15); });
glassGridEl.addEventListener('click', function(e){
  var btn = e.target.closest('.opt-btn');
  if (btn) saveSetting('glass', btn.dataset.glass);
});
outlineGridEl.addEventListener('click', function(e){
  var btn = e.target.closest('.opt-btn');
  if (btn) saveSetting('outline', btn.dataset.outline);
});
$('opacityRange').addEventListener('input', function(e){ saveSetting('barOpacity', Number(e.target.value) || 78); });

/* ═══ 设置抽屉 ═══ */
var lastFocus = null;
function openDrawer(){
  lastFocus = document.activeElement;
  drawerEl.classList.add('on');
  scrimEl.classList.add('on');
  drawerEl.setAttribute('aria-hidden', 'false');
  $('drawerClose').focus();
}
function closeDrawer(){
  drawerEl.classList.remove('on');
  scrimEl.classList.remove('on');
  drawerEl.setAttribute('aria-hidden', 'true');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
btnSettings.addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
scrimEl.addEventListener('click', closeDrawer);
drawerEl.addEventListener('keydown', function(e){
  if (e.key !== 'Tab') return;
  var f = drawerEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

/* ═══ 侧栏事件 ═══ */
function setSideCollapsed(v){
  settings.sideCollapsed = !!v;
  try { localStorage.setItem('docs.sideCollapsed', String(settings.sideCollapsed)); }catch(e){}
  document.documentElement.classList.toggle('side-collapsed', settings.sideCollapsed);
  btnSideToggle.setAttribute('aria-expanded', String(!settings.sideCollapsed));
  btnSideCollapse.setAttribute('aria-expanded', String(!settings.sideCollapsed));
  syncSideScrim();
}

/**
 * 只改当前这次会话的侧栏开合，**不写 localStorage**。
 * 手机端一进来要默认收起，但那是「手机上的默认」，
 * 不该覆盖用户在桌面端的选择——否则同一台设备换个窗口大小就串了。
 *
 * 不过 settings 要跟着更新：后面从窄屏拉宽时要靠它恢复到
 * 用户最近一次的意图，不能拿一个过期的值去覆盖。
 */
function setSideCollapsedEphemeral(v){
  var collapsed = !!v;
  settings.sideCollapsed = collapsed;
  document.documentElement.classList.toggle('side-collapsed', collapsed);
  btnSideToggle.setAttribute('aria-expanded', String(!collapsed));
  btnSideCollapse.setAttribute('aria-expanded', String(!collapsed));
  if (sideScrimEl){
    var open = isNarrow() && !collapsed;
    sideScrimEl.hidden = !open;
    sideScrimEl.classList.toggle('on', open);
  }
}

/**
 * 手机端把侧栏做成覆盖层。
 * 桌面端侧栏是常驻栏位，「展开/收起」和手机端的「弹出/隐藏」语义不同，
 * 所以这里分开处理：只有窄屏才挂遮罩、才做焦点收回。
 */
function isNarrow(){
  try { return matchMedia('(max-width: 720px)').matches; }
  catch(e){ return false; }
}

function syncSideScrim(){
  if (!sideScrimEl) return;
  /* 手机端：侧栏「没被收起」＝ 正在显示 → 压暗背景 */
  var open = isNarrow() && !settings.sideCollapsed;
  sideScrimEl.hidden = !open;
  sideScrimEl.classList.toggle('on', open);
}

btnSideToggle.addEventListener('click', function(){ setSideCollapsed(!settings.sideCollapsed); });
btnSideCollapse.addEventListener('click', function(){ setSideCollapsed(true); });
btnTopEl.addEventListener('click', function(){ contentEl.scrollTo({ top: 0, behavior: 'smooth' }); });

if (sideScrimEl){
  sideScrimEl.addEventListener('click', function(){ setSideCollapsed(true); });
}

/* 窗口跨过断点时重新判断：
   从桌面拉窄 → 按手机端默认收起（别让常驻栏突然变遮罩挡屏）
   从手机拉宽 → 恢复桌面端上次的选择 */
var lastNarrow = isNarrow();
var lastDock = fitsDockedOutline();
window.addEventListener('resize', function(){
  var now = isNarrow();
  var nowDock = fitsDockedOutline();
  if (now === lastNarrow && nowDock === lastDock){ syncSideScrim(); return; }

  if (now !== lastNarrow){
    lastNarrow = now;
    if (now) setSideCollapsedEphemeral(true);
    else setSideCollapsed(settings.sideCollapsed);
  }
  lastDock = nowDock;
  /* 跨过断点要把目录形态重算一遍：位置不够就用悬浮（不占栏位） */
  applySettings();
});

/* 手机端按 Esc 收起侧栏；侧栏展开时锁住背景滚动 */
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && isNarrow() && !settings.sideCollapsed){
    setSideCollapsed(true);
  }
});

function toggleGroup(name){
  collapsedGroups[name] = !collapsedGroups[name];
  try { localStorage.setItem('docs.collapsed', JSON.stringify(collapsedGroups)); }catch(e){}
  renderSidebar();
}

fileListEl.addEventListener('click', function(e){
  var head = e.target.closest('.group-head');
  if (head){ toggleGroup(head.dataset.group); return; }
  var item = e.target.closest('.file-item');
  if (item) openDoc(item.dataset.path);
});

fileListEl.addEventListener('keydown', function(e){
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var head = e.target.closest('.group-head');
  if (head){ e.preventDefault(); toggleGroup(head.dataset.group); return; }
  var item = e.target.closest('.file-item');
  if (item){ e.preventDefault(); openDoc(item.dataset.path); }
});

searchInput.addEventListener('input', renderSidebar);
searchClear.addEventListener('click', function(){
  searchInput.value = '';
  renderSidebar();
  searchInput.focus();
});
searchInput.addEventListener('keydown', function(e){
  if (e.key === 'Escape'){
    e.preventDefault();
    if (searchInput.value){ searchInput.value = ''; renderSidebar(); }
    else searchInput.blur();
    return;
  }
  if (e.key === 'Enter'){
    e.preventDefault();
    var first = fileListEl.querySelector('.file-item');
    if (first) openDoc(first.dataset.path);
  }
});

/* ═══ 复制原文 ═══ */
/* 复制逻辑统一走 copyText（定义在上面，代码块按钮也用同一个） */
function doCopy(text){
  copyText(text, function(okk){
    if (okk) toast('已复制 ' + text.length + ' 字符');
    else toast('复制失败', true);
  });
}

btnCopy.addEventListener('click', function(){
  var doc = null;
  for (var i = 0; i < ALL.length; i++){ if (ALL[i].path === activePath){ doc = ALL[i]; break; } }
  if (!doc) return;

  getRaw(doc, function(text){
    if (text == null){ toast('这篇没有内联原文', true); return; }
    doCopy(text);
  });
});

/* ═══ 快捷键 ═══ */
window.addEventListener('keydown', function(e){
  var meta = e.metaKey || e.ctrlKey;
  var tag = (e.target && e.target.tagName) || '';
  var inField = tag === 'INPUT' || tag === 'TEXTAREA';

  if (meta && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')){
    e.preventDefault(); searchInput.focus(); searchInput.select(); return;
  }
  if (meta && e.shiftKey && (e.key === 'f' || e.key === 'F')){
    e.preventDefault(); searchInput.value = ''; renderSidebar(); searchInput.focus(); return;
  }
  if (meta && (e.key === 'c' || e.key === 'C') && !inField){
    if (!window.getSelection().toString() && !btnCopy.disabled){ e.preventDefault(); btnCopy.click(); }
  }
});

/* ═══ 深链接：地址栏 hash 变了就切正文 ═══
   两条路都会走到这里：
     · 正文里的 <card> 指向 /p/docs.html#某篇.md —— 同页只换 hash，浏览器不重载
     · 浏览器前进 / 后退键
   hash 指向清单里没有的篇目时安静忽略，不弹错。 */
window.addEventListener('hashchange', syncFromHash);

/* ═══ 启动 ═══ */

/* 供构建期自检使用：无副作用，也不属于页面必需接口 */
window.__fixURLs = fixURLs;
window.__renderURL = renderURL;
window.__loadManifest = loadManifest;
window.__parseManifest = parseManifest;

applySettings();
/* 手机端一进来就把侧栏收起来：让正文占满屏，要看列表点顶栏按钮。
   桌面端沿用上次的选择。 */
if (isNarrow()) setSideCollapsedEphemeral(true);
else setSideCollapsed(settings.sideCollapsed);
renderSidebar();

/* 深链接支持：#文档路径；兼容 ?f= / ?file=（老链接还得能用）
   注意顺序：清单是异步来的，所以「要打开哪一篇」必须等 fillFromGroups
   填完再解析 —— 否则 ALL 还是空的，深链接会静默失效、落到第一篇。 */
(function boot(){
  var want = rawHashWant() || queryWant();

  loadManifest(function(err, groups){
    if (err || !groups || !groups.length){
      contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
        '<h2>读不到文档清单</h2>' +
        '<p>页面会去找同级的 <code>sk.json</code>。</p>' +
        (err ? '<p style="color:var(--accent)">' + esc(err.message || String(err)) + '</p>' : '') +
        '<p style="margin-top:14px">确认 <code>sk.json</code> 已上传、格式是合法 JSON。</p></div></div>';
      return;
    }

    fillFromGroups(groups);
    renderSidebar();
    btnSideCollapse.title = '收起文档列表 · 共 ' + ALL.length + ' 篇';

    /* 清单到位了，现在才谈得上「按 hash 定位」。 */
    var hit = findDoc(want);
    if (!hit && ALL.length) hit = ALL[0];

    if (hit){
      /* 深链接落到的篇目：展开它在的组，方便一眼看到自己在哪 */
      revealInSidebar(hit);
      openDoc(hit.path, true);
    } else contentEl.innerHTML = '<div class="empty-main"><div class="inner">' +
      '<h2>清单是空的</h2><p>往 <code>sk.json</code> 里加一行键值对即可。</p></div></div>';
  });
})();

})();
`;


/**
 * 需要构建期预渲染的文档。
 *
 * 只有列在这里的才会被提前渲染成 HTML 内联进页面，其余一律在浏览器里
 * 用本地渲染器现场渲染 —— 所以你在 /p/ 放 .md、在 sk.json 加一行，
 * 刷新页面就能看到，不必重新构建。
 *
 * 什么时候该加进来：这篇文档很大、或者要保证爬虫/无 JS 环境下也能读到。
 * 注意预渲染会内联原文，体积会涨，别把整站都塞进来。
 */
const PRE_RENDER = new Set([
  'TEST.md',
]);

/**
 * 组装内联给页面的数据。
 *
 * 刻意不写构建时间戳：写进去会让每次构建都产出不同的 docs.html，
 * 哈希一变缓存全废。要版本就手动抬 ASSET_VERSION。
 */
function buildPayload(groups, docs, siteRootDir) {
  /* 内联清单兜底：优先会在运行时 fetch 最新版，取不到才用它 */
  const skPath = path.join(siteRootDir, 'sk.json');
  const inlineManifest = fs.existsSync(skPath) ? fs.readFileSync(skPath, 'utf8') : null;

  /* 预渲染稿：只有 PRE_RENDER 里的路径才有 */
  const prerendered = {};
  let preCount = 0;
  for (const [p, d] of docs) {
    if (!PRE_RENDER.has(p) || !d.html) continue;
    prerendered[p] = d.html;
    preCount++;
  }

  return { inlineManifest, prerendered, preCount };
}

function buildHtml({ groups, docs, cssHref }) {
  let tpl = fs.readFileSync(path.join(templateDir, 'docs.html'), 'utf8');

  /* ── 3.0 favicon：模板里留了占位行，按页面位置换成相对路径 ── */
  if (tpl.includes(FAVICON_PLACEHOLDER)) {
    tpl = tpl.replace(
      `<!-- ${FAVICON_PLACEHOLDER} -->`,
      faviconTags(relPrefix(path.join(srcDir, 'docs.html'))),
    );
  }

  /* ── 3.0b logo：把 logo.svg 内联进顶栏（跟随主题色） ── */
  if (tpl.includes(LOGO_PLACEHOLDER)) {
    const svg = inlineLogo({ className: 'logo-mark' });
    /* 占位符整行（含注释）换掉；拿不到 logo 就留空，不硬塞 */
    tpl = tpl.replace(/<!--\s*__LOGO__[^>]*-->/, svg || '');
    if (!svg) log('⚠ 没找到 asset/icon/logo.svg，顶栏 logo 留空');
  }

  /* ── 3.1 换掉 head 里的全部外链 ──
     样式级联顺序必须和原来一致：docs-md.css 在前，页面布局样式在后。 */
  tpl = tpl
    .replace(/^\s*<link rel="preconnect"[^>]*>\s*$/gm, '')
    .replace(/^\s*<link rel="dns-prefetch"[^>]*>\s*$/gm, '')
    .replace(/^\s*<link rel="stylesheet" href="https:\/\/cdn[^>]*>\s*$/gm, '')
    .replace(/^\s*<script defer src="https:\/\/cdn[^>]*><\/script>\s*$/gm, '')
    /* 外链渲染器整条拿掉：预渲染之后浏览器不需要它了 */
    .replace(/^\s*<script defer src="\.\/docs-md\.js[^"]*"><\/script>\s*$/gm, '')
    .replace(
      /<link rel="stylesheet" href="\.\/docs-md\.css[^"]*">/,
      `<link rel="stylesheet" href="${cssHref}">`,
    );

  if (/cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|preconnect|dns-prefetch/.test(tpl)) {
    throw new Error('模板 head 里还有 CDN 外链没清干净');
  }

  /* ── 3.2 顶栏徽标：模板里已经有骨架（状态点 + 状态词），这里只校验 ──
     以前这里会「替换成 static」，其实一次都没生效过（模板本来就带
     >static</span>，被那行判断直接跳过），留着只会让人以为构建期改过文案。
     文案由客户端脚本接管（加载中 / static / 已归档），模板只需结构对。 */
  if (!/id="loadBadge"/.test(tpl)) throw new Error('模板里找不到顶栏徽标 #loadBadge');
  if (!/class="load-dot"/.test(tpl)) throw new Error('#loadBadge 里没有状态点 .load-dot');
  if (!/class="lb-txt"/.test(tpl)) throw new Error('#loadBadge 里没有状态词 .lb-txt');

  /* ── 3.3 注入内联清单（兜底用）+ 预渲染稿 ── */
  const payload = buildPayload(groups, docs, siteRoot);
  tpl = tpl.replace(
    '<!-- __DOCS_BOOT__ -->',
    `<script>\nwindow.__SK__ = ${safeJson(payload.inlineManifest)};\n` +
    `window.__PRERENDERED__ = ${safeJson(payload.prerendered)};\n</script>\n` +
    /* <card> 的支持在 p/docs-card.js（站点自带，随页面一起上传）。
       必须排在 docs-md.js 之前：渲染器初始化时要 md.use(DocsCard.plugin)。 */
    `<script src="./docs-card.js?v=${ASSET_VERSION}"></script>`,
  );

  /* ── 3.4 内联客户端脚本（替换掉原来那一大坨 Markdown 渲染逻辑） ──
     注意连 <script> 标签一起吞掉：模板里这个标签紧跟在标记所在脚本之前 */
  if (!tpl.includes('__DOCS_LEGACY_START__')) {
    throw new Error('模板里找不到 __DOCS_LEGACY_START__ 标记，无法替换旧脚本');
  }
  const beforeJs = tpl;
  tpl = tpl.replace(
    /<script>\s*\(function\(\)\{\s*'use strict';\s*\/\* __DOCS_LEGACY_START__[\s\S]*?<\/script>\s*<\/body>/,
    `<script src="./docs-md.js?v=${ASSET_VERSION}"></script>\n<script>\n${DOCS_JS}\n</script>\n</body>`,
  );
  if (tpl === beforeJs) {
    throw new Error('客户端脚本没替换成功：模板旧脚本块的结构变了');
  }
  if (!tpl.includes('window.__SK__')) {
    throw new Error('客户端脚本没能注入');
  }

  /* ── 3.5 noscript 兜底 ──
     预渲染的那几篇直接把 HTML 放进来；其余的只列链接。
     浏览器端渲染的文档在无 JS 环境下本来就显示不了，列链接最诚实。 */
  tpl = tpl.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    `<noscript>\n${buildNoscript(groups, docs, payload.prerendered)}\n</noscript>`,
  );

  return tpl;
}

/* noscript 里的链接前缀（页面在 /p/ 下） */
const ROOT_PREFIX_FOR_NOSCRIPT = '../';

/** noscript 内容：预渲染全文 + 其余条目链接 */
function buildNoscript(groups, docs, prerendered) {
  let html = '<div class="noscript-wrap">' +
    '<h1>文档 · JinSuper</h1>' +
    '<p>这个页面用 JavaScript 在现场排版 Markdown。下面先把预渲染好的正文列出来，' +
    '其余资料给出原文件链接。</p>';

  for (const g of groups) {
    html += `<section><h2>${esc(g.name)}</h2><ul>`;
    for (const it of g.items) {
      const pre = prerendered[it.path];
      html += `<li><a href="${esc(ROOT_PREFIX_FOR_NOSCRIPT + it.path)}">${esc(it.name)}</a>`;
      if (pre) html += `<div class="md">${pre}</div>`;
      html += '</li>';
    }
    html += '</ul></section>';
  }

  return html + '</div>';
}

/* ═══════════════════════════════════════════════════
   主流程
   ═══════════════════════════════════════════════════ */

/* 单文件版（把字体 base64 内联）已废弃：
   平台硬规则明令禁止任何形式的 base64 编码。
   字体一律用 p/fonts/ 的文件路径引用。 */

async function main() {
  const t0 = performance.now();
  console.log('\n文档站构建 · 预渲染 + 本地化\n');

  /* 卡片插件是站点自带的（p/docs-card.js），但打包器要能在 build/lib 下找到它。
     每次构建从 p/ 复制一份过来，保证你在 p/ 改完就能生效，不用管两份。 */
  const cardSrc = path.join(srcDir, 'docs-card.js');
  const cardDst = path.join(here, 'lib', 'docs-card.cjs');
  if (fs.existsSync(cardSrc)) {
    fs.copyFileSync(cardSrc, cardDst);
    log(`卡片插件：p/docs-card.js → build/lib/docs-card.cjs（${kb(fs.statSync(cardDst).size)}）`);
  } else {
    log('⚠ 没找到 p/docs-card.js —— <card> 语法将不可用');
  }

  /* @mdit/plugin-tab 是 ESM 包，我们的打包器只认 CommonJS。
     它自带一个自包含的 UMD 构建（连 @mdit/helper 都打进去了），
     但那个文件在 "type":"module" 的包里，Node 和打包器都会按 ESM 解析。
     所以复制成 .cjs —— 扩展名一改，UMD 就走 CommonJS 分支，两边都能 require。
     每次构建刷新一次，升级依赖不用手动同步。 */
  const tabPkg = path.join(here, 'node_modules', '@mdit', 'plugin-tab');
  const tabSrc = path.join(tabPkg, 'dist', 'cdn.umd.js');
  const tabDst = path.join(here, 'lib', 'vendor', 'mdit-tab.cjs');
  if (fs.existsSync(tabSrc)) {
    let tabVer = '?';
    try { tabVer = JSON.parse(fs.readFileSync(path.join(tabPkg, 'package.json'), 'utf8')).version; }
    catch { /* 读不到版本号不影响打包 */ }
    fs.mkdirSync(path.dirname(tabDst), { recursive: true });
    const banner =
      '/* 自动生成，请勿手改。\n' +
      ` * 来源：@mdit/plugin-tab@${tabVer} dist/cdn.umd.js（自包含 UMD，已内联 @mdit/helper）\n` +
      ' * 由 build/build.mjs 在每次构建时从 node_modules 复制并改名为 .cjs。\n' +
      ' * 改名原因：原包是 "type":"module"，.js 会被 Node 与打包器当成 ESM；\n' +
      ' * 换成 .cjs 后 UMD 走 CommonJS 分支，构建期（Node）和浏览器端（自写打包器）都能 require。\n' +
      ' */\n';
    fs.writeFileSync(tabDst, banner + fs.readFileSync(tabSrc, 'utf8'), 'utf8');
    log(`Tab 插件：@mdit/plugin-tab@${tabVer} → build/lib/vendor/mdit-tab.cjs（${kb(fs.statSync(tabDst).size)}）`);
  } else {
    log('⚠ 没找到 @mdit/plugin-tab —— ::: tabs 语法将不可用（npm i @mdit/plugin-tab）');
  }

  /* 清单 */
  const groups = readManifest();
  const allItems = groups.flatMap((g) => g.items);
  log(`清单：${groups.length} 组 / ${allItems.length} 篇`);

  /* 预渲染 */
  const docs = new Map();
  let renderFailed = 0;
  for (const it of allItems) {
    try {
      const d = renderOne(it.path);
      docs.set(it.path, d);
      log(`  ✓ ${it.name.padEnd(18)} ${d.kind.padEnd(6)} ${kb(d.bytes).padStart(9)}  →  ${d.html ? kb(d.html.length) : '—'}`);
    } catch (e) {
      renderFailed++;
      log(`  ✗ ${it.name}  ${e.message}`);
    }
  }

  /* 浏览器端 bundle（本地化，不再引 CDN） */
  const bundle = await buildBrowserBundle({ root: here, siteRoot });
  log(`浏览器端渲染器：${bundle.file}  ${kb(bundle.bytes)}  ${bundle.modules} 个模块`);
  if (bundle.skipped.length) log(`  └ 未打包（按需）：${bundle.skipped.join(', ')}`);
  for (const w of bundle.warnings) log(`  └ ⚠ ${w}`);

  /* CSS：现有样式 + KaTeX + 字体 */
  const css = buildDocsCss({ root: here, siteRoot });
  log(`样式：docs-md.css  ${kb(css.bytes)}   字体：${css.fontCount} 个 ${kb(css.fontBytes)}`);

  /* 输出 docs.html */
  const html = buildHtml({ groups, docs, cssHref: `./docs-md.css?v=${ASSET_VERSION}` });
  const htmlPath = path.join(srcDir, 'docs.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  /* ── 给站点里手写的页面补 favicon ──
     docs.html 上面已经处理过；其余页面（Skills/、p/viewer.html、404.html 等）
     由那个脚本统一注入，幂等，已注入的会跳过。 */
  try {
    const fav = spawnSync(process.execPath, [path.join(here, 'add-favicon.mjs')], {
      encoding: 'utf8', cwd: here,
    });
    const line = (fav.stdout || '').trim().split('\n').filter((l) => /已注入|跳过|待处理/.test(l));
    if (line.length) log('favicon：' + line.join(' · ').trim());
  } catch (e) {
    log('⚠ favicon 注入跳过：' + e.message);
  }

  /* ── 重新生成站点索引类文件 ──
     sitemap.xml、docs/info/site-index.js 由清单 + 扫盘生成；
     不写时间戳，所以同样的输入产出一模一样（--check 靠这一点比对）。
     直接调库而不是 spawn：这个环境里跨进程捞输出会被管道限制挡掉。 */
  try {
    const { outputs } = collectOutputs();
    const written = writeOutputs(outputs);
    log(written.length
      ? '站点索引：' + written.map((w) => (w.created ? '＋' : '±') + w.label).join(' · ')
      : '站点索引：未变化');
  } catch (e) {
    log('⚠ 站点索引生成跳过：' + e.message);
  }

  const ms = (performance.now() - t0).toFixed(0);
  const bytes = fs.statSync(htmlPath).size;

  console.log('\n产物');
  log(`p/docs.html      ${kb(bytes)}`);
  log(`p/docs-md.js     ${kb(bundle.bytes)}`);
  log(`p/docs-md.css    ${kb(css.bytes)}`);
  log(`p/fonts/         ${css.fontCount} 个文件`);
  log(`构建耗时         ${ms}ms`);
  if (renderFailed) log(`渲染失败         ${renderFailed} 篇`);
  console.log('');

  if (renderFailed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n构建失败：');
  console.error(e);
  process.exit(1);
});
