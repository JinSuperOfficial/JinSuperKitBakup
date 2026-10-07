/**
 * API 实现
 * ---------------------------------------------------
 * 每个导出对应一个路由。约定：
 *   · 抛出的 Error.status 决定 HTTP 状态码（403 越界 / 404 不存在 / 409 冲突 / 500 内部）；
 *   · 返回的对象直接 JSON 化给前端；
 *   · 所有落盘动作先过 assertInside，再原子写。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS, archiveDirOf, assertInside, exists, isDir, isFile, paraDirOf,
  pDir, resolveSitePath, siteRoot, toPRelative, toSiteHref, workspaceRoot,
} from './paths.mjs';
import {
  archiveRelFor, defaultTitle, ensureDir, findByPRelative, flattenSk, kindOf, loadSk,
  loadState, moveFromPara, moveToPara, removeSkEntry, saveSk, saveState,
  scanP, siteRelOfArchive, uniquePath, upsertSkEntry, writeAtomic, writeJson, TEXT_EXT,
} from './store.mjs';
import {
  backupVersion, coreStatus, extractProductParts, listVersions, renderArticleHtml,
  renderFragment, renderShell, setupErrors, versionsDirOf,
} from './render.mjs';
import { extrasStatus, scanUnsupported } from './md-extras.mjs';
import * as jobs from './jobs.mjs';
import * as manifest from './manifest.mjs';
import * as cloud from './cloud.mjs';
import * as links from './links.mjs';
import * as pages from './pages.mjs';
import * as preview from './preview.mjs';

const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

/** 预览相关的枚举（设置里只认这几个值） */
const CLICK_MODES = ['auto', 'server', 'path'];
const PAGES_SOURCES = pages.SOURCES;

function clampPort(v, dflt) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return dflt;
  return n;
}

/* ═══════════════════════════════════════════════════
   状态 / 设置
   ═══════════════════════════════════════════════════ */

export function getState() {
  const state = loadState();
  const { data: sk } = loadSk(state.settings);
  const scan = scanP(state.settings, sk);
  return {
    settings: state.settings,
    stats: scan.stats,
    groups: scan.groups,
    core: coreStatus(),
    extras: extrasStatus(),
    paths: {
      workspaceRoot,
      siteRoot,
      pDir,
      paraDir: paraDirOf(state.settings),
      archiveDir: archiveDirOf(state.settings),
    },
  };
}

export function putSettings(body) {
  const state = loadState();
  const next = Object.assign({}, state.settings, body && body.settings ? body.settings : body || {});
  /* 数字字段别让字符串混进来 */
  next.editorFontSize = Math.min(24, Math.max(11, Number(next.editorFontSize) || DEFAULT_SETTINGS.editorFontSize));
  next.autosaveMs = Math.min(10000, Math.max(400, Number(next.autosaveMs) || DEFAULT_SETTINGS.autosaveMs));
  next.confirmDanger = !!next.confirmDanger;
  /* 预览：端口夹到合法范围，两个枚举值只认自己的选项 */
  next.previewPort = clampPort(next.previewPort, DEFAULT_SETTINGS.previewPort);
  next.previewAutoStart = !!next.previewAutoStart;
  next.previewOpenAfterStart = !!next.previewOpenAfterStart;
  next.previewClickMode = CLICK_MODES.includes(next.previewClickMode) ? next.previewClickMode : DEFAULT_SETTINGS.previewClickMode;
  next.previewTreeSource = PAGES_SOURCES.includes(next.previewTreeSource) ? next.previewTreeSource : DEFAULT_SETTINGS.previewTreeSource;
  state.settings = next;
  saveState(state);
  return getState();
}

/* ═══════════════════════════════════════════════════
   文章：列 / 读 / 写 / 新建 / 改名 / 移动 / 删除
   ═══════════════════════════════════════════════════ */

export function listArticles(query = {}) {
  const state = loadState();
  const { data: sk } = loadSk(state.settings);
  const scan = scanP(state.settings, sk);

  let list = scan.articles;
  const kind = query.kind;
  if (kind === 'media') list = list.filter((a) => a.kind !== 'md' && a.kind !== 'text' && a.kind !== 'html');
  else if (kind === 'md') list = list.filter((a) => a.kind === 'md');
  else if (kind) list = list.filter((a) => a.kind === kind);

  return { articles: list, stats: scan.stats, groups: scan.groups };
}

/**
 * 把任意写法收敛成 p 内的相对路径，并保证它真的在 p 下。
 *
 * 两种写法都收：
 *   · 面板/清单里的写法：`idea/index.md`（已经相对 /p）
 *   · 站点绝对写法：`/p/idea/index.md`
 * —— 前者不能再去 resolveSitePath，否则会被当成「站点根下的 idea/index.md」，
 * 既不存在的路径又可能撞上真实目录，所以先看开头是哪种。
 */
function asPRelative(p) {
  const raw = String(p || '').trim();
  if (!raw) throw err('没给路径');

  const looksSiteAbsolute = /^[/\\]/.test(raw) || /^p[/\\]/i.test(raw);
  const abs = assertInside(
    looksSiteAbsolute ? resolveSitePath(raw) : path.resolve(pDir, raw),
    pDir,
  );
  const rel = toPRelative(abs);
  if (rel == null) throw err('这个路径不在 /p 下：' + p, 403);
  return { abs, rel };
}

export function readArticle(query) {
  const { abs, rel } = asPRelative(query.path);
  if (!isFile(abs)) throw err('读不到这个文件：' + rel, 404);
  const state = loadState();
  const { data: sk } = loadSk(state.settings);
  const found = findByPRelative(sk, rel);
  return {
    path: rel,
    href: toSiteHref(abs),
    content: fs.readFileSync(abs, 'utf8'),
    kind: kindOf(rel),
    status: found ? (rel.startsWith(String(state.settings.archiveDir).replace(/^p\//, '')) ? 'archived' : 'published') : 'unpublished',
    group: found ? found.group : null,
    title: found ? found.name : defaultTitle(rel),
    mtime: fs.statSync(abs).mtimeMs,
    bytes: fs.statSync(abs).size,
  };
}

export function putArticle(body) {
  const { abs, rel } = asPRelative(body.path);
  const ext = path.extname(rel).toLowerCase();
  if (!TEXT_EXT.includes(ext)) throw err('这个后缀不能当文章写：' + ext);
  ensureDir(path.dirname(abs));
  writeAtomic(abs, String(body.content == null ? '' : body.content));

  const state = loadState();
  const { data: sk, indent } = loadSk(state.settings);
  const found = findByPRelative(sk, rel);

  /* 只有明确说了「发布」才登记；否则就当草稿留在盘上 */
  if (body.publish) {
    const prev = found;
    upsertSkEntry(sk, {
      group: body.group || (prev && prev.group) || '未分组',
      name: body.title || (prev && prev.name) || defaultTitle(rel),
      pRel: rel,
      prev,
    });
    saveSk(state.settings, sk, indent);
    /* 登记了就不再是草稿 */
    delete state.drafts[toSiteHref(abs)];
    saveState(state);
  } else if (found && (body.title || body.group)) {
    upsertSkEntry(sk, {
      group: body.group || found.group,
      name: body.title || found.name,
      pRel: rel,
      prev: found,
    });
    saveSk(state.settings, sk, indent);
  } else {
    /* 没登记的：记一笔「这是草稿」，列表里就能和「从没动过的未发布」分开 */
    state.drafts[toSiteHref(abs)] = new Date().toISOString();
    saveState(state);
  }

  return { ok: true, path: rel, bytes: fs.statSync(abs).size, mtime: fs.statSync(abs).mtimeMs };
}

export function postArticleNew(body) {
  const raw = String(body.path || '').trim();
  if (!raw) throw err('得给个路径，例如 笔记/新想法.md');
  const rel = raw.replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
  const { abs, rel: safeRel } = asPRelative(rel);
  const ext = path.extname(safeRel).toLowerCase();
  if (!TEXT_EXT.includes(ext)) throw err('新文章请用 .md / .markdown / .txt 结尾');
  if (exists(abs)) throw err('这个路径已经有文件了：' + safeRel, 409);

  ensureDir(path.dirname(abs));
  writeAtomic(abs, body.content == null ? `# ${body.title || defaultTitle(safeRel)}\n\n` : String(body.content));

  if (body.publish) {
    const state = loadState();
    const { data: sk, indent } = loadSk(state.settings);
    upsertSkEntry(sk, {
      group: body.group || '未分组',
      name: body.title || defaultTitle(safeRel),
      pRel: safeRel,
      prev: findByPRelative(sk, safeRel),
    });
    saveSk(state.settings, sk, indent);
  }
  return { ok: true, path: safeRel, href: toSiteHref(abs) };
}

export function postArticleRename(body) {
  const { abs, rel } = asPRelative(body.path);
  if (!isFile(abs)) throw err('文件不在：' + rel, 404);
  const next = String(body.to || '').trim();
  if (!next) throw err('要改成什么名字？');
  if (next.includes('/') || next.includes('\\')) {
    throw err('改名只改文件名，换目录请用「移动分组」或先进素材库挪位置');
  }
  if (!path.extname(next)) throw err('新名字要带后缀，例如 笔记.md');
  const destAbs = assertInside(path.join(path.dirname(abs), next), pDir);
  if (exists(destAbs)) throw err('目标名字已存在：' + next, 409);
  fs.renameSync(abs, destAbs);

  const newRel = toPRelative(destAbs);
  const state = loadState();
  const { data: sk, indent } = loadSk(state.settings);
  const found = findByPRelative(sk, rel);
  if (found) {
    /* 标题跟着新文件名走，分组不动；原分组空了就得先把它删掉再建回来 */
    removeSkEntry(sk, found);
    if (!sk[found.group]) sk[found.group] = {};
    sk[found.group][defaultTitle(newRel)] = newRel;
    saveSk(state.settings, sk, indent);
  }
  return { ok: true, path: newRel };
}

export function postArticleMove(body) {
  const rel = String(body.path || '').replace(/^[/\\]+/, '');
  const group = String(body.group || '').trim() || '未分组';
  const state = loadState();
  const { data: sk, indent } = loadSk(state.settings);
  const found = findByPRelative(sk, rel);
  if (!found) throw err('这篇还没登记在 sk.json 里，先在面板上「发布」它', 409);
  upsertSkEntry(sk, { group, name: body.title || found.name, pRel: rel, prev: found });
  saveSk(state.settings, sk, indent);
  return { ok: true, group, path: rel };
}

export function postArticleDelete(body) {
  const { abs, rel } = asPRelative(body.path);
  if (!isFile(abs)) throw err('文件不在：' + rel, 404);
  const state = loadState();
  const { data: sk, indent } = loadSk(state.settings);
  const found = findByPRelative(sk, rel);

  fs.unlinkSync(abs);
  if (found) {
    removeSkEntry(sk, found);
    saveSk(state.settings, sk, indent);
  }
  /* 归档元数据顺手清掉，免得留一条指向空气的记录 */
  const href = toSiteHref(abs);
  if (state.archiveMeta[href]) {
    delete state.archiveMeta[href];
    saveState(state);
  }
  return { ok: true, path: rel, unregistered: !!found };
}

/* ═══════════════════════════════════════════════════
   归档 / 取消归档 / 重建 / 回滚
   ═══════════════════════════════════════════════════ */

/**
 * 把「用户可能传进来的各种写法」收敛成**原文的 /p 相对路径**。
 * 收这几种：
 *   archive/idea/x.html        ← 面板列表里的产物路径
 *   p/archive/idea/x.html      ← sk.json 里登记的写法
 *   archive/idea/x.md          ← 手快写成原文后缀
 *   idea/x.md                  ← 已经是原文路径，原样返回
 */
function archiveArticlePRel(settings, input) {
  const inbox = String(input || '').replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
  const dir = String(settings.archiveDir || DEFAULT_SETTINGS.archiveDir)
    .replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');

  let rel = inbox;
  if (rel === dir) rel = '';
  else if (rel.startsWith(dir + '/')) rel = rel.slice(dir.length + 1);
  else return inbox;                       /* 不在归档目录里，当原文路径用 */

  return rel.replace(/\.html?$/i, '.md');
}

/** 读一篇的 Markdown 原文：优先盘上（未归档），其次 para 留底（已归档） */
function readSource(settings, pRel) {
  const inP = path.join(pDir, pRel);
  if (isFile(inP)) return { text: fs.readFileSync(inP, 'utf8'), from: 'p' };

  const state = loadState();
  /* 元数据的键就是 /p 相对的产物路径，和 sk.json 登记的那套一致 */
  const meta = state.archiveMeta[archiveRelFor(settings, pRel)];
  const cands = [];
  if (meta && meta.originalRel) cands.push(path.join(paraDirOf(settings), meta.originalRel));
  cands.push(path.join(pDir, pRel));                    /* 就在原地（产物同名 .md 的怪情况） */
  cands.push(path.join(paraDirOf(settings), pRel));     /* para 里同路径 */
  for (const c of cands) {
    if (isFile(c)) return { text: fs.readFileSync(c, 'utf8'), from: c };
  }
  return null;
}

/** 预渲染一篇并落盘（含版本备份） */
function renderOne(settings, pRel, { title, group, archiveDir, metaIn }) {
  const src = readSource(settings, pRel);
  if (!src) throw err('找不到这篇的 Markdown 原文（/p 和留底目录都没有）：' + pRel, 404);

  /* archiveRel 是 /p 相对的（写进 sk.json 的、面板列表显示的，都是它）；
     siteRel 只在算磁盘路径和页面前缀时用一下就丢。 */
  const archiveRel = archiveRelFor(settings, pRel);
  const siteRel = siteRelOfArchive(settings, pRel);
  const outAbs = assertInside(path.join(siteRoot, siteRel), archiveDir);

  /* 覆盖前留一版 */
  backupVersion(outAbs, archiveDir);

  const html = renderArticleHtml(src.text, {
    title: title || defaultTitle(pRel),
    siteRel,
    theme: settings.theme,
  });
  writeAtomic(outAbs, html);

  /* 这篇用了、但烘不进静态 HTML 的语法（mermaid 之类）：归档照常成功，
     只是产物里那几段还是代码块 —— 把原因带回去让界面说一声。 */
  const warnings = scanUnsupported(src.text, 'bake').map((u) => ({
    path: pRel,
    lang: u.lang,
    label: u.label,
    detail: u.detail,
  }));

  return {
    warnings,
    entry: {
      pRel,
      /** /p 相对 —— sk.json 登记的就是它（MANIFEST.md §7 的约定） */
      archiveRel,
      href: toSiteHref(outAbs),
      title: title || defaultTitle(pRel),
      group,
      from: src.from,
      bytes: fs.statSync(outAbs).size,
      ...(metaIn || {}),
    },
  };
}

/**
 * 归档：只处理传进来的这些路径。
 * 步骤（任一步失败就把前面动过的搬回去）：
 *   1. 先把 Markdown 原文读进内存
 *   2. 预渲染落 /p/archive
 *   3. 原文从 /p 移到 para 留底
 *   4. sk.json 登记产物（名字加「（归档）」后缀）
 */
export function postArchive(body) {
  const paths = Array.isArray(body.paths) ? body.paths.filter(Boolean) : [];
  if (!paths.length) throw err('没有勾选任何文章（归档只作用于勾选项）');

  const state = loadState();
  const settings = state.settings;
  const archiveDir = ensureDir(archiveDirOf(settings));
  const { data: sk, indent } = loadSk(settings);

  const done = [];
  try {
    for (const p of paths) {
      const rel = String(p).replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
      const abs = path.join(pDir, rel);
      if (!isFile(abs)) throw err('文件不在：' + rel, 404);
      if (path.extname(rel).toLowerCase() !== '.md') throw err('只有 .md 能归档：' + rel);

      const found = findByPRelative(sk, rel);
      const group = body.group || (found && found.group) || '未分组';
      const title = (found && found.name) || defaultTitle(rel);

      /* 1 + 2：先出成品，再动原文 —— 万一渲染失败，原文还在 /p 原封不动 */
      const { entry, warnings } = renderOne(settings, rel, { title, group, archiveDir });

      /* 3：原文搬走 */
      const originalRel = moveToPara(settings, rel);

      /* 4：登记 */
      const name = /（归档）$/.test(title) ? title : title + '（归档）';
      removeSkEntry(sk, found);
      if (!sk[group]) sk[group] = {};
      sk[group][name] = entry.archiveRel;

      /* 元数据的键 = /p 相对的产物路径（和 sk.json 里登记的那套一致） */
      state.archiveMeta[entry.archiveRel] = {
        originalRel,
        archivedPath: entry.archiveRel,
        articlePath: rel,
        title,
        group,
        archivedAt: new Date().toISOString(),
      };

      done.push({ rel, entry, originalRel, group, name, prev: found, warnings });
    }

    /* 最后写清单与元数据：这两个是「提交点」 */
    saveSk(settings, sk, indent);
    saveState(state);
  } catch (e) {
    /* 回滚：把已经搬走的原文搬回来、删掉刚生成的产物 */
    for (const d of done) {
      try {
        const back = path.join(pDir, d.rel);
        if (!exists(back)) {
          const fromPara = path.join(paraDirOf(settings), d.originalRel);
          if (isFile(fromPara)) {
            ensureDir(path.dirname(back));
            fs.renameSync(fromPara, back);
          }
        }
        /* 产物路径按 /p 相对存着，删的时候要补回站点根的 p/ 前缀 */
        const outAbs = path.join(siteRoot, siteRelOfArchive(settings, d.rel));
        if (isFile(outAbs)) fs.unlinkSync(outAbs);
      } catch { /* 回滚尽力而为，主错误更重要 */ }
    }
    throw e;
  }

  return {
    ok: true,
    archived: done.map((d) => ({
      path: d.rel,
      original: d.originalRel,
      /** /p 相对：面板列表和 sk.json 用的都是它 */
      output: d.entry.archiveRel,
      /** 站点根相对：算 URL / 磁盘路径时方便 */
      sitePath: siteRelOfArchive(settings, d.rel),
      group: d.group,
      name: d.name,
    })),
    /* 归档里画不出来的语法：产物照常生成（那几段是代码块），这里说清楚是哪几篇 */
    warnings: done.flatMap((d) => d.warnings || []),
    state: getState(),
  };
}

export function postArchiveRebuild(body) {
  const paths = Array.isArray(body.paths) ? body.paths.filter(Boolean) : [];
  if (!paths.length) throw err('没有勾选任何已归档的文章');

  const state = loadState();
  const settings = state.settings;
  const archiveDir = ensureDir(archiveDirOf(settings));
  const out = [];
  const warn = [];
  for (const p of paths) {
    /* 面板传进来的是产物路径（archive/idea/x.html）；要还原成原文的 /p 相对路径，
       才能重新渲染。写法的收敛只在这一处做，别让 archiveRelFor 再拼一次。 */
    const rel = archiveArticlePRel(settings, p);
    const siteRel = siteRelOfArchive(settings, rel);
    const outAbs = path.join(siteRoot, siteRel);
    if (!isFile(outAbs)) throw err('这篇没有已归档的产物，先归档它：' + rel, 409);

    const meta = state.archiveMeta[archiveRelFor(settings, rel)] || {};
    const { entry, warnings } = renderOne(settings, rel, {
      title: meta.title || defaultTitle(rel),
      group: meta.group,
      archiveDir,
      metaIn: {},
    });
    out.push({ path: rel, output: entry.archiveRel, from: entry.from });
    warn.push(...(warnings || []));
  }
  saveState(state);
  return { ok: true, rebuilt: out, warnings: warn };
}

/**
 * 重刷外壳：把已归档的产物按**当前模板**重写 head / 顶栏 / 侧栏目录 / 页脚，
 * 正文一个字都不动。
 *
 * 为什么需要它：归档产物是控制台烘的成品，外壳是烘的那一刻的样子；
 * 后来文章页加了顶栏、目录、主题 token，老产物不会自己变。而有的产物
 * 原文早就不在了（`originalRel` 缺失、para 留底也没有）—— 重新渲染做不到，
 * 换外壳却完全可以：正文本来就在产物里。
 *
 * 覆盖前照例留一版到 .versions（和归档、重建、回滚一个规矩）。
 */
export function postArchiveReshell(body) {
  const paths = Array.isArray(body.paths) ? body.paths.filter(Boolean) : [];
  if (!paths.length) throw err('没有勾选任何已归档的产物');

  const state = loadState();
  const settings = state.settings;
  const archiveDir = ensureDir(archiveDirOf(settings));
  const done = [];
  const failed = [];

  for (const raw of paths) {
    try {
      /* 面板传的是产物路径（archive/idea/x.html）；这里要的是 /p 相对的那一种 */
      const rel = String(raw).replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
      if (!/\.html?$/i.test(rel)) throw err('「重刷外壳」只能作用于已归档的 .html 产物：' + raw, 409);
      const outAbs = assertInside(path.join(pDir, rel), archiveDir);
      if (!isFile(outAbs)) throw err('产物不在：' + rel, 404);

      const current = fs.readFileSync(outAbs, 'utf8');
      const parts = extractProductParts(current);
      if (!parts) throw err('这个产物里找不到正文容器（class="md"），没法只换外壳：' + rel, 409);

      const meta = state.archiveMeta[rel] || {};
      const html = renderShell({
        bodyHtml: parts.bodyHtml,
        title: parts.meta.title || meta.title || defaultTitle(rel),
        desc: parts.meta.summary || '',
        tags: parts.meta.tags || [],
        published: parts.meta.date || '',
        canonical: parts.meta.canonical || '',
        siteRel: 'p/' + rel,
        theme: settings.theme,
      });

      backupVersion(outAbs, archiveDir);
      writeAtomic(outAbs, html);
      done.push({ path: rel, bytes: Buffer.byteLength(html, 'utf8') });
    } catch (e) {
      failed.push({ path: raw, error: e && e.message ? e.message : String(e) });
    }
  }

  return { ok: !failed.length, reshelled: done, failed, state: getState() };
}

export function postArchiveRollback(body) {
  /* 面板传的是产物路径（archive/idea/x.html）；先还原成原文路径再算产物路径 */
  const state = loadState();
  const settings = state.settings;
  const rel = archiveArticlePRel(settings, body.path);
  const archiveDir = archiveDirOf(settings);
  const outAbs = assertInside(path.join(siteRoot, siteRelOfArchive(settings, rel)), archiveDir);
  if (!isFile(outAbs)) throw err('没有产物可回滚：' + rel, 404);

  const versions = listVersions(outAbs, archiveDir);
  if (!versions.length) throw err('这篇还没有历史版本（第一次归档时不会留版本）', 409);

  /* 现在这一版也先存下来，回滚本身也能再回滚 */
  backupVersion(outAbs, archiveDir);
  fs.copyFileSync(versions[0].abs, outAbs);
  return { ok: true, path: rel, restoredFrom: versions[0].name, versions: listVersions(outAbs, archiveDir).length };
}

/** 产物列表（归档面板用） */
export function listArchive() {
  const state = loadState();
  const { data: sk } = loadSk(state.settings);
  const scan = scanP(state.settings, sk);
  const archiveDir = archiveDirOf(state.settings);

  return {
    archived: scan.articles.filter((a) => a.isArchive).map((a) => {
      /* 元数据的键就是 /p 相对的产物路径（a.path 也是这一种） */
      const meta = state.archiveMeta[a.path] || {};
      return {
        path: a.path,
        href: a.href,
        bytes: a.bytes,
        mtime: a.mtime,
        versions: a.versions,
        title: meta.title || a.title,
        group: meta.group || a.group,
        originalRel: meta.originalRel || null,
        originalExists: !!(meta.originalRel && isFile(path.join(paraDirOf(state.settings), meta.originalRel))),
        registered: a.status === 'archived',
      };
    }),
    paraDir: paraDirOf(state.settings),
    archiveDir,
    versionsRoot: versionsDirOf(archiveDir),
    totalBytes: scan.stats.archivedBytes,
  };
}

/**
 * 取消归档：产物删掉、原文从 para 搬回 /p、sk.json 登记还原。
 * 产物先删还是原文先搬？—— 先搬原文（万一搬失败，产物还在、还能重试）。
 */
export function postUnarchive(body) {
  const raw = String(body.path || '');
  const state = loadState();
  const settings = state.settings;
  const archiveDir = archiveDirOf(settings);

  /* 允许传产物路径（archive/x.html 或 p/archive/x.html），也允许直接传原文相对路径 */
  const stripped = raw.replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
  const archiveRel = stripped.endsWith('.html') ? stripped : archiveRelFor(settings, stripped);
  const outAbs = assertInside(path.join(siteRoot, 'p/' + archiveRel), archiveDir);
  if (!isFile(outAbs)) throw err('找不到产物：' + archiveRel, 404);

  const meta = state.archiveMeta[archiveRel] || {};
  const restored = meta.originalRel
    ? moveFromPara(settings, meta.originalRel)
    : null;

  fs.unlinkSync(outAbs);

  const { data: sk, indent } = loadSk(settings);
  /* 登记还原：从「（归档）」名字换回普通名字，指向恢复后的 .md */
  const prev = findByPRelative(sk, archiveRel);
  if (prev) removeSkEntry(sk, prev);
  if (restored) {
    const title = meta.title || defaultTitle(restored);
    const group = meta.group || (prev && prev.group) || '未分组';
    if (!sk[group]) sk[group] = {};
    sk[group][title] = restored;
    saveSk(settings, sk, indent);
  }

  delete state.archiveMeta[archiveRel];
  saveState(state);

  return { ok: true, restored, output: archiveRel, registered: restoreRegistered(sk, restored) };
}

function restoreRegistered(sk, pRel) {
  if (!pRel) return false;
  return flattenSk(sk).some((e) => e.path === pRel);
}

/* ═══════════════════════════════════════════════════
   拖拽入队发布
   ═══════════════════════════════════════════════════ */

/** 只是预判，不落盘：给队列项补默认目标路径、标题、是否撞名 */
export function postQueuePreview(body) {
  const files = Array.isArray(body.files) ? body.files : [];
  const state = loadState();
  const { data: sk } = loadSk(state.settings);

  return {
    items: files.map((f) => {
      const name = String(f.name || 'untitled');
      const ext = path.extname(name).toLowerCase();
      const kind = kindOf(name);
      const isText = TEXT_EXT.includes(ext);
      const dir = f.targetDir || (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' ? 'asset' : '');
      const target = [dir, name].filter(Boolean).join('/').replace(/^\/+/, '');
      const abs = path.join(pDir, target);
      const reg = findByPRelative(sk, target);
      return {
        name,
        kind,
        isText,
        bytes: f.bytes || 0,
        target,
        title: f.title || (reg ? reg.name : defaultTitle(name)),
        group: f.group || (reg ? reg.group : '未分组'),
        conflict: exists(abs),
        registered: !!reg,
      };
    }),
  };
}

/**
 * 真正落盘。重名策略由队列项自己带：
 *   overwrite 覆盖 · rename 自动改名 · skip 跳过
 * 勾了 archive 的：先写进 /p，再照归档流程走一遍（只针对这一篇）。
 */
export function postPublishDrop(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw err('队列是空的');

  const results = [];
  for (const it of items) {
    const name = path.basename(String(it.name || '').trim());
    if (!name) { results.push({ ok: false, name: it.name, reason: '没有文件名' }); continue; }

    const targetRel = String(it.target || name).replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
    const destAbs = assertInside(path.join(pDir, targetRel), pDir);

    if (exists(destAbs)) {
      const policy = it.conflict || 'rename';
      if (policy === 'skip') { results.push({ ok: false, name, skipped: true, reason: '重名，按你的选择跳过了' }); continue; }
      if (policy === 'rename') {
        const alt = uniquePath(path.dirname(destAbs), path.basename(destAbs));
        results.push(...writeOne(it, alt));
        continue;
      }
      /* overwrite 往下走 */
    }
    results.push(...writeOne(it, destAbs));
  }

  /* 需要归档的，收齐了一起走归档流程（它自己会更新 sk.json） */
  const toArchive = results.filter((r) => r.ok && r.archive).map((r) => r.path);
  let archived = [];
  if (toArchive.length) {
    const r = postArchive({ paths: toArchive, group: body.group });
    archived = r.archived;
  }

  /* 文本类且没归档的，登记为已发布 */
  const state = loadState();
  const { data: sk, indent } = loadSk(state.settings);
  let touched = false;
  for (const item of items) {
    if (!item.publish) continue;
    const rel = String(item.target || item.name).replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
    if (toArchive.includes(rel)) continue;
    if (!TEXT_EXT.includes(path.extname(rel).toLowerCase())) continue;
    upsertSkEntry(sk, {
      group: item.group || '未分组',
      name: item.title || defaultTitle(rel),
      pRel: rel,
      prev: findByPRelative(sk, rel),
    });
    touched = true;
  }
  if (touched) saveSk(state.settings, sk, indent);

  return { ok: true, results, archived, state: getState() };
}

/** 写一个文件（base64 或纯文本），返回一条结果 */
function writeOne(item, destAbs) {
  const name = path.basename(destAbs);
  try {
    ensureDir(path.dirname(destAbs));
    if (typeof item.text === 'string') writeAtomic(destAbs, item.text);
    else if (typeof item.dataBase64 === 'string') {
      writeAtomic(destAbs, Buffer.from(item.dataBase64, 'base64'));
    } else {
      return [{ ok: false, name, reason: '没有内容（既没有 text 也没有 dataBase64）' }];
    }
    const rel = toPRelative(destAbs);
    return [{
      ok: true,
      name,
      path: rel,
      href: toSiteHref(destAbs),
      bytes: fs.statSync(destAbs).size,
      archive: !!item.archive,
      renamed: name !== path.basename(String(item.name || '')),
    }];
  } catch (e) {
    return [{ ok: false, name, reason: String(e && e.message ? e.message : e) }];
  }
}

/* ═══════════════════════════════════════════════════
   预览
   ═══════════════════════════════════════════════════ */

export function postPreview(body) {
  const started = Date.now();
  const src = String(body.content == null ? '' : body.content);
  const html = renderFragment(src);
  const ms = Date.now() - started;
  return {
    ok: true,
    html,
    ms,
    /* 「预览能画到什么」：界面右上角那条状态就是拿这个渲染的 */
    extras: extrasStatus(),
    /* 这篇用了、但当前画不出来的语法（给一条人话提示，而不是安静地退化成代码块） */
    unsupported: scanUnsupported(src, 'preview'),
    setupErrors: setupErrors(),
  };
}

/** 写作面板打开时，把一篇的原文和它的登记信息一起给过去 */
export function getEditorDoc(query) {
  const open = readArticle(query);
  return { ...open, rendered: renderFragment(open.content) };
}

/* ═══════════════════════════════════════════════════
   部署作业（发布面板用）
   ---------------------------------------------------
   真正的实现在 lib/jobs.mjs：它起一个
   `node build/run-pipeline.mjs --steps=… --json` 子进程，
   按 JSON Lines 收进度、写日志文件。
   这里只做「接口形状」的转换与参数兜底。
   ═══════════════════════════════════════════════════ */

export function getJobs() {
  return {
    jobs: jobs.listJobs(),
    busy: jobs.isBusy(),
    current: jobs.currentJob(),
    pipelines: jobs.PIPELINES,
    flags: Object.keys(jobs.FLAGS),
  };
}

export function postJob(body) {
  const pipeline = String((body && body.pipeline) || '');
  const flags = (body && body.flags) || {};
  const label = (body && body.label) || undefined;
  const started = jobs.startJob({ pipeline, flags, label });
  return { ok: true, ...started };
}

export function getJob(query) {
  const id = String((query && query.id) || '');
  const job = jobs.getJob(id);
  const log = jobs.readLog(id, (query && query.offset) || 0);
  return { job, log };
}

export function postJobStop(body) {
  const id = String((body && body.id) || '');
  return jobs.stopJob(id);
}

/* ═══════════════════════════════════════════════════
   文档清单 sk.json
   ═══════════════════════════════════════════════════ */

export function getManifest() { return manifest.getManifest(); }

export function putManifest(body) { return manifest.putManifest(body); }

export function postManifestEntry(body) { return manifest.postManifestEntry(body); }

export function postManifestScan() { return manifest.scanManifest(); }

export function postManifestFix(body) { return manifest.postManifestFix(body); }

/* ═══════════════════════════════════════════════════
   与云端合并 / 部署前预检
   ═══════════════════════════════════════════════════ */

export function postCloudScan(body) {
  return cloud.scan({
    source: String((body && body.source) || 'github'),
    domain: (body && body.domain) || null,
    onProgress: null,
  });
}

/** 可选域名（来自 rth-sites.json） */
export function getCloudDomains() { return cloud.domainOptions(); }

export async function postCloudDiff(body) {
  return cloud.diffFile({
    source: String((body && body.source) || 'github'),
    domain: (body && body.domain) || null,
    path: String((body && body.path) || ''),
    baseAt: (body && body.baseAt) || null,
  });
}

export async function postCloudPull(body) {
  return cloud.pull({
    source: String((body && body.source) || 'github'),
    domain: (body && body.domain) || null,
    paths: Array.isArray(body && body.paths) ? body.paths : [],
    force: !!(body && body.force),
  });
}

export async function postCloudPrecheck(body) {
  return cloud.precheck({
    source: String((body && body.source) || 'github'),
    domain: (body && body.domain) || null,
  });
}

/* ═══════════════════════════════════════════════════
   死链与资源检查
   ═══════════════════════════════════════════════════ */

export function postLinksScan(body) {
  return links.scan({ scope: String((body && body.scope) || 'p') });
}

/* ═══════════════════════════════════════════════════
   一键「发布全部并部署」
   ---------------------------------------------------
   前两步（发布队列里的东西、清单检查）在本进程里做，
   检查有问题且没有 force 就**拦下**；通过了才起部署作业。
   ═══════════════════════════════════════════════════ */

export function postPublishAll(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [];
  const phases = [];

  if (items.length) {
    const r = postPublishDrop({ items, group: body.group });
    const okCount = (r.results || []).filter((x) => x.ok).length;
    phases.push({ name: '发布队列', state: 'ok', detail: `${okCount}/${items.length} 个文件写进 /p` });
  } else {
    phases.push({ name: '发布队列', state: 'skipped', detail: '队列是空的' });
  }

  const scan = manifest.scanManifest();
  const errors = scan.problems.filter((p) => p.level === 'error');
  if (errors.length && !body.force) {
    phases.push({ name: '检查清单', state: 'fail', detail: `${errors.length} 个错误，已拦下（想强行继续用 force）` });
    return { ok: false, stopped: true, phases, problems: scan.problems };
  }
  phases.push({ name: '检查清单', state: 'ok', detail: scan.problems.length ? `${scan.problems.length} 条提示，无阻断错误` : '没问题' });

  const started = jobs.startJob({ pipeline: 'full', flags: body.flags || {}, label: body.label || '发布全部并部署' });
  phases.push({ name: '构建并部署', state: 'running', detail: '已开始，看下面的实时日志' });
  return { ok: true, phases, jobId: started.id };
}

/* ═══════════════════════════════════════════════════
   自检（界面右上角那个小灯）
   ═══════════════════════════════════════════════════ */

export function getSelfCheck() {
  const state = loadState();
  const { data: sk, file } = loadSk(state.settings);
  const scan = scanP(state.settings, sk);
  const core = coreStatus();
  const problems = [];
  if (!core.ok) problems.push(core.error);
  if (!isFile(file)) problems.push('读不到 sk.json：' + file);
  const pubMissing = flattenSk(sk).filter((e) => !exists(path.join(pDir, e.path)));
  if (pubMissing.length) problems.push(`${pubMissing.length} 条登记指向的文件不在 /p 下（例如 ${pubMissing[0].path}）`);
  /* 渲染增强坏掉不算「站点坏了」，只列出来让人知道预览里会少什么 */
  const extras = extrasStatus();
  const setup = setupErrors();
  if (setup.length) problems.push('预览增强装载报错：' + setup.join('；'));
  return { ok: problems.length === 0, problems, core, extras, stats: scan.stats, skFile: file };
}

/* ═══════════════════════════════════════════════════
   预览：页面树 + 本地预览服务
   ---------------------------------------------------
   页面树只读盘，不写任何东西（见 lib/pages.mjs）。
   预览服务是本进程里的另一个 http server（lib/preview.mjs），
   不用子进程 —— 和这个文件的其余部分一样，起停都在同一个进程里。
   ═══════════════════════════════════════════════════ */

/** 一键列出所有页面 */
export function getPages(query = {}) {
  const settings = loadState().settings;
  const source = query.source || settings.previewTreeSource;
  const tree = pages.buildPageTree({ source });
  return { ...tree, service: preview.previewStatus() };
}

export function getPreviewStatus() {
  return { ...preview.previewStatus(), settings: previewSettingsOf() };
}

/** 起预览服务。端口优先用调用方给的，其次设置里的 */
export async function postPreviewStart(body = {}) {
  const settings = loadState().settings;
  const port = clampPort(body.port, settings.previewPort);
  const status = await preview.startPreview({ port });
  return { ...status, opened: false, settings: previewSettingsOf() };
}

export async function postPreviewStop() {
  const status = await preview.stopPreview();
  return { ...status, settings: previewSettingsOf() };
}

function previewSettingsOf() {
  const s = loadState().settings;
  return {
    previewPort: s.previewPort,
    previewAutoStart: s.previewAutoStart,
    previewOpenAfterStart: s.previewOpenAfterStart,
    previewClickMode: s.previewClickMode,
    previewTreeSource: s.previewTreeSource,
  };
}
