/**
 * 文档站清单（sk.json）：读取 / 直接编辑 / 扫描 / 一键修复
 * ---------------------------------------------------
 * 清单是「分组 → 标题 → 路径」两层结构（MANIFEST.md §7），
 * 路径的约定是**相对 /p**（`archive/x.html`、`idea/x.md`），
 * 例外是 `../asset/xxx.md`（那三篇素材文档在站点之外）。
 *
 * 两条红线：
 *   1. 不发明新字段、不改形状 —— 阅读器和构建期都按这个形状解析。
 *   2. 写盘一律先备份再原子写；坏了要能改回来（界面里给原始文本编辑器就是这个用途）。
 *
 * 扫描出来的问题都带稳定 id，界面按 id 显示与修复。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  exists, isFile, pDir, siteRoot, toPRelative, workspaceRoot,
} from './paths.mjs';
import {
  archiveDirInP, backupToState, flattenSk, kindOf, loadSk, loadState, normalizePRel, saveSk,
  scanP, writeAtomic, TEXT_EXT, MEDIA_EXT,
} from './store.mjs';

export const ASSET_DOC = /^\.\.\/asset\/(.+)$/;

/** 登记路径 → 磁盘位置（与 build.mjs 的 renderOne 同一套解析） */
export function resolveRegistered(p) {
  const raw = String(p == null ? '' : p).trim();
  const asset = ASSET_DOC.exec(raw);
  if (asset) {
    return { abs: path.join(workspaceRoot, 'asset', asset[1]), kind: 'asset', rel: raw, normalized: raw };
  }
  const fromP = raw.replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
  return { abs: path.join(pDir, fromP), kind: 'p', rel: fromP, normalized: fromP };
}

const EXT_OK = new Set([...TEXT_EXT, ...MEDIA_EXT]);

function siteHrefOf(abs) {
  const rel = path.relative(siteRoot, abs).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;                  /* 站点之外（asset/ 那三篇） */
  return '/' + rel;
}

/* ═══════════════════════════════════════════════════
   读
   ═══════════════════════════════════════════════════ */

export function getManifest() {
  const state = loadState();
  const settings = state.settings;
  const { data, indent, file } = loadSk(settings);
  const raw = exists(file) ? fs.readFileSync(file, 'utf8') : '';

  const scan = scanP(settings, data);
  const problems = scanProblems(settings, data, raw, scan);

  const groups = Object.entries(data).map(([name, items]) => ({
    name,
    items: Object.entries(items).map(([title, p]) => {
      const r = resolveRegistered(p);
      return {
        title,
        path: String(p),
        kind: kindOf(r.rel),
        exists: isFile(r.abs),
        href: siteHrefOf(r.abs),
        registeredRel: r.rel,
      };
    }),
  }));

  return {
    file,
    siteHref: siteHrefOf(file),
    indent,
    raw,
    groups,
    entries: flattenSk(data),
    stats: {
      groups: groups.length,
      entries: groups.reduce((n, g) => n + g.items.length, 0),
      problems: problems.length,
      unregistered: scan.articles.filter((a) => a.status === 'unpublished').length,
    },
    problems,
    unregistered: scan.articles
      .filter((a) => a.status === 'unpublished')
      .map((a) => ({ path: a.path, kind: a.kind, bytes: a.bytes, mtime: a.mtime, title: a.title })),
    orphanArchives: scan.articles
      .filter((a) => a.status === 'orphan-archive')
      .map((a) => ({ path: a.path, bytes: a.bytes, mtime: a.mtime })),
    articles: scan.articles.map((a) => ({ path: a.path, kind: a.kind, status: a.status, title: a.title, group: a.group })),
  };
}

/* ═══════════════════════════════════════════════════
   扫描：把「哪里不对」说清楚
   ═══════════════════════════════════════════════════ */

export function scanProblems(settings, data, raw, scan) {
  const problems = [];
  const archiveDir = archiveDirInP(settings);
  const push = (kind, level, message, extra = {}) => problems.push({ kind, level, message, ...extra });

  /* 1. JSON 语法 */
  let parsed = null;
  if (raw.trim()) {
    try { parsed = JSON.parse(raw); }
    catch (e) {
      push('bad-json', 'error', `sk.json 不是合法 JSON：${e.message}`, { fixable: false });
      return problems;                                  /* 解析不了就别继续编了 */
    }
  }

  /* 2. 形状：扁平写法会被 reading 器兼容，但保存时会被改成分组 —— 提前说一声 */
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const flatKeys = Object.keys(parsed).filter((k) => typeof parsed[k] === 'string');
    if (flatKeys.length) {
      push('flat-manifest', 'warn', `清单是扁平写法（${flatKeys.length} 条直接挂在顶层），会被归到「文档」分组`, { fixable: true, count: flatKeys.length });
    }
  }

  const entries = flattenSk(data);
  const byPath = new Map();

  for (const e of entries) {
    const r = resolveRegistered(e.path);
    const key = r.kind === 'asset' ? e.path : r.rel;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(e);

    /* 3. 文件在不在 */
    if (!isFile(r.abs)) {
      const isArchive = r.rel.startsWith(archiveDir + '/') || r.rel === archiveDir;
      push(isArchive ? 'archive-missing' : 'missing-file', 'error',
        `「${e.group} / ${e.name}」指向的文件不在：${e.path}`, { fixable: true, group: e.group, title: e.name, path: e.path });
    }

    /* 4. 路径越界（../asset/ 是唯一允许的例外） */
    if (r.kind === 'p' && !ASSET_DOC.test(e.path)) {
      const rel = toPRelative(r.abs);
      if (rel == null) {
        push('outside-p', 'error', `「${e.group} / ${e.name}」的路径跑到 /p 外面了：${e.path}`, { fixable: true, group: e.group, title: e.name, path: e.path });
      }
    }

    /* 5. 后缀阅读器认不认 */
    const ext = path.extname(r.rel).toLowerCase();
    if (ext && !EXT_OK.has(ext)) {
      push('unsupported-ext', 'warn', `「${e.group} / ${e.name}」的后缀阅读器不认：${ext}`, { group: e.group, title: e.name, path: e.path });
    }

    /* 6. 写法混用：清单约定是相对 /p，出现 p/ 开头就统一掉 */
    if (r.kind === 'p' && /^p[/\\]/i.test(String(e.path))) {
      push('prefix-style', 'warn', `「${e.group} / ${e.name}」写成了站点根相对（${e.path}），约定是相对 /p（${r.rel}）`, { fixable: true, group: e.group, title: e.name, path: e.path, to: r.rel });
    }

    /* 7. 归档产物：标题该带「（归档）」，产物得在 */
    const isArchive = r.rel.startsWith(archiveDir + '/');
    if (isArchive && !/（归档）\s*$/.test(e.name)) {
      push('archive-suffix', 'warn', `「${e.group} / ${e.name}」是归档产物，标题建议加「（归档）」后缀`, { fixable: true, group: e.group, title: e.name, path: e.path, to: e.name + '（归档）' });
    }
  }

  /* 8. 同一文件登记多次 */
  for (const [key, list] of byPath) {
    if (list.length > 1) {
      push('duplicate-path', 'error', `${key} 被登记了 ${list.length} 次（${list.map((e) => `${e.group}/${e.name}`).join('、')}）`, { fixable: true, path: key, items: list });
    }
  }

  /* 9. 空分组 */
  for (const [g, items] of Object.entries(data)) {
    if (!Object.keys(items || {}).length) push('empty-group', 'warn', `分组「${g}」是空的`, { fixable: true, group: g });
  }

  /* 10. 磁盘上有、清单里没有 */
  const unreg = scan.articles.filter((a) => a.status === 'unpublished');
  if (unreg.length) {
    push('unregistered', 'info', `/p 下有 ${unreg.length} 个文件没登记进清单（不影响阅读器，只是侧栏看不到）`, {
      fixable: true, count: unreg.length, paths: unreg.map((a) => a.path),
    });
  }

  /* 11. 归档产物没了登记 */
  const orphan = scan.articles.filter((a) => a.status === 'orphan-archive');
  if (orphan.length) {
    push('orphan-archive', 'warn', `有 ${orphan.length} 个归档产物没有登记（${orphan.map((a) => a.path).join('、')}）`, {
      fixable: true, count: orphan.length, paths: orphan.map((a) => a.path),
    });
  }

  return problems;
}

/* ═══════════════════════════════════════════════════
   写：整份替换（源码模式）
   ═══════════════════════════════════════════════════ */

/**
 * 改清单之前先留一份备份。
 * 刻意**不**放在 sk.json 旁边：站点目录里的文件会被 prep-deploy 镜像进
 * dist 再传上线，备份留在那儿等于把旧清单也发上去。统一扔 stateDir/backups。
 */
function backupFile(file) {
  return backupToState(file);
}

export function putManifest(body) {
  const state = loadState();
  const settings = state.settings;
  const { file, indent } = loadSk(settings);
  const raw = String((body && body.raw) != null ? body.raw : '');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error('不是合法 JSON，没有保存：' + e.message);
    err.status = 400;
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('清单必须是「分组 → { 标题: 路径 }」的对象');
    err.status = 400;
    throw err;
  }
  for (const [g, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) continue;
    if (typeof v === 'string') continue;                  /* 扁平写法：兼容，保存时原样留着 */
    const err = new Error(`分组「${g}」的结构不对，应该是 { 标题: 路径 }`);
    err.status = 400;
    throw err;
  }

  const backup = backupFile(file);
  writeAtomic(file, raw.endsWith('\n') ? raw : raw + '\n');
  return { ok: true, backup: backup ? path.basename(backup) : null, ...getManifest() };
}

/* ═══════════════════════════════════════════════════
   写：结构化改动（表格模式）
   ═══════════════════════════════════════════════════ */

const OPS = new Set(['add', 'rename', 'repath', 'moveGroup', 'remove', 'addGroup', 'renameGroup', 'reorderGroups', 'reorderItems']);

export function postManifestEntry(body = {}) {
  const state = loadState();
  const settings = state.settings;
  const { data: sk, indent, file } = loadSk(settings);
  const op = String(body.op || '');
  if (!OPS.has(op)) { const e = new Error('不认识的操作：' + op); e.status = 400; throw e; }

  const group = String(body.group || '').trim();
  const title = String(body.title || '').trim();

  const removeEntry = (g, t) => {
    if (!sk[g] || !(t in sk[g])) return false;
    delete sk[g][t];
    if (!Object.keys(sk[g]).length) delete sk[g];
    return true;
  };

  if (op === 'add') {
    if (!group || !title) { const e = new Error('加条目要同时给分组和标题'); e.status = 400; throw e; }
    const p = String(body.path || '').trim();
    if (!p) { const e = new Error('加条目要给路径'); e.status = 400; throw e; }
    if (!sk[group]) sk[group] = {};
    if (title in sk[group]) { const e = new Error(`「${group}」下已经有「${title}」了`); e.status = 409; throw e; }
    sk[group][title] = p;
  } else if (op === 'rename' || op === 'repath' || op === 'moveGroup') {
    if (!group || !title) { const e = new Error('要改条目得先指明是哪一个'); e.status = 400; throw e; }
    const to = String(body.to || '').trim();
    if (!to) { const e = new Error('要改成什么？'); e.status = 400; throw e; }
    const cur = sk[group] && sk[group][title];
    if (cur == null) { const e = new Error(`找不到「${group} / ${title}」`); e.status = 404; throw e; }

    if (op === 'rename') {
      if (to === title) return { ok: true, ...getManifest() };
      if (to in sk[group]) { const e = new Error(`「${group}」下已经有「${to}」了`); e.status = 409; throw e; }
      /* 保序：把旧键换成新键，位置不动 */
      const next = {};
      for (const [k, v] of Object.entries(sk[group])) next[k === title ? to : k] = v;
      sk[group] = next;
    } else if (op === 'repath') {
      sk[group][title] = to;
    } else {
      removeEntry(group, title);
      if (!sk[to]) sk[to] = {};
      if (title in sk[to]) { const e = new Error(`「${to}」下已经有「${title}」了`); e.status = 409; throw e; }
      sk[to][title] = cur;
    }
  } else if (op === 'remove') {
    if (!removeEntry(group, title)) { const e = new Error(`找不到「${group} / ${title}」`); e.status = 404; throw e; }
  } else if (op === 'addGroup') {
    if (!group) { const e = new Error('分组名不能为空'); e.status = 400; throw e; }
    if (sk[group]) { const e = new Error('已经有这个分组了：' + group); e.status = 409; throw e; }
    sk[group] = {};
  } else if (op === 'renameGroup') {
    const to = String(body.to || '').trim();
    if (!group || !to) { const e = new Error('改名要给旧名和新名'); e.status = 400; throw e; }
    if (!sk[group]) { const e = new Error('没有这个分组：' + group); e.status = 404; throw e; }
    if (sk[to]) { const e = new Error('已经有这个分组了：' + to); e.status = 409; throw e; }
    const next = {};
    for (const [k, v] of Object.entries(sk)) next[k === group ? to : k] = v;
    for (const k of Object.keys(sk)) delete sk[k];
    Object.assign(sk, next);
  } else if (op === 'reorderGroups' || op === 'reorderItems') {
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    if (!order.length) { const e = new Error('要给出顺序'); e.status = 400; throw e; }

    if (op === 'reorderGroups') {
      const next = {};
      for (const g of order) if (sk[g]) next[g] = sk[g];
      for (const g of Object.keys(sk)) if (!(g in next)) next[g] = sk[g];   /* 没提到的留在后面，不丢 */
      for (const k of Object.keys(sk)) delete sk[k];
      Object.assign(sk, next);
    } else {
      if (!group || !sk[group]) { const e = new Error('要给分组名'); e.status = 400; throw e; }
      const cur = sk[group];
      const next = {};
      for (const t of order) if (t in cur) next[t] = cur[t];
      for (const t of Object.keys(cur)) if (!(t in next)) next[t] = cur[t];
      sk[group] = next;
    }
  }

  const backup = backupFile(file);
  saveSk(settings, sk, indent);
  return { ok: true, backup: backup ? path.basename(backup) : null, ...getManifest() };
}

/* ═══════════════════════════════════════════════════
   扫描 + 一键修复
   ═══════════════════════════════════════════════════ */

export function scanManifest() {
  const m = getManifest();
  return { ok: m.problems.length === 0, problems: m.problems, stats: m.stats, file: m.file };
}

/** 哪些问题可以一键修（界面按这个渲染按钮） */
export const FIXABLE = [
  'flat-manifest', 'prefix-style', 'empty-group', 'archive-suffix',
  'duplicate-path', 'missing-file', 'archive-missing', 'outside-p', 'unregistered', 'orphan-archive',
];

export function postManifestFix(body = {}) {
  const state = loadState();
  const settings = state.settings;
  const { data: sk, indent, file } = loadSk(settings);
  const kinds = Array.isArray(body.kinds) ? body.kinds.map(String) : [];
  const only = Array.isArray(body.paths) ? body.paths.map(String) : null;
  const group = String(body.group || '未分组');
  if (!kinds.length) { const e = new Error('没说修哪一类问题'); e.status = 400; throw e; }

  const report = [];
  const archiveDir = archiveDirInP(settings);

  /* ① 扁平写法 → 归到「文档」分组 */
  if (kinds.includes('flat-manifest')) {
    const flat = Object.entries(sk).filter(([, v]) => typeof v === 'string');
    if (flat.length) {
      sk['文档'] = sk['文档'] || {};
      for (const [k, v] of flat) { sk['文档'][k] = v; delete sk[k]; }
      report.push(`把 ${flat.length} 条扁平条目归到「文档」分组`);
    }
  }

  /* ② 写法统一成相对 /p */
  if (kinds.includes('prefix-style')) {
    let n = 0;
    for (const g of Object.keys(sk)) {
      for (const [t, p] of Object.entries(sk[g])) {
        if (ASSET_DOC.test(String(p))) continue;
        const norm = normalizePRel(p);
        if (norm !== p) { sk[g][t] = norm; n++; }
      }
    }
    if (n) report.push(`统一了 ${n} 条路径的写法（相对 /p）`);
  }

  /* ③ 清空分组 */
  if (kinds.includes('empty-group')) {
    let n = 0;
    for (const g of Object.keys(sk)) {
      if (!Object.keys(sk[g]).length) { delete sk[g]; n++; }
    }
    if (n) report.push(`删掉 ${n} 个空分组`);
  }

  /* ④ 归档标题补「（归档）」 */
  if (kinds.includes('archive-suffix')) {
    let n = 0;
    for (const g of Object.keys(sk)) {
      const next = {};
      for (const [t, p] of Object.entries(sk[g])) {
        const isArchive = String(p).replace(/^p[/\\]/, '').startsWith(archiveDir + '/');
        if (isArchive && !/（归档）\s*$/.test(t)) { next[t + '（归档）'] = p; n++; }
        else next[t] = p;
      }
      sk[g] = next;
    }
    if (n) report.push(`给 ${n} 条归档条目补了「（归档）」后缀`);
  }

  /* ⑤ 失效 / 重复登记：只处理点名的那几条路径（删掉这些路径上的全部登记） */
  const removalKinds = ['duplicate-path', 'missing-file', 'archive-missing', 'outside-p'];
  if (only && only.length && kinds.some((k) => removalKinds.includes(k))) {
    const wanted = new Set(only.map((p) => normalizePRel(p)).filter(Boolean));
    let n = 0;
    for (const g of Object.keys(sk)) {
      for (const [t, p] of Object.entries(sk[g])) {
        if (!wanted.has(normalizePRel(p))) continue;
        const r = resolveRegistered(p);
        const gone = !isFile(r.abs);
        /* 文件没了 → 直接删；只是重复 → 也删（重复项由界面点名，保留哪条由人决定） */
        if (gone || kinds.includes('duplicate-path')) { delete sk[g][t]; n++; }
      }
      if (!Object.keys(sk[g]).length) delete sk[g];
    }
    if (n) report.push(`移除了 ${n} 条点名的问题条目`);
  }

  /* ⑥ 登记未登记的文件 */
  if (kinds.includes('unregistered') && only && only.length) {
    const scan = scanP(settings, sk);
    let n = 0;
    for (const p of only) {
      const a = scan.articles.find((x) => x.path === p);
      if (!a || a.status !== 'unpublished') continue;
      const g = group || '未分组';
      if (!sk[g]) sk[g] = {};
      let t = a.title || p;
      let i = 2;
      while (t in sk[g]) t = `${a.title}-${i++}`;
      sk[g][t] = p;
      n++;
    }
    if (n) report.push(`登记了 ${n} 个文件到「${group || '未分组'}」`);
  }

  /* ⑦ 归档产物补登记 */
  if (kinds.includes('orphan-archive') && only && only.length) {
    let n = 0;
    for (const p of only) {
      const r = resolveRegistered(p);
      if (!isFile(r.abs)) continue;
      const g = group || '未分组';
      if (!sk[g]) sk[g] = {};
      const base = path.basename(r.rel).replace(/\.[^.]+$/, '');
      let t = base + '（归档）';
      let i = 2;
      while (t in sk[g]) t = `${base}-${i++}（归档）`;
      sk[g][t] = r.rel;
      n++;
    }
    if (n) report.push(`登记了 ${n} 个归档产物到「${group || '未分组'}」`);
  }

  const backup = backupFile(file);
  saveSk(settings, sk, indent);
  return { ok: true, report, backup: backup ? path.basename(backup) : null, ...getManifest() };
}

