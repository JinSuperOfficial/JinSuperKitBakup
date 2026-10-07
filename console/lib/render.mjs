/**
 * 预渲染器（控制台专用）
 * ---------------------------------------------------
 * 职责：Markdown → 可以直接当正文用的 HTML，外加一个能独立打开的整页外壳。
 *
 * 它**复用构建期的服务端渲染核心** `build/lib/markdown.cjs`，而不是另写一套。
 * 为什么这样满足约束：
 *   · 约束说的是「别改网页版渲染器 docs-md.js」——这里一个字节都没碰它；
 *   · 「能力覆盖全部现代语法插件」——markdown.cjs 与 docs-md.js 语法一一对应
 *     （KaTeX / highlight.js / 告示 / 提示框 / 选项卡 / 代码组 / 剧透 / 脚注 /
 *      卡片 / 目录 / 注音 / 任务列表 / 定义列表 / 上下标 / 标记 / emoji …）；
 *   · 「不要和已有的重叠」——重叠的是**同一份实现**，不是第二份。
 *     两份渲染装配代码并行维护才是真风险（改一处漏一处），这里刻意避免。
 *
 * 拿不到渲染核心时（比如 build/node_modules 没装）会给出可读错误，
 * 由 API 层转成 500 并把原因回给界面，而不是静默产出半成品。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDir, isFile, siteRoot } from './paths.mjs';
import { bakeSetup, previewSetup } from './md-extras.mjs';
/* 文章外壳（顶栏 / 两列布局 / 侧栏目录 / 页脚）与静态文章页共用同一份，
   别在这里另抄一套标记和样式 —— 抄一遍就等着分叉。见 build/lib/chrome.mjs。 */
import {
  chromeCss, chromeScript, chromeThemeCss, siteNavHtml,
  tocAsideHtml, chromeBody, footRowHtml,
} from '../../build/lib/chrome.mjs';
import { inlineLogo } from '../../build/lib/logo.mjs';
import { parseArchiveMeta } from '../../build/lib/posts.mjs';

/* build/lib 下的文件按 CJS 加载；它自己的 require('markdown-it') 等会从
   build/node_modules 解析 —— 所以控制台不需要再装一遍依赖。 */
const buildRequire = createRequire(path.join(buildDir, 'package.json'));

let core = null;
let coreError = null;

/** 懒加载渲染核心；只加载一次 */
export function getCore() {
  if (core || coreError) return core;
  try {
    core = buildRequire('./lib/markdown.cjs');
    return core;
  } catch (e) {
    coreError = e;
    const err = new Error(
      '读不到预渲染核心 build/lib/markdown.cjs：' + (e && e.message ? e.message : e) +
      '\n（它依赖 build/node_modules，先在 build/ 里跑一次 npm install）',
    );
    err.status = 500;
    throw err;
  }
}

/** 渲染核心是否就绪（界面用来自检） */
export function coreStatus() {
  try {
    getCore();
    return { ok: true, file: path.join(buildDir, 'lib', 'markdown.cjs') };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* ── 两个实例：预览（增强全开）与归档（只烘静态内容） ──
   ---------------------------------------------------
   文档站构建用的是渲染核心里那个共享单例（renderMarkdown），本文件不碰它。
   这里两个实例**只归控制台用**，装配函数在 lib/md-extras.mjs：
     · preview —— 预览：ECharts 服务端出内联 SVG，mermaid 留占位交给浏览器画；
     · bake    —— 归档：只有能变成静态 HTML 的增强才生效（ECharts），
                  mermaid 这类要浏览器运行时的退回代码块 ——
                  所以归档产物**不引用任何外部插件脚本**，自己就是完整的。
   两个实例都懒建、只建一次。 */
let previewRenderer = null;
let bakeRenderer = null;

function rendererFor(mode) {
  const c = getCore();
  /* 控制台从 build/node_modules 里注入公式与高亮引擎（和站点构建同一条路）。
     不注入的话 KaTeX 不排版、代码不高亮，预览就和文档站长得不一样。 */
  if (typeof c.ensureEngines === 'function') c.ensureEngines();
  if (mode === 'bake') {
    if (!bakeRenderer) bakeRenderer = c.createRenderer({ setup: [bakeSetup] });
    return bakeRenderer;
  }
  if (!previewRenderer) previewRenderer = c.createRenderer({ setup: [previewSetup] });
  return previewRenderer;
}

/** setup 阶段出的错（插件装坏了之类），界面自检与预览提示会读 */
export function setupErrors() {
  const out = [];
  for (const [mode, r] of [['preview', previewRenderer], ['bake', bakeRenderer]]) {
    if (r && Array.isArray(r.__setupErrors) && r.__setupErrors.length) {
      out.push(...r.__setupErrors.map((m) => mode + ' · ' + m));
    }
  }
  return out;
}

/**
 * Markdown 源码 → HTML 片段（就是阅读器注入正文的那一段）。
 * 默认走**预览**实例（带图表增强）；归档外壳里显式要 bake 实例。
 */
export function renderFragment(md, { mode = 'preview' } = {}) {
  return getCore().renderWith(rendererFor(mode), String(md == null ? '' : md));
}

/**
 * 从站点根相对路径（如 p/archive/idea/1.html）算出回到站点根需要几级 ../
 * ---------------------------------------------------
 * 段数 − 1 = 该文件所在目录的深度（`p/archive/idea/1.html` → 3 级），
 * 也就是要往上走几次才到站点根。
 */
export function rootPrefixFor(siteRelPath) {
  const segs = String(siteRelPath).split('/').filter(Boolean);
  return '../'.repeat(Math.max(0, segs.length - 1));
}

/**
 * 从站点根相对路径算出回到 /p/ 目录需要几级 ../
 * ---------------------------------------------------
 * 归档产物在 /p/archive/…，而 docs-md.css 与 docs-card.js 住在 /p/ 下。
 * 这两个前缀不一样，混用会写出死链：
 *   p/archive/x.html        → 站点根 ../../ 、 /p ../
 *   p/archive/idea/x.html   → 站点根 ../../../ 、 /p ../../
 * （早先把 CSS 也接在站点根前缀上，产物里就成了 /docs-md.css → 404，
 *   独立打开产物时没有样式；2026-10 的死链检查把它抓出来了。）
 */
export function pDirPrefixFor(siteRelPath) {
  const segs = String(siteRelPath).split('/').filter(Boolean);
  return '../'.repeat(Math.max(0, segs.length - 2));
}

const ESC = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 整页外壳要用的站点身份与 SEO 标签
 * ---------------------------------------------------
 * 归档产物是**能独立打开、也会被搜索引擎抓到的**页面（`/p/archive/**`）。
 * 以前它只有一个 title 和一句 description，没有 canonical、没有分享卡片 ——
 * 站点改成博客之后，这里跟 `build/build.mjs` 用同一份 `site.json` 的 `blog` 段，
 * 别让「构建出来的文章页」和「控制台烘的归档稿」两套头部各说各话。
 */
let blogCache = null;
function blogInfo() {
  if (blogCache) return blogCache;
  const fallback = {
    title: 'JinSuper 奇思妙想',
    desc: 'JinSuper 的随笔与手稿。',
    origin: 'https://jinsuper.rth1.xyz',
    author: 'JinSuper',
  };
  let blog = {};
  try {
    const site = JSON.parse(fs.readFileSync(path.join(siteRoot, 'site.json'), 'utf8'));
    if (site && site.blog && typeof site.blog === 'object') blog = site.blog;
  } catch { /* 读不到就用默认值，不能让归档因为一个配置文件挂掉 */ }
  blogCache = { ...fallback, ...blog, origin: String(blog.origin || fallback.origin).replace(/\/+$/, '') };
  return blogCache;
}

/** 站点相对路径 → 地址里的一段段 percent-encode（中文文件名必须编码） */
function encodeSitePath(p) {
  return String(p).split('/').map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg))).join('/');
}

/** 归档产物的 head：canonical / OG / Twitter / JSON-LD，规则与文章页一致 */
function archiveHead({ title, desc, url, siteRel, published, tags }) {
  const blog = blogInfo();
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: desc,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: published || undefined,
    author: { '@type': 'Person', name: blog.author },
    publisher: { '@type': 'Organization', name: blog.title },
    inLanguage: 'zh-CN',
    keywords: tags && tags.length ? tags.join(',') : undefined,
    isPartOf: { '@type': 'Blog', name: blog.title, url: `${blog.origin}/p/docs.html` },
  };
  const meta = (attr, key, val) => (val ? `<meta ${attr}="${key}" content="${ESC(val)}">\n` : '');
  return (
    `<meta name="description" content="${ESC(desc)}">\n` +
    `<title>${ESC(title)} · ${ESC(blog.title)}</title>\n` +
    '<meta name="robots" content="index,follow,max-image-preview:large">\n' +
    `<link rel="canonical" href="${ESC(url)}">\n` +
    `<link rel="alternate" type="application/rss+xml" title="${ESC(blog.title)} · RSS" href="${pDirPrefixFor(siteRel)}feed.xml">\n` +
    meta('property', 'og:type', 'article') +
    meta('property', 'og:site_name', blog.title) +
    meta('property', 'og:title', title) +
    meta('property', 'og:description', desc) +
    meta('property', 'og:url', url) +
    meta('property', 'og:locale', 'zh_CN') +
    meta('property', 'article:published_time', published) +
    meta('name', 'twitter:card', 'summary') +
    meta('name', 'twitter:title', title) +
    meta('name', 'twitter:description', desc) +
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/<\/script/gi, '<\\/script')}</script>\n`
  );
}

/**
 * 整页外壳（归档产物用）。
 * ---------------------------------------------------
 * 结构要点：
 *   · 正文固定包在 `<article class="md" id="post">` 里 —— 阅读器 SPA 内联这段 HTML 时，
 *     CSS 与后续脚本（代码组、选项卡、复制按钮、card 兜底）都按这个类名接管；
 *   · 顶栏与侧栏目录跟静态文章页 `/p/post/*.html` **共用同一份**（build/lib/chrome.mjs）：
 *     导航项、目录标记、`.wrap` 单列 / 两列、CSS、脚本都从那儿来，
 *     所以归档稿看起来、用起来和构建出来的文章页一模一样；
 *   · 样式表用相对前缀指回 /p 下的 docs-md.css，所以这个文件**单独打开也是完整的**；
 *   · 会执行脚本（选项卡 / 代码组 / 复制 / 剧透 / 目录高亮），但不带任何 CDN。
 */
export function renderShell({ bodyHtml, title, desc, tags = [], published = '', canonical = '', siteRel, theme = 'obsidian', tocItems = null }) {
  const prefix = rootPrefixFor(siteRel);
  const pPrefix = pDirPrefixFor(siteRel);
  const blog = blogInfo();
  const items = tocItems || tocFromHtml(bodyHtml);
  /* canonical 空着就等于没写 —— 落回自己的地址，别生成 href="" 这种半截标签
     （老产物里没有 canonical，重刷外壳时就会遇到） */
  const canon = canonical || `${blog.origin}/${encodeSitePath(String(siteRel).replace(/^\/+/, ''))}`;

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${ESC(theme)}" data-glass="mica">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>document.documentElement.classList.add('has-js');</script>
${archiveHead({ title, desc, url: canon, siteRel, published, tags })}<!-- 由发布控制台预渲染：源 Markdown 在项目根 para\\ 留底，这里是成品 -->
<link rel="stylesheet" href="${pPrefix}docs-md.css">
<style>
/* 主题 token：构建时从 build/template/docs.html 抠出来（build/lib/theme.mjs），别抄第二遍 */
${chromeThemeCss()}
/* 文章外壳：和 /p/post/*.html 是同一份（build/template/post-chrome.css） */
${chromeCss()}
</style>
</head>
<body>

${chromeBody({
    brandHref: pPrefix,
    brandTitle: blog.title,
    brandSubHtml: '<span class="brand-sub" id="brandSub"></span>',
    logoHtml: inlineLogo({ className: 'logo-mark' }) || '',
    navHtml: siteNavHtml('', { blogHome: '/p/', feedUrl: '/p/feed.xml' }),
    tocHtml: tocAsideHtml(items, { fallbackTitle: title }),
    articleHtml: bodyHtml,
    footerHtml: footRowHtml([
      '© JinSuper · 想到什么写什么',
      `<a href="${pPrefix}">博客首页</a>`,
      `<a href="${pPrefix}feed.xml">订阅 RSS</a>`,
      `<a href="${prefix}">回百宝箱</a>`,
    ]),
  })}

<script src="${prefix}p/docs-card.js"></script>
<script src="${prefix}p/docs-md.js"></script>
<script>
${chromeScript()}
</script>
</body>
</html>
`;
}

/** 正文里的标题 → 侧栏目录项（层级归一成相对级别，和静态文章页同一套规则） */
function tocFromHtml(html) {
  try {
    const core = getCore();
    if (!core || typeof core.tocEntries !== 'function') return [];
    const list = core.tocEntries(html).filter((e) => e.level <= 3);
    return typeof core.normalizeTocLevels === 'function' ? core.normalizeTocLevels(list) : list;
  } catch { return []; }
}

/**
 * 从**已有的归档产物**里抠出正文与元数据。
 * 用途：控制台的「重刷外壳」—— 不想（或不能）重新渲染正文时，
 * 只把外壳（head / 顶栏 / 目录 / 页脚）换成当前这一版。
 *
 * @returns {{bodyHtml:string, meta:object}|null} 找不到正文容器就返回 null
 */
export function extractProductParts(html) {
  const bodyHtml = sliceMdBody(html);
  if (bodyHtml == null) return null;
  return { bodyHtml, meta: parseArchiveMeta(html) };
}

/** 抠出 `<div class="md">…</div>` 或 `<article class="md" id="post">…</article>` 的**内容** */
export function sliceMdBody(html) {
  const src = String(html == null ? '' : html);
  const open = /<(div|article)\b[^>]*\bclass="md"[^>]*>/i.exec(src);
  if (!open) return null;
  const tag = open[1];
  const scan = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
  scan.lastIndex = open.index + open[0].length;
  let depth = 1;
  let m;
  while ((m = scan.exec(src)) !== null) {
    if (m[0].slice(0, 2) === '</') {
      depth -= 1;
      if (!depth) return src.slice(open.index + open[0].length, m.index);
    } else if (!/\/\s*>$/.test(m[0])) {
      depth += 1;
    }
  }
  return null;
}

/**
 * 归档产物的整页 HTML（正文走 **bake 实例**：能烘成静态标记的增强会落进产物，
 * 需要浏览器运行时的（mermaid）不落 —— 归档 HTML 不依赖任何外部插件脚本）。
 */
export function renderArticleHtml(md, opts = {}) {
  const siteRel = opts.siteRel || 'p/archive/doc.html';
  const html = renderFragment(md, { mode: 'bake' });

  /* 标题与摘要优先取 frontmatter（和阅读器、文章页同一套解析） */
  let fm = {};
  try {
    const core = getCore();
    if (core && typeof core.parseFrontmatter === 'function') {
      const r = core.parseFrontmatter(String(md == null ? '' : md));
      if (r && r.ok) fm = r.data || {};
    }
  } catch { /* 拿不到就退回 opts.title */ }

  const title = String(fm.title || fm.name || opts.title || '归档文档');
  const desc = String(fm.summary || fm.description || fm.excerpt || `${title} · 归档预渲染稿`);
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String)
    : (fm.tags ? String(fm.tags).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : []);
  const published = String(fm.date || fm.updated || '').replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const blog = blogInfo();
  const selfUrl = `${blog.origin}/${encodeSitePath(String(siteRel).replace(/^\/+/, ''))}`;
  /* frontmatter 里的 canonical：同一篇文章既有活着的 /p/ 正文、
     又有这份归档稿时，把它指到真正的那个地址（一般就是 /p/post/… 的文章页），
     免得两个地址被搜索引擎当成两份内容。写法：站点路径或完整 URL。 */
  const canonical = fm.canonical
    ? (/^https?:\/\//i.test(String(fm.canonical))
      ? String(fm.canonical)
      : blog.origin + '/' + encodeSitePath(String(fm.canonical).replace(/^\/+/, '')))
    : selfUrl;

  return renderShell({
    bodyHtml: html,
    title,
    desc,
    tags,
    published: /^\d{4}-\d{2}-\d{2}/.test(published) ? published : '',
    canonical,
    siteRel,
    theme: opts.theme || 'obsidian',
  });
}

/* ── 版本备份：归档产物覆盖前先留一份 ── */

/** 版本目录（放在归档目录下，点开头，扫描时会跳过） */
export function versionsDirOf(archiveDir) {
  return path.join(archiveDir, '.versions');
}

/**
 * 把现有产物存进 .versions，并裁到最近 keep 份。
 * @returns {string[]} 被清掉的旧版本绝对路径
 */
export function backupVersion(fileAbs, archiveDir, keep = 2) {
  if (!isFile(fileAbs)) return [];
  const dir = path.join(versionsDirOf(archiveDir), path.relative(archiveDir, path.dirname(fileAbs)));
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(fileAbs);
  fs.copyFileSync(fileAbs, path.join(dir, base + '.' + stamp + '.bak'));

  /* 只留最近 keep 份 */
  const all = fs.readdirSync(dir)
    .filter((n) => n.startsWith(base + '.') && n.endsWith('.bak'))
    .sort();
  const removed = [];
  while (all.length > keep) {
    const victim = path.join(dir, all.shift());
    try { fs.unlinkSync(victim); removed.push(victim); } catch { /* 删不掉不影响归档 */ }
  }
  return removed;
}

/** 列出某个产物已有的版本（新的在前） */
export function listVersions(fileAbs, archiveDir) {
  const dir = path.join(versionsDirOf(archiveDir), path.relative(archiveDir, path.dirname(fileAbs)));
  const base = path.basename(fileAbs);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.startsWith(base + '.') && n.endsWith('.bak'))
    .sort()
    .reverse()
    .map((n) => ({ name: n, abs: path.join(dir, n) }));
}
