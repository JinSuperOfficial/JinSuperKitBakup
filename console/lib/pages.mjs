/**
 * 页面树（「预览」面板的一键清单）
 * ---------------------------------------------------
 * 一次列出站点里所有能打开的页面，并且带上从属关系：
 *
 *   百宝箱（site.json 的 title）
 *   ├─ 工具站（Skills/skills.json）      ← 清单：标题 / 说明 / 顺序都从这儿来
 *   ├─ 811 专区（class/tools.json）
 *   ├─ 文档站（sk.json）                 ← .md 走阅读器 /p/docs.html#路径
 *   ├─ site.json 里的额外地址
 *   └─ 目录扫描（清单没登记的 .html）    ← 兜底：盘上有的一个都不漏
 *
 * 三条约定：
 *   1. **不重复列**：清单里登记过的站点路径，目录扫描那棵子树里不再出现。
 *   2. **读不到清单不算错**：site.json / collection / sk.json 缺一个，
 *      那一块就不出现，剩下的照常列（控制台要能在半成品站点上跑）。
 *   3. **只读**：这个模块不写任何文件，也不会替谁修清单。
 *
 * 为什么自己读一遍清单、而不是复用 build/lib/site-index.mjs：
 * 那份实现按 build/ 的位置解析站点根，而控制台（和它的测试）用
 * DSH_CONSOLE_ROOT 换根。路径来源必须先听控制台这边的，才不会各说各话。
 */
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, siteRoot, walk } from './paths.mjs';
import { flattenSk, kindOf, loadSk, loadState } from './store.mjs';
import { resolveRegistered } from './manifest.mjs';

/** 页面树里只有这几种节点 */
export const SOURCES = ['auto', 'manifest', 'dir'];

const normRel = (p) => String(p == null ? '' : p).replace(/^[/\\]+/, '').replace(/\\/g, '/');

/** 站点相对路径 → 站点 href（`/p/a.html`） */
const hrefOf = (rel) => '/' + normRel(rel);

/** 带中文的 hash 段：浏览器的 location.hash 会自己解码，这里只要不乱切 */
const hashOf = (p) => '/p/docs.html#' + encodeURI(String(p)).replace(/#/g, '%23');

/* ═══════════════════════════════════════════════════
   清单读取（读不到就返回 null，不抛）
   ═══════════════════════════════════════════════════ */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** site.json：站点目录结构（collections / ignore / extraUrls） */
function readSiteJson() {
  return readJson(path.join(siteRoot, 'site.json'));
}

/** 一个 collection 清单：`/Skills/skills.json` → {title, root, items} */
function readCollection(rel) {
  const file = path.join(siteRoot, normRel(rel));
  const data = readJson(file);
  if (!data || !Array.isArray(data.items)) return null;
  const items = data.items
    .filter((it) => it && typeof it === 'object')
    .map((it, i) => ({
      id: String(it.id || it.href || i),
      title: String(it.title || it.href || it.id || '（没标题）'),
      desc: it.desc ? String(it.desc) : '',
      href: String(it.href || ''),
      kind: it.kind ? String(it.kind) : '',
      order: Number.isFinite(Number(it.order)) ? Number(it.order) : 1000 + i,
    }))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh'));
  return {
    title: String(data.title || path.basename(normRel(rel))),
    root: data.root ? String(data.root) : '',
    file: hrefOf(path.relative(siteRoot, file)),
    items,
  };
}

/** site.json 的 ignore：`/404.html` 是文件，`/p/test/` 是整棵子树 */
function ignoreMatcher(list) {
  const files = new Set();
  const dirs = [];
  for (const raw of list || []) {
    const p = normRel(raw);
    if (!p) continue;
    if (p.endsWith('/')) dirs.push(p);
    else files.add(p);
  }
  return (rel) => {
    const r = normRel(rel);
    if (files.has(r)) return true;
    return dirs.some((d) => r.startsWith(d));
  };
}

/* ═══════════════════════════════════════════════════
   节点
   ═══════════════════════════════════════════════════ */

const group = (id, title, children, extra = {}) => ({
  id, title, type: 'group', children, ...extra,
});

function page({ id, title, href, rel, desc = '', kind = 'page', from = 'dir', missing = false, ignored = false, dir = false }) {
  return {
    id: id || 'page:' + (href || rel || title),
    title,
    type: 'page',
    href,
    rel: rel ? normRel(rel) : '',
    desc,
    kind,
    from,
    missing,
    dir,
    ignored,
  };
}

/* ═══════════════════════════════════════════════════
   各来源的子树
   ═══════════════════════════════════════════════════ */

/** 一个 collection → 一个分组，条目按 order 排 */
function collectionGroup(col, seen, ignored) {
  const rootRel = col.root ? normRel(col.root) : '';
  const children = [];

  /* 落地页：collection 自己的 root（/Skills/ → /Skills/index.html） */
  if (rootRel) {
    const idx = path.posix.join(rootRel, 'index.html');
    if (isFile(path.join(siteRoot, idx))) {
      children.push(page({
        id: 'col-root:' + rootRel, title: '落地页', href: hrefOf(idx), rel: idx,
        desc: col.title + ' 的入口', from: 'manifest', ignored: ignored(idx),
      }));
      seen.add(normRel(idx));
    }
  }

  for (const it of col.items) {
    if (!it.href) continue;
    const rel = normRel(it.href.split('#')[0].split('?')[0]);
    const exists = rel ? isFile(path.join(siteRoot, rel)) : false;
    children.push(page({
      id: 'col:' + col.file + ':' + it.id,
      title: it.title,
      href: it.href.startsWith('/') ? it.href : hrefOf(it.href),
      rel,
      desc: it.desc,
      kind: /\.html?$/i.test(rel) ? 'page' : (it.kind || 'page'),
      from: 'manifest',
      missing: !exists,
      ignored: ignored(rel),
    }));
    if (exists) seen.add(rel);
  }

  return group('col:' + col.file, col.title, children, {
    note: col.file + ' · ' + col.items.length + ' 项',
    from: 'manifest',
  });
}

/** sk.json（文档站）→ 一个分组，里面按清单的分组再分一层 */
function docsGroup(seen, ignored) {
  let data;
  try {
    data = loadSk(loadState().settings).data;
  } catch {
    return null;
  }
  const entries = flattenSk(data);
  if (!entries.length) return null;

  const byGroup = new Map();
  for (const e of entries) {
    const r = resolveRegistered(e.path);
    const exists = isFile(r.abs);
    /* 登记的 .html 是现成页面；.md 让阅读器 deep-link 打开
       （`../asset/x.md` 在站点之外，阅读器自己会按 /p 相对解析） */
    const isHtml = r.kind === 'p' && /\.html?$/i.test(r.rel);
    const href = isHtml ? hrefOf(r.rel) : hashOf(e.path);
    const rel = r.kind === 'p' ? r.rel : '';
    if (rel && exists) seen.add(rel);
    if (!byGroup.has(e.group)) byGroup.set(e.group, []);
    byGroup.get(e.group).push(page({
      id: 'doc:' + e.group + ':' + e.path,
      title: e.name,
      href,
      rel,
      desc: e.path,
      kind: isHtml ? 'page' : 'doc',
      from: 'manifest',
      missing: !exists,
      ignored: rel ? ignored(rel) : false,
    }));
  }

  const children = [...byGroup.entries()].map(([name, items]) =>
    group('doc:' + name, name, items, { from: 'manifest', note: items.length + ' 篇' }));

  return group('docs', '文档站（sk.json）', children, {
    from: 'manifest',
    note: entries.length + ' 篇 · 阅读器 /p/docs.html',
  });
}

/** site.json 的 extraUrls → 一个分组（兜底地址、优先级标记） */
function extraGroup(site, seen, ignored) {
  const list = Array.isArray(site.extraUrls) ? site.extraUrls : [];
  if (!list.length) return null;
  const own = new Set();
  const children = list.map((ex, i) => {
    let loc = String((ex && ex.loc) || '');
    if (!loc) return null;
    const rawRel = normRel(loc.split('#')[0].split('?')[0]);
    if (!rawRel) return null;

    const abs = path.join(siteRoot, rawRel);
    const dir = isDir(abs);
    let rel = rawRel;
    if (loc.endsWith('/') || dir) {
      const idx = path.posix.join(rawRel, 'index.html');
      if (isFile(path.join(siteRoot, idx))) rel = idx;
    }
    /* 清单里已经列过的（collection / 文档站 / 首页）不再重复列一遍 */
    if (seen.has(rel) || own.has(rel)) return null;
    own.add(rel);

    const exists = isFile(path.join(siteRoot, rel));
    if (exists) seen.add(rel);
    return page({
      id: 'extra:' + i + ':' + loc,
      title: rel || loc,
      href: dir && !exists ? hrefOf(rawRel) + '/' : hrefOf(rel),
      rel,
      desc: [
        dir && !exists ? '目录（没有 index.html）' : '',
        ex && ex.priority != null ? 'priority ' + ex.priority : '',
      ].filter(Boolean).join(' · '),
      kind: /\.html?$/.test(rel) ? 'page' : (/\.[a-z0-9]+$/i.test(rel) ? 'doc' : 'page'),
      from: 'manifest',
      /* 只有「是目录、又没有 index.html」才标成目录条目 */
      dir: dir && !exists,
      missing: !exists && !dir,
      ignored: ignored(rel),
    });
  }).filter(Boolean);
  if (!children.length) return null;
  return group('extra', 'site.json 里的额外地址', children, { from: 'manifest', note: children.length + ' 条' });
}

/** 目录扫描：盘上所有 .html，清单没登记过的才收 */
function dirGroup(seen, ignored) {
  const files = walk(siteRoot)
    .filter((rel) => /\.html?$/i.test(rel))
    .filter((rel) => !seen.has(normRel(rel)));

  const root = group('scan', '目录扫描（清单没登记的）', [], { from: 'dir' });
  const dirs = new Map([['', root]]);

  const ensure = (dirRel) => {
    if (dirs.has(dirRel)) return dirs.get(dirRel);
    const parentRel = dirRel.includes('/') ? dirRel.slice(0, dirRel.lastIndexOf('/')) : '';
    const parent = ensure(parentRel);
    const node = group('dir:' + dirRel, dirRel.split('/').pop() + '/', [], { from: 'dir' });
    parent.children.push(node);
    dirs.set(dirRel, node);
    return node;
  };

  for (const rel of files) {
    const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    ensure(dirRel).children.push(page({
      title: path.posix.basename(rel),
      href: hrefOf(rel),
      rel,
      kind: 'page',
      from: 'dir',
      ignored: ignored(rel),
    }));
  }

  sortScan(root);
  /* 一个都没扫到就别摆个空分组 */
  return root.children.length ? root : null;
}

/** 扫描子树：目录在前、文件在后，各自按名字排（中文按拼音） */
function sortScan(node) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    const ad = a.type === 'group' ? 0 : 1;
    const bd = b.type === 'group' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return String(a.title).localeCompare(String(b.title), 'zh');
  });
  node.children.forEach(sortScan);
}

/* ═══════════════════════════════════════════════════
   组装
   ═══════════════════════════════════════════════════ */

function walkTree(nodes, visit) {
  for (const n of nodes) {
    visit(n);
    if (n.children) walkTree(n.children, visit);
  }
}

/**
 * 建树。
 * @param {{source?: 'auto'|'manifest'|'dir'}} opts
 *   auto     —— 清单优先，目录兜底（默认）
 *   manifest —— 只看清单
 *   dir      —— 只扫目录
 */
export function buildPageTree({ source = 'auto' } = {}) {
  const src = SOURCES.includes(source) ? source : 'auto';
  /* site.json 即使「只扫目录」也读一眼：ignore 列表和站点名还要用 */
  const site = readSiteJson();
  const useManifest = src !== 'dir';
  const ignored = ignoreMatcher(site && site.ignore);
  const seen = new Set();
  const children = [];
  const notes = [];

  if (useManifest) {
    if (site) {
      for (const rel of site.collections || []) {
        const col = readCollection(rel);
        if (!col) { notes.push('读不到清单：' + rel); continue; }
        children.push(collectionGroup(col, seen, ignored));
      }
    } else {
      notes.push('没有 site.json：只列了 sk.json 和目录扫描');
    }
    const docs = docsGroup(seen, ignored);
    if (docs) children.push(docs);
    if (site) {
      const extra = extraGroup(site, seen, ignored);
      if (extra) children.push(extra);
    }
  }

  /* 首页永远排最前，同时登记进 seen —— 目录扫描那边就不再重复列一次 */
  const hasHome = isFile(path.join(siteRoot, 'index.html'));
  if (hasHome) seen.add('index.html');

  if (src !== 'manifest') {
    const scan = dirGroup(seen, ignored);
    if (scan) children.push(scan);
  }

  const home = hasHome
    ? page({ id: 'home', title: '首页 index.html', href: '/index.html', rel: 'index.html', kind: 'page', from: 'auto' })
    : null;

  const rootTitle = (site && site.title) || '站点';
  const root = group('site', rootTitle, children, { from: src });
  const tree = home ? [home, root] : [root];

  const stats = { pages: 0, groups: 0, missing: 0, ignored: 0 };
  walkTree(tree, (n) => {
    if (n.type === 'page') {
      stats.pages++;
      if (n.missing) stats.missing++;
      if (n.ignored) stats.ignored++;
    } else stats.groups++;
  });

  return {
    source: src,
    siteTitle: rootTitle,
    root: siteRoot,
    tree,
    stats,
    notes,
  };
}
