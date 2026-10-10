/**
 * 博客：文章清单、静态文章页路径、订阅源（feed）
 * ---------------------------------------------------
 * 「JinSuper 奇思妙想」是一份博客，但它不是另一套系统：
 * 文章的**唯一来源**还是 sk.json 加 p/ 下的 .md，
 * 这里只负责把同一批内容再铺一条「搜索引擎和 RSS 阅读器看得懂」的路：
 *
 *   p/post/<和 /p/ 下同结构的相对路径>.html   每篇文章一个独立网址
 *   p/feed.xml                                RSS 2.0，最新在前
 *   sitemap.xml                               由 site-index.mjs 调 listPosts() 收录
 *
 * 为什么非要静态页：阅读器是「一个页面 + hash 切换」，
 * /p/docs.html#idea%2F3.xxx.md 这种地址在搜索引擎眼里和 /p/docs.html 是同一个页面，
 * 文章再多也只有一个网址能被收录。静态页才是真正的独立网址。
 *
 * 这一份清单被两个地方读：build.mjs（生成页面）与 site-index.mjs（生成 sitemap）。
 * 两边算法必须一致，所以**只有这一个实现** —— 别在别处再算一遍 slug。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { siteRoot, paths } from '../paths.mjs';

/* markdown.cjs 是 CJS，frontmatter 的解析规则要和渲染器完全一致，只能共用这一份 */
const require = createRequire(import.meta.url);
const M = require('./markdown.cjs');

/** 静态文章页落地的目录（站点内：/p/post/） */
export const POST_DIR = path.join(siteRoot, 'p', 'post');
/** 站点绝对地址前缀 */
export const POST_URL_PREFIX = '/p/post/';
/** 订阅源 */
export const FEED_FILE = path.join(siteRoot, 'p', 'feed.xml');
export const FEED_URL = '/p/feed.xml';
/** 博客首页（列表 + 时间线 + 标签筛选）——原来的 /p/index.html 已经换成它 */
export const BLOG_HOME = '/p/';

/* ═══════════════════════════════════════════════════
   0. 站点身份（site.json 的 blog 段）
   ---------------------------------------------------
   标题 / 简介 / 主域名 / 默认作者只写在 site.json 一处。
   阅读器、文章页、博客首页、feed、结构化数据都从这里取。
   ═══════════════════════════════════════════════════ */

const BLOG_FALLBACK = {
  title: 'JinSuper 奇思妙想',
  desc: 'JinSuper 的随笔与手稿：想到什么写什么，写完就搁在这儿。',
  origin: 'https://www.jinsuper.cn',
  author: 'JinSuper',
};

let blogCache = null;

/** 读 site.json 的 blog 段（带默认值；origin 去掉结尾斜杠） */
export function readBlog() {
  if (blogCache) return blogCache;
  let site = null;
  try {
    site = JSON.parse(fs.readFileSync(path.join(siteRoot, 'site.json'), 'utf8'));
  } catch { /* 读不到就用默认值 */ }
  const blog = site && site.blog && typeof site.blog === 'object' ? site.blog : {};
  blogCache = {
    ...BLOG_FALLBACK,
    ...blog,
    origin: String(blog.origin || BLOG_FALLBACK.origin).replace(/\/+$/, ''),
  };
  return blogCache;
}

/* ═══════════════════════════════════════════════════
   1. 读清单 + 文章元数据
   ═══════════════════════════════════════════════════ */

/**
 * 读 sk.json（「分组 → { 标题: 路径 }」两层结构），摊平成数组。
 * @returns {Array<{group:string, name:string, path:string}>}
 */
export function readSkEntries() {
  const out = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(paths.sk, 'utf8'));
  } catch {
    return out;
  }
  for (const [group, val] of Object.entries(data || {})) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [name, p] of Object.entries(val)) {
        if (typeof p === 'string' && p.trim()) out.push({ group, name, path: p.trim() });
      }
    } else if (typeof val === 'string' && val.trim()) {
      out.push({ group, name: group, path: val.trim() });
    }
  }
  return out;
}

/** sk.json 里的路径写法 → 站点内的真实文件（'p/archive/x.html' 与 'archive/x.html' 都收） */
export function diskPathOf(skPath) {
  const assetMatch = /^\.\.\/asset\/(.+)$/.exec(String(skPath));
  if (assetMatch) return path.resolve(siteRoot, '..', 'asset', assetMatch[1]);
  return path.resolve(siteRoot, 'p', String(skPath).replace(/^\.?\//, '').replace(/^p\//, ''));
}

/** 站点绝对地址里的中文 / 空格要逐段 percent-encode（'.' 与 '..' 原样） */
export function encodeSitePath(p) {
  return String(p)
    .split('/')
    .map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg)))
    .join('/');
}

/**
 * 一篇文章的静态页地址。
 * 目录结构照搬 /p/ 下的写法，只是换了根：
 *   idea/3.枣香童年.md  →  /p/post/idea/3.枣香童年.html
 * @param {string} skPath sk.json 里的路径
 * @returns {string|null} 站点绝对地址；不是 /p/ 下的 .md 就返回 null
 */
export function postHref(skPath) {
  const rel = String(skPath || '').replace(/^\.?\//, '').replace(/^p\//, '');
  if (!/\.(md|markdown|mdown|mkd)$/i.test(rel)) return null;
  const noExt = rel.replace(/\.(md|markdown|mdown|mkd)$/i, '');
  if (!noExt || noExt.split('/').includes('..')) return null;
  return POST_URL_PREFIX + encodeSitePath(noExt) + '.html';
}

/**
 * 站点绝对地址 → 磁盘路径（postHref 的逆运算）。
 * 地址里的中文是 percent-encoded 的，落到磁盘要还原成真名字 ——
 * 站点里其它文件也都是中文原名，别在这里开个先例。
 */
export function postDiskPath(href) {
  const rel = String(href).replace(POST_URL_PREFIX, '');
  const segs = rel.split('/').map((seg) => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  });
  return path.join(POST_DIR, ...segs);
}

/** 相对前缀：从文章页回到 /p/（'../../'）与回到站点根（'../../../'） */
export function prefixesOf(href) {
  const depth = String(href).replace(POST_URL_PREFIX, '').split('/').length;  /* 文件名那一层也算 */
  return {
    toP: '../'.repeat(depth),
    toRoot: '../'.repeat(depth + 1),
  };
}

/** 地址里的一段段解码回真名字（'%E6%9E%A3' → '枣'） */
export function decodeSitePath(p) {
  return String(p).split('/').map((seg) => {
    try { return decodeURIComponent(seg); } catch { return seg; }
  }).join('/');
}

/**
 * 两个文章页之间的相对地址（/p/post/ 下，同源，用 path.posix 算最稳）。
 * 传进来的是**已编码**的地址，算完再编码一次 —— 直接拿编码后的字符串
 * 去 path.posix.relative，中文文件名会被二次编码（%E6 → %25E6）。
 */
export function relativeBetween(fromHref, toHref) {
  const from = decodeSitePath(String(fromHref).replace(POST_URL_PREFIX, ''));
  const to = decodeSitePath(String(toHref).replace(POST_URL_PREFIX, ''));
  return encodeSitePath(path.posix.relative(path.posix.dirname(from), to));
}

function toISODate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const cn = /^(\d{4})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/.exec(s);
  if (cn) return `${cn[1]}-${String(cn[2]).padStart(2, '0')}-${String(cn[3]).padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return iso[0];
  return '';
}

function firstString(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) return v.join('、'); continue; }
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

/** 标签 / 作者这类「一个或一串」的字段统一成字符串数组（去重、去空） */
export function normalizeTags(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(/[,，]/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const s = String(item == null ? '' : item).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * 标签统计（博客首页的标签筛选用）。
 * 排序：出现次数多的在前，一样多按名字（保证每次构建产物一致）。
 * @returns {Array<{tag:string, count:number, anchor:string}>}
 */
export function tallyTags(posts) {
  const map = new Map();
  for (const p of posts) for (const t of p.tags) map.set(t, (map.get(t) || 0) + 1);
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count, anchor: M.tagAnchor(tag) }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag, 'zh'));
}

/** 按年份分组（时间线用）：[{ year, posts }]，年份新的在前，组内沿用传入顺序 */
export function groupByYear(posts) {
  const map = new Map();
  for (const p of posts) {
    const y = p.year || '更早';
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(p);
  }
  return [...map.entries()].map(([year, list]) => ({ year, posts: list }));
}

/**
 * 文章清单（只含「要生成静态页」的 .md）。
 *
 * 排除规则：
 *   · 不是 /p/ 下的 .md（归档产物 .html、SKILL.md 之类在 asset/ 的不算文章）
 *   · frontmatter 里写了 draft / nopage / hidden 的
 *   · 文件不存在的
 *
 * @returns {Array<{
 *   path:string, group:string, name:string, href:string,
 *   title:string, date:string, updated:string, author:string,
 *   summary:string, tags:string[], source:object
 * }>}
 */
export function listPosts() {
  const posts = [];
  const seen = new Set();

  for (const entry of readSkEntries()) {
    const href = postHref(entry.path);
    if (!href || seen.has(href)) continue;

    const disk = diskPathOf(entry.path);
    let src = '';
    try {
      src = fs.readFileSync(disk, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;   /* 文件不在就别硬编 —— 校验器会另外报出来 */
    }

    let parsed = { ok: false, data: {}, body: src };
    try { parsed = M.parseFrontmatter(src); } catch { /* 解析失败就当没有头信息 */ }
    const fm = parsed.ok && parsed.data ? parsed.data : {};

    const ctl = (k) => {
      const v = fm[k];
      return v === true || /^(true|yes|1)$/i.test(String(v == null ? '' : v).trim());
    };
    if (ctl('draft') || ctl('nopage') || ctl('hidden')) continue;

    const title = firstString(fm.title, fm.name, entry.name);
    const date = toISODate(firstString(fm.date, fm.published, fm.time));
    const updated = toISODate(firstString(fm.updated, fm.modified)) || date;
    const summary = firstString(fm.summary, fm.description, fm.excerpt, fm.abstract, fm.intro);
    const tags = normalizeTags(fm.tags != null ? fm.tags : fm.tag);
    /* 作者：`author: JinSuper` 与 `author: [JinSuper, ABC]` 都收；一个都没写就是默认作者 */
    const authors = normalizeTags(firstString(fm.author, fm.authors) || fm.author || fm.authors);
    const author = authors.length ? authors.join('、') : readBlog().author;

    seen.add(href);
    posts.push({
      path: entry.path,
      group: entry.group,
      name: entry.name,
      href,
      title,
      date,
      updated,
      author,
      authors: authors.length ? authors : [readBlog().author],
      summary,
      tags,
      year: (date || '').slice(0, 4),
      body: parsed.body,
      source: disk,
    });
  }

  /* 最新在前；没有日期的排最后（按标题稳定排序，保证每次构建产物一致） */
  posts.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title, 'zh');
  });
  return posts;
}

/** 归档稿页面（sk.json 里登记成 `archive/**.html` 的那些）。
 *
 * 它们本来就是独立页面，但**不是**这一轮构建的产物（发布控制台烘的），
 * 所以这里只负责把它们报给 sitemap：有独立页面就该被收录。
 *
 * 两条排除规则：
 *   · 和某篇活着的 .md 同名（`archive/idea/3.枣香童年.html` vs `idea/3.枣香童年.md`）——
 *     同一篇文章两个地址，正是要避免的重复内容；
 *   · 站点目录之外的路径（`../asset/x.html`）—— 那不是文章。
 *
 * @param {Array} [livePosts] listPosts() 的结果，省一次扫描
 */
export function listArchivedDocs(livePosts) {
  const posts = livePosts || listPosts();
  const liveNames = new Set(posts.map((p) => plainName(p.href)));

  const out = [];
  const seen = new Set();
  for (const entry of readSkEntries()) {
    const rel = String(entry.path).replace(/^\.?\//, '').replace(/^p\//, '');
    if (!/\.html?$/i.test(rel) || rel.split('/').includes('..')) continue;
    const name = rel.replace(/\.html?$/i, '').split('/').pop();
    if (liveNames.has(name)) continue;
    const href = '/p/' + encodeSitePath(rel);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ path: entry.path, group: entry.group, name: entry.name, href, title: entry.name });
  }
  return out;
}

/* ═══════════════════════════════════════════════════
   2.1 归档稿：也进时间线与标签
   ---------------------------------------------------
   归档产物是控制台烘好的**独立页面**（/p/archive/**.html），不是这一轮构建的
   产物 —— 但它们在阅读器侧栏里是能点开的真文章，只报给 sitemap 不列进时间线，
   读者就会觉得「归档的我点不到、标签里也找不到」。

   元数据从成品页自己的 head 里读回来（描述 / 日期 / 标签 / 作者都在那儿，
   和搜索引擎看到的是同一份），读不到就用 sk.json 里登记的名字兜底。
   ═══════════════════════════════════════════════════ */

/** 文件名（不含目录与后缀，percent-encoded 也解回来）：两边比名字时要统一编码 */
function plainName(s) {
  const base = String(s).split('/').pop().replace(/\.html?$/i, '');
  try { return decodeURIComponent(base); } catch { return base; }
}

/**
 * 归档产物 head 里的元数据（读不到就给空值，绝不编）。
 * 只吃字符串，方便控制台「重刷外壳」直接在内存里用（见 console/lib/render.mjs）。
 */
export function parseArchiveMeta(html) {
  const head = String(html == null ? '' : html).slice(0, 8192).replace(/^\uFEFF/, '');
  const str = (re) => {
    const m = re.exec(head);
    return m ? M.decodeEntities(m[1]).trim() : '';
  };
  /* <title> 末尾那句「· JinSuper（奇思妙想）」是站点名，不是标题的一部分 */
  let title = str(/<title>([\s\S]*?)<\/title>/i);
  title = title.replace(/\s*[·|]\s*(JinSuper(\s*奇思妙想)?|百宝箱)\s*$/, '').trim();
  const date = str(/"datePublished"\s*:\s*"([^"]+)"/) ||
    str(/<meta property="article:published_time" content="([^"]*)"/i);
  return {
    title: title,
    summary: str(/<meta name="description" content="([^"]*)"/i),
    date: toISODate(date),
    tags: normalizeTags(str(/"keywords"\s*:\s*"([^"]*)"/)),
    author: str(/"author"\s*:\s*\{\s*"@type"\s*:\s*"Person"\s*,\s*"name"\s*:\s*"([^"]*)"/),
    /** canonical 指向的是「同一篇的活稿地址」（归档稿自己写死的那条） */
    canonical: str(/<link rel="canonical" href="([^"]*)"/i),
  };
}

/** 归档产物文件 → 元数据 */
export function readArchiveMeta(disk) {
  try {
    return parseArchiveMeta(fs.readFileSync(disk, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 归档稿清单：和 listPosts() 同构，另外带 `archived: true`。
 *
 * 与 listArchivedDocs() 的区别只有一个：**不排除**和活稿同名的那几篇。
 * 那份排除是为了 sitemap 不出现重复内容；时间线是给人看的目录，
 * 读者要能看到「这篇还有个归档版」。
 */
export function listArchivedPosts(livePosts) {
  const posts = livePosts || listPosts();
  const liveNames = new Set(posts.map((p) => plainName(p.href)));

  const out = [];
  const seen = new Set();
  for (const entry of readSkEntries()) {
    const rel = String(entry.path).replace(/^\.?\//, '').replace(/^p\//, '');
    if (!/\.html?$/i.test(rel) || rel.split('/').includes('..')) continue;
    const href = '/p/' + encodeSitePath(rel);
    if (seen.has(href)) continue;
    seen.add(href);

    const disk = diskPathOf(entry.path);
    const meta = readArchiveMeta(disk);
    const date = toISODate(meta.date);
    const author = firstString(meta.author) || readBlog().author;

    out.push({
      path: entry.path,
      group: entry.group,
      name: entry.name,
      href,
      title: firstString(entry.name, meta.title),
      date: date,
      updated: date,
      author: author,
      authors: [author],
      summary: firstString(meta.summary),
      tags: meta.tags,
      year: date.slice(0, 4),
      archived: true,
      /* 这篇还有个活着的 .md 版本 —— 时间线上标一下，别让人以为是两篇文章 */
      twin: liveNames.has(plainName(href)),
      source: disk,
    });
  }

  out.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title, 'zh');
  });
  return out;
}

/* ═══════════════════════════════════════════════════
   2. 正文里的相对地址
   ---------------------------------------------------
   正文里的相对路径按站点的老规矩是**相对 /p/** 的
   （阅读器那边由 fixURLs() 在浏览器里改），文章页是独立页面，
   深度不同，必须在构建期把前缀补对，否则爬虫抓到的全是死链。
   ═══════════════════════════════════════════════════ */
/** 站内地址判定：外链 / 协议相对 / 锚点 / data: 都原样留着 */
function isPlainLink(u) {
  return (
    !u ||
    u.startsWith('#') ||
    u.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)
  );
}

/**
 * 把渲染出来的正文改成「从文章页出发」的地址。
 *
 * @param {string} html
 * @param {{
 *   href:string,
 *   rootPrefix:string,
 *   resolveDoc?:(plain:string) => string|null,
 * }} opts
 *   resolveDoc：正文里的链接正好指向清单里的一篇时，由调用方决定跳哪儿
 *               （有静态页就跳静态页，没有就回阅读器 deep-link）
 */
export function rewriteContentUrls(html, opts) {
  const { href, rootPrefix } = opts;
  const pPrefix = prefixesOf(href).toP;
  const resolveDoc = opts.resolveDoc || null;

  /* 链接写法收敛：去掉前导 './'、'/'，再试一次 percent-decode —— 和阅读器的
     normWant() 保持同一套比较口径，否则中文路径两边会各认一半 */
  const plainOf = (raw) => {
    const s = String(raw).replace(/^\.?\//, '');
    try { return decodeURIComponent(s); } catch { return s; }
  };

  const fix = (raw) => {
    if (isPlainLink(raw)) return raw;
    /* 卡片（<card>）和站内文章链接会被渲染成阅读器 deep-link：
         /p/docs.html#idea%2F3.枣香童年.md
       静态文章页里不该再把人往阅读器带 —— 有独立文章页就指过去，
       这样爬虫顺着链接走的是真正的文章地址，而不是一个 hash。 */
    const stripped = String(raw).replace(/^\.?\//, '');
    if (resolveDoc && (stripped.startsWith('docs.html#') || stripped.startsWith('p/docs.html#'))) {
      const frag = stripped.slice(stripped.indexOf('docs.html#') + 'docs.html#'.length);
      let want = frag;
      try { want = decodeURIComponent(frag); } catch { /* 解不开就原样试 */ }
      const hit = resolveDoc(want);
      if (hit) return hit;
    }
    if (resolveDoc) {
      const deep = resolveDoc(plainOf(raw));
      if (deep) return deep;
    }
    if (raw.startsWith('/')) return rootPrefix + raw.replace(/^\/+/, '');
    return pPrefix + String(raw).split('/').map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg))).join('/');
  };

  let out = String(html).replace(/(\s(?:href|src)=")([^"]*)(")/g, (m, pre, url, post) => pre + fix(url) + post);
  /* 外链新开标签：和阅读器里的处理保持一致 */
  out = out.replace(/(<a\b[^>]*\shref=")(https?:\/\/[^"]*)(")/g, (m, pre, url, post) =>
    /target=/.test(m) ? m : `${pre}${url}${post} target="_blank" rel="noopener"`);
  return out;
}

/* ═══════════════════════════════════════════════════
   3. 订阅源（RSS 2.0）
   ═══════════════════════════════════════════════════ */

function xmlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/** RFC 822 时间（RSS 要这个格式）；只有日期时按当天 08:00 UTC+8 算 */
function rfc822(iso) {
  const d = iso ? new Date(`${iso}T08:00:00+08:00`) : null;
  const when = d && !Number.isNaN(d.getTime()) ? d : new Date(Date.UTC(2026, 0, 1));
  return when.toUTCString();
}

/**
 * 生成 /p/feed.xml。
 * @param {Array} posts listPosts() 的结果（已按新→旧排好）
 * @param {{origin:string, title:string, desc:string, href:string, self:string}} site
 */
export function buildFeed(posts, site) {
  const abs = (rel) => site.origin.replace(/\/+$/, '') + rel;
  const items = posts.slice(0, 30).map((p) => {
    const link = abs(p.href);
    const parts = [
      `      <title>${xmlEsc(p.title)}</title>`,
      `      <link>${xmlEsc(link)}</link>`,
      `      <guid isPermaLink="true">${xmlEsc(link)}</guid>`,
    ];
    if (p.date) parts.push(`      <pubDate>${rfc822(p.date)}</pubDate>`);
    /* 多作者就写多条 dc:creator —— RSS 2.0 的 <author> 只收一个邮箱地址，
       这里用 Dublin Core，语义对、阅读器也都认 */
    const authors = p.authors && p.authors.length ? p.authors : (p.author ? [p.author] : []);
    for (const a of authors) parts.push(`      <dc:creator>${xmlEsc(a)}</dc:creator>`);
    for (const t of p.tags) parts.push(`      <category>${xmlEsc(t)}</category>`);
    if (p.summary) parts.push(`      <description>${xmlEsc(p.summary)}</description>`);
    return `    <item>\n${parts.join('\n')}\n    </item>`;
  });
  const newest = posts.find((p) => p.updated || p.date);

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    '  <channel>\n' +
    `    <title>${xmlEsc(site.title)}</title>\n` +
    `    <link>${xmlEsc(abs(site.href))}</link>\n` +
    `    <description>${xmlEsc(site.desc)}</description>\n` +
    '    <language>zh-CN</language>\n' +
    `    <atom:link href="${xmlEsc(abs(site.self))}" rel="self" type="application/rss+xml"/>\n` +
    (newest ? `    <lastBuildDate>${rfc822(newest.updated || newest.date)}</lastBuildDate>\n` : '') +
    items.join('\n') + (items.length ? '\n' : '') +
    '  </channel>\n</rss>\n';
}

/**
 * 清掉 /p/post/ 下这一轮没生成的页面（改了 slug / 删了文章之后，
 * 旧页面会一直挂在线上，和 prep-deploy 的 prune 是同一个道理）。
 * @returns {string[]} 被删掉的站点绝对地址
 */
export function prunePosts(keepHrefs) {
  const removed = [];
  const keep = new Set(keepHrefs);
  if (!fs.existsSync(POST_DIR)) return removed;

  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const relChild = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, relChild); continue; }
      /* 磁盘上是中文原名，比对用的是编码后的地址，两边先对齐 */
      const href = POST_URL_PREFIX + encodeSitePath(relChild);
      if (keep.has(href)) continue;
      fs.rmSync(abs, { force: true });
      removed.push(href);
    }
    /* 目录空了就一起收掉，别在站点里留一串空壳 */
    if (dir !== POST_DIR && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  };
  walk(POST_DIR, '');
  return removed;
}
