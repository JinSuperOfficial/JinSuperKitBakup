/**
 * 数据层：sk.json 读写（保形）、设置与归档元数据、/p 扫描
 * ---------------------------------------------------
 * 两条原则：
 *   1. **sk.json 的形状不许改**。它是文档阅读器的清单（MANIFEST.md §7），
 *      只是「分组 → 标题 → 路径」两层结构；归档状态不往里塞新字段，
 *      靠「登记了没有」+「路径是不是 /p/archive/*.html」推出来。
 *   2. **写盘一律原子**。先写同目录临时文件再 rename，中途失败不会留半个 JSON。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS, archiveDirOf, exists, isDir, isFile, paraDirOf, pDir,
  resolveSitePath, siteRoot, skFile, stateDir, stateFile, toPRelative, toSiteHref, walk,
  workspaceRoot,
} from './paths.mjs';

/* ═══════════════════════════════════════════════════
   原子写 + 进度保持的 JSON 读写
   ═══════════════════════════════════════════════════ */

/** 原子写文本 */
export function writeAtomic(fileAbs, text) {
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  const tmp = fileAbs + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, fileAbs);
}

/** 从原文里嗅出缩进（制表符 / 几个空格），写回时保持一致 */
function detectIndent(raw) {
  const m = /\n([ \t]+)"/.exec(raw);
  if (!m) return 2;
  if (m[1].includes('\t')) return '\t';
  return m[1].length || 2;
}

/**
 * 读 JSON；坏掉时先备份再抛（绝不默默覆盖用户的东西）
 * ---------------------------------------------------
 * 备份落在 **stateDir/backups/<时间戳>/**，不是原文件旁边：
 * 站点目录里的任何文件都会被 prep-deploy 镜像进 dist 再传上线，
 * 把 sk.json.bak-… 留在那里等于把备份也发到线上（还带一份坏内容的副本）。
 */
export function readJsonSafe(fileAbs, { fallback = null, backup = true } = {}) {
  if (!exists(fileAbs)) return fallback;
  const raw = fs.readFileSync(fileAbs, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    let bak = null;
    if (backup) {
      bak = backupToState(fileAbs);
    }
    const err = new Error(
      `${path.basename(fileAbs)} 不是合法 JSON：${e.message}` +
      (bak ? `（原文件已备份到 ${path.relative(workspaceRoot, bak)}）` : ''),
    );
    err.status = 500;
    err.backup = bak;
    throw err;
  }
}

/** 把某个文件复制到 stateDir/backups/<时间戳>/，返回备份的绝对路径 */
export function backupToState(fileAbs) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(stateDir, 'backups', stamp);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(fileAbs));
    fs.copyFileSync(fileAbs, dest);
    return dest;
  } catch {
    return null;
  }
}

export function writeJson(fileAbs, data, indent = 2) {
  writeAtomic(fileAbs, JSON.stringify(data, null, indent) + '\n');
}

/* ═══════════════════════════════════════════════════
   设置 + 归档元数据（console/state.json）
   ═══════════════════════════════════════════════════ */

export function loadState() {
  const raw = readJsonSafe(stateFile, { fallback: {} }) || {};
  return {
    settings: Object.assign({}, DEFAULT_SETTINGS, raw.settings || {}),
    archiveMeta: raw.archiveMeta && typeof raw.archiveMeta === 'object' ? raw.archiveMeta : {},
    /** 写作面板动过的文件（站点绝对路径 → 时间戳）：用来区分「草稿」和「未发布」 */
    drafts: raw.drafts && typeof raw.drafts === 'object' ? raw.drafts : {},
  };
}

export function saveState(state) {
  writeJson(stateFile, {
    settings: Object.assign({}, DEFAULT_SETTINGS, state.settings || {}),
    archiveMeta: state.archiveMeta || {},
    drafts: state.drafts || {},
  });
}

/** 设置里那些路径得真的能用，不然归档会以奇怪的方式失败 */
export function validateSettings(settings) {
  const problems = [];
  const ad = archiveDirOf(settings);
  const pd = paraDirOf(settings);
  const sk = skFile(settings);
  if (!exists(path.dirname(ad))) problems.push('归档目录的上级不存在：' + path.dirname(ad).replace(siteRoot, ''));
  if (!exists(path.dirname(pd))) problems.push('原文留底目录的上级不存在：' + path.dirname(pd));
  if (!isFile(sk)) problems.push('sk.json 不在这个位置：' + sk.replace(siteRoot, ''));
  return problems;
}

/* ═══════════════════════════════════════════════════
   sk.json
   ═══════════════════════════════════════════════════ */

/** 读写文档站清单；返回 {data, indent, file} */
export function loadSk(settings) {
  const file = skFile(settings);
  const raw = exists(file) ? fs.readFileSync(file, 'utf8') : '';
  const indent = detectIndent(raw || '{\n  "x": 1\n}');
  const data = raw.trim() ? readJsonSafe(file, { fallback: {} }) : {};
  return { data: normalizeSk(data), indent, file };
}

/** 只保留「分组 → {标题: 路径}」这一种形状（顺手兼容早期扁平写法） */
function normalizeSk(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.assign({}, v);
    } else if (typeof v === 'string') {
      /* 扁平写法：归到一个默认分组里，不丢东西 */
      out['文档'] = out['文档'] || {};
      out['文档'][k] = v;
    }
  }
  return out;
}

export function saveSk(settings, data, indent) {
  const file = skFile(settings);
  writeJson(file, data, indent == null ? 2 : indent);
  return file;
}

/** 摊平成 [{group, name, path}]；path 是相对 /p/ 的写法 */
export function flattenSk(sk) {
  const out = [];
  for (const [group, items] of Object.entries(sk || {})) {
    for (const [name, p] of Object.entries(items || {})) {
      if (typeof p !== 'string' || !p.trim()) continue;
      out.push({ group, name, path: p.trim() });
    }
  }
  return out;
}

/**
 * sk.json 里的路径写法统一成「/p 相对」再比。
 * ---------------------------------------------------
 * 登记归档产物时写的是站点根相对（`p/archive/x.html`），而面板列表
 * 用的是 /p 相对（`archive/x.html`）—— 归一到同一种写法，比对才靠得住。
 */
export function normalizePRel(p) {
  return String(p == null ? '' : p)
    .trim()
    .replace(/^[/\\]+/, '')
    .replace(/^p[/\\]/, '');
}

/** 找某个 p 内相对路径登记在哪（返回 {group, name} 或 null） */
export function findByPRelative(sk, pRel) {
  const want = normalizePRel(pRel);
  for (const e of flattenSk(sk)) {
    if (normalizePRel(e.path) === want) return e;
  }
  return null;
}

/** 登记 / 改路径；同名同组会被覆盖（就是要覆盖） */
export function upsertSkEntry(sk, { group, name, pRel, prev }) {
  const g = group || (prev && prev.group) || '未分组';
  const n = name || (prev && prev.name) || pRel;

  /* 先把旧位置清掉，避免同一篇登记两次 */
  if (prev && sk[prev.group]) {
    delete sk[prev.group][prev.name];
    if (!Object.keys(sk[prev.group]).length) delete sk[prev.group];
  }
  if (!sk[g]) sk[g] = {};
  sk[g][n] = pRel;
  return { group: g, name: n };
}

export function removeSkEntry(sk, found) {
  if (!found || !sk[found.group]) return false;
  if (!(found.name in sk[found.group])) return false;
  delete sk[found.group][found.name];
  if (!Object.keys(sk[found.group]).length) delete sk[found.group];
  return true;
}

/* ═══════════════════════════════════════════════════
   /p 扫描
   ═══════════════════════════════════════════════════ */

/** 这些后缀算「文章 / 素材」，能被面板管起来 */
export const TEXT_EXT = ['.md', '.markdown', '.mdown', '.txt', '.html', '.htm'];
export const MEDIA_EXT = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
  '.pdf', '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.mp4', '.webm', '.mov',
];
export const ALL_EXT = TEXT_EXT.concat(MEDIA_EXT);

export function kindOf(p) {
  const ext = path.extname(String(p)).toLowerCase();
  if (['.md', '.markdown', '.mdown'].includes(ext)) return 'md';
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.txt') return 'text';
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac'].includes(ext)) return 'audio';
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  return 'other';
}

/** 文件名的默认标题：去扩展名 + 去掉开头的序号 */
export function defaultTitle(pRel) {
  const base = path.basename(String(pRel)).replace(/\.[^.]+$/, '');
  return base.replace(/^\d+[.\-_、]\s*/, '') || base;
}

/**
 * 归档产物对应的路径，**相对 /p**：`archive/<原名>.html`
 * ---------------------------------------------------
 * sk.json 的约定就是「相对 /p/」（见 MANIFEST.md §7），登记进清单的必须是这一种。
 * 早先这里是「站点根相对」的写法（`p/archive/…`），构建期按 /p 解析就变成
 * `p/p/archive/…`，「文件不存在」—— 别再改回去。
 * 需要站点根相对（页面 href、fs 绝对路径）时用 siteRelOfArchive() 自己拼。
 */
export function archiveRelFor(settings, pRel) {
  const dir = archiveDirInP(settings);
  const noExt = String(pRel).replace(/\.[^.]+$/, '');
  return dir + '/' + noExt + '.html';
}

/** archiveDir 设置项收敛成「相对 /p」的目录名，接收 `p/archive` 和 `archive` 两种写法 */
export function archiveDirInP(settings) {
  return String((settings && settings.archiveDir) || DEFAULT_SETTINGS.archiveDir)
    .replace(/^[/\\]+/, '')
    .replace(/^p[/\\]/, '')
    .replace(/[/\\]+$/, '');
}

/** 站点根相对写法（`p/archive/x.html`）：写盘、算 href 时用 */
export function siteRelOfArchive(settings, pRel) {
  return 'p/' + archiveRelFor(settings, pRel);
}

/** 某个 p 内相对路径是不是落在归档目录里 */
export function isInArchive(settings, pRel) {
  const dir = archiveDirInP(settings);
  const p = String(pRel);
  return p === dir || p.startsWith(dir + '/');
}

/** 归档产物是不是本站自己写的（头部注释 + 正文结构都对得上） */
export function looksPrerendered(text) {
  const s = String(text || '');
  return s.includes('由发布控制台预渲染') || s.includes('class="md"');
}

/**
 * 这些文件是构建产物或阅读器外壳，不是「文章」，不该出现在文章列表里
 * （列出来只会让人误以为可以删）。路径相对 /p/。
 */
export const GENERATED_FILES = new Set([
  'docs.html',        /* build 生成：文档阅读器外壳 */
  'docs-md.js',       /* build 生成：浏览器端渲染器 */
  'docs-md.css',      /* build 生成：样式 */
  'docs-card.js',     /* 卡片插件（站点运行时的一部分） */
  'viewer.html',
  'black.html',
  'raw.php',
  'index.html',       /* 文档站的落地页 */
]);

/**
 * 扫一遍 /p，把「盘上有什么」和「sk.json 登记了什么」对起来。
 * 返回的文章已经带上状态，界面不用自己推。
 */
export function scanP(settings, sk) {
  const state = loadState();
  const files = walk(pDir, { base: pDir, skipDirs: new Set(['fonts']) });
  const registered = flattenSk(sk);
  const regByPath = new Map(registered.map((e) => [normalizePRel(e.path), e]));
  const draftMark = state.drafts && typeof state.drafts === 'object' ? state.drafts : {};

  const articles = [];
  for (const pRel of files) {
    const ext = path.extname(pRel).toLowerCase();
    if (!ALL_EXT.includes(ext)) continue;
    if (GENERATED_FILES.has(pRel)) continue;          /* 构建产物 / 阅读器外壳不算文章 */
    const abs = path.join(pDir, pRel);
    const st = fs.statSync(abs);
    const reg = regByPath.get(pRel) || null;
    const isArchive = isInArchive(settings, pRel);

    let status;
    if (reg && isArchive) status = 'archived';
    else if (reg) status = 'published';
    else if (isArchive) status = 'orphan-archive';   /* 产物还在但没登记了 */
    else status = 'unpublished';

    const meta = state.archiveMeta[toSiteHref(abs)] || null;
    articles.push({
      path: pRel,
      href: toSiteHref(abs),
      kind: kindOf(pRel),
      title: reg ? reg.name : defaultTitle(pRel),
      group: reg ? reg.group : null,
      status,
      /** 写作面板动过、还没登记的，算草稿 —— 面板里的「草稿」状态就是它 */
      draft: !!draftMark[toSiteHref(abs)],
      mtime: st.mtimeMs,
      bytes: st.size,
      isArchive,
      archivedPath: isArchive ? toSiteHref(abs) : null,
      /** 已归档项：原文留底的绝对路径（来自元数据，可能已被手工清掉） */
      originalRel: meta && meta.originalRel ? meta.originalRel : null,
      originalExists: !!(meta && meta.originalRel && isFile(path.join(paraDirOf(settings), meta.originalRel))),
      versions: 0,
    });
  }

  /* 版本数：单独数一次，免得在列表里同步做大量 stat */
  const archiveRoot = archiveDirOf(settings);
  for (const a of articles) {
    if (!a.isArchive) continue;
    const relInArchive = path.relative(archiveRoot, path.join(pDir, a.path));
    const dir = path.join(archiveRoot, '.versions', path.dirname(relInArchive));
    const base = path.basename(a.path) + '.';
    if (isDir(dir)) {
      a.versions = fs.readdirSync(dir).filter((n) => n.startsWith(base) && n.endsWith('.bak')).length;
    }
  }

  /* 统计只数「文章」（.md），素材和归档产物分开算 */
  const md = articles.filter((a) => a.kind === 'md');
  const stats = {
    total: md.length,
    draft: md.filter((a) => a.draft && a.status === 'unpublished').length,
    published: md.filter((a) => a.status === 'published').length,
    archived: md.filter((a) => a.status === 'archived').length,
    unpublished: md.filter((a) => a.status === 'unpublished').length,
    media: articles.filter((a) => a.kind !== 'md' && a.kind !== 'text').length,
    archivedBytes: articles.filter((a) => a.isArchive).reduce((n, a) => n + a.bytes, 0),
  };

  articles.sort((a, b) => b.mtime - a.mtime);
  return { articles, stats, groups: Object.keys(sk || {}) };
}

/* ── 到处都用得着的小工具 ── */

export function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** 撞名时找一个不冲突的名字：a.md → a-2.md */
export function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let cand = path.join(dir, filename);
  let n = 2;
  while (exists(cand)) {
    cand = path.join(dir, `${stem}-${n}${ext}`);
    n++;
    if (n > 999) break;
  }
  return cand;
}

/**
 * 把某个文件搬进 para 留底：**保持它在 /p 下的相对路径结构**，
 * 这样「归档后原文去哪了」一眼能看出来，也不会和别的同名文件打架。
 * 真撞名（同一路径重复归档）才加序号。
 * @returns {string} 相对 para 的路径
 */
export function moveToPara(settings, pRel) {
  const para = paraDirOf(settings);
  const src = path.join(pDir, pRel);
  const destDir = ensureDir(path.join(para, path.dirname(pRel)));
  const dest = exists(path.join(destDir, path.basename(pRel)))
    ? uniquePath(destDir, path.basename(pRel))
    : path.join(destDir, path.basename(pRel));
  fs.renameSync(src, dest);
  return path.relative(para, dest).split(path.sep).join('/');
}

/** 把留底的原文搬回 /p（取消归档用）；返回它恢复后的 p 内相对路径 */
export function moveFromPara(settings, originalRel) {
  const para = paraDirOf(settings);
  const src = path.join(para, originalRel);
  const destDir = ensureDir(path.join(pDir, path.dirname(originalRel)));
  const dest = exists(path.join(destDir, path.basename(originalRel)))
    ? uniquePath(destDir, path.basename(originalRel))
    : path.join(destDir, path.basename(originalRel));
  fs.renameSync(src, dest);
  return path.relative(pDir, dest).split(path.sep).join('/');
}
