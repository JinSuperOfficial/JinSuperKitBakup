/**
 * 站点索引的生成逻辑（唯一实现）
 * ---------------------------------------------------
 * 产出两样东西（都不写时间戳，同样的输入产出一模一样）：
 *   jinsuper.rth1.xyz/sitemap.xml               站点地图（绝对地址，前缀取 site.json 的 blog.origin）
 *   jinsuper.rth1.xyz/docs/info/site-index.js   window.SITE_INDEX：目录树结构
 *
 * 为什么单独一个模块：build.mjs 与 verify-manifests.mjs 都要用它，
 * 而在这个环境里跨进程捞输出（spawn 的管道）会被挡掉 —— 直接 import 最省事、也不会走样。
 *
 * 图标名单（docs/info/info.js 里的 ICONS）没有生成：那是 /asset/icon 这套第三方图标的静态清单，
 * 校验器会在数量对不上时提醒（免得为一个几乎不变的列表再引入一个生成物）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../paths.mjs';
import { loadManifestLib, readCollection } from './site-lib.mjs';
import { listPosts, listArchivedDocs } from './posts.mjs';

/* 扫盘时跳过的目录（构建工具、依赖、版本库） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', '.npm-cache', '.deno-cache']);
/* 扫描时忽略的文件 */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);
/* 目录里文件太多就折叠：不递归，只记数量（现在的 /asset/icon 有 600 枚） */
const COLLAPSE_OVER = 24;

export const SITE_JSON = path.join(siteRoot, 'site.json');
export const OUT = {
  sitemap: path.join(siteRoot, 'sitemap.xml'),
  tree: path.join(siteRoot, 'docs', 'info', 'site-index.js'),
};

/** 读 /site.json；读不到就抛（调用方决定怎么报） */
export function readSiteConfig(file = SITE_JSON) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 逐个读 collection 并归一（strict：结构化错误升级成 error） */
export function readAllCollections(site) {
  return (site.collections || []).map((rel) => readCollection(rel, { strict: true }));
}

/* ═══════════════════════════════════════════════════
   1. sitemap.xml
   ═══════════════════════════════════════════════════ */

/**
 * sitemap 里用的绝对前缀：跟 site.json 的 blog.origin 走，一处配置管到底。
 *
 * ⚠️ 不要退回热铁盒的 `jinsuper{$rthSuffix}` 服务端变量：它在自定义域名上
 * 也照样展开成 `.rth1.xyz`，而免费域名 *.rth1.xyz 对搜索引擎 UA 一律回
 * 404「您的请求可疑，已被阻止」（2026-10 实测 Googlebot/Bingbot/Baiduspider
 * 全部如此）。站点地图指向那里 = 搜索引擎一条都抓不到。
 */
const SITEMAP_ORIGIN_FALLBACK = 'https://www.jinsuper.cn';

export function sitemapOrigin(site) {
  const raw = site && site.blog && site.blog.origin ? String(site.blog.origin) : SITEMAP_ORIGIN_FALLBACK;
  return raw.replace(/\/+$/, '');
}

export function buildSitemap(site, collections) {
  const origin = sitemapOrigin(site);
  /* 顺序：首页 → 各 collection 落地页 → 各条目 → 博客文章页 → site.json 里的额外条目。
     同一地址重复出现时后面的覆盖前面的，所以手工条目能抬优先级。 */
  const order = [];
  const priority = new Map();
  const lastmod = new Map();
  const push = (loc, p, mod) => {
    if (!loc) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(loc) || loc.startsWith('//')) return;   /* 外链不进 sitemap */
    if (!priority.has(loc)) order.push(loc);
    priority.set(loc, p);
    if (mod) lastmod.set(loc, mod);
  };

  push('/', 1.0);
  for (const col of collections) if (col.root) push(col.root, 0.8);
  for (const col of collections) {
    for (const it of col.items) push(it.href, it.priority == null ? 0.6 : it.priority);
  }

  /* 博客文章：每篇 .md 都有自己的静态页（/p/post/…），那才是能被单独收录的
     地址 —— /p/docs.html#xxx 在搜索引擎眼里和 /p/docs.html 是同一个页面。
     lastmod 取 frontmatter 的 updated / date，没有就不写这一项。 */
  const posts = listPosts();
  for (const post of posts) {
    push(post.href, 0.7, post.updated || post.date || '');
  }

  /* 归档稿：发布控制台烘出来的独立页面，也是文章，同样要能被搜到。
     （和活着的 .md 同名的那几篇会被 listArchivedDocs 排掉，避免重复内容。） */
  for (const doc of listArchivedDocs(posts)) {
    push(doc.href, 0.6);
  }

  for (const ex of site.extraUrls || []) push(ex.loc, ex.priority == null ? 0.6 : ex.priority);

  const body = order.map((loc) =>
    `  <url><loc>${origin}${loc}</loc>` +
    (lastmod.get(loc) ? `<lastmod>${lastmod.get(loc)}</lastmod>` : '') +
    `<priority>${Number(priority.get(loc)).toFixed(1)}</priority></url>`).join('\n');

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n' +
    body + '\n\n</urlset>\n';
}

/* ═══════════════════════════════════════════════════
   2. 目录树
   ═══════════════════════════════════════════════════ */

function countFiles(dirAbs) {
  let n = 0;
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      n += countFiles(path.join(dirAbs, e.name));
    } else if (!SKIP_FILES.has(e.name)) n++;
  }
  return n;
}

function scanDir(dirAbs) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true })
    .filter((e) => !(e.isDirectory() ? SKIP_DIRS.has(e.name) : SKIP_FILES.has(e.name)))
    /* 目录在前、文件在后，各自按名字排 */
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'zh'));

  const children = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = scanDir(path.join(dirAbs, e.name));
      children.push({
        name: e.name + '/',
        dir: true,
        ...(sub.length > COLLAPSE_OVER
          ? { children: [], count: countFiles(path.join(dirAbs, e.name)) }
          : { children: sub }),
      });
    } else if (e.isFile()) {
      children.push({ name: e.name });
    }
  }
  return children;
}

export function buildTree() {
  return { name: '/', dir: true, open: true, children: scanDir(siteRoot) };
}

export function buildTreeFile(tree) {
  return '/* 由 build/gen-site-index.mjs 生成：网站的目录结构。不要手改。\n' +
    '   每个节点的说明文字在 docs/info/info.js 的 DESC 里。 */\n' +
    'window.SITE_INDEX = ' + JSON.stringify(tree, null, 2) + ';\n';
}

/* ═══════════════════════════════════════════════════
   组装 / 比对 / 写盘
   ═══════════════════════════════════════════════════ */

/**
 * 生成三样东西的内容（不落盘）。
 * @returns {{site, collections, outputs: Array<[label, file, content]>, problems: Array}}
 */
export function collectOutputs() {
  const site = readSiteConfig();
  const collections = readAllCollections(site);
  const problems = collections.flatMap((c) => c.problems).filter((p) => p.level === 'error');
  return {
    site,
    collections,
    problems,
    outputs: [
      ['docs/info/site-index.js', OUT.tree, buildTreeFile(buildTree())],
      ['sitemap.xml', OUT.sitemap, buildSitemap(site, collections)],
    ],
  };
}

/**
 * 比对磁盘上的生成物。
 * @returns {{stale: Array<{label,file}>, outputs, site, collections, problems}}
 */
export function checkOutputs() {
  const { site, collections, outputs, problems } = collectOutputs();
  const stale = [];
  for (const [label, file, content] of outputs) {
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before !== content) stale.push({ label, file });
  }
  return { site, collections, outputs, problems, stale };
}

/** 写盘（内容一致的会跳过，保持 mtime 稳定） */
export function writeOutputs(outputs) {
  const written = [];
  for (const [label, file, content] of outputs) {
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before === content) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    written.push({ label, created: before === null });
  }
  return written;
}
