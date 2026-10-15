/**
 * 作业数据（`class/data/hwk/`）：读、写、归档
 * ---------------------------------------------------
 * 作业页从 2026-10 起是「一天一个文件」：
 *
 *   class/data/hwk/
 *   ├── index.json        目录（裸数组，新的在前）—— 页面拿第一条当「今天这份」
 *   └── hwk-<id>.json     当天记录：id / date / title / bg + 各科正文（"语文": "…"）+ 笔记
 *
 * 这个模块是**控制台里写这份数据的唯一实现**（网页面板与终端入口共用）：
 *
 *   1. **写一天** = 写 `hwk-<id>.json` + 把这条顶到 `index.json` 最前
 *      （排序按 date 倒序；原来那天仍在目录里，就是「历史」）。
 *   2. **同一天写第二次**先把旧文件复制到 `stateDir/backups/<时间戳>/`
 *      —— 备份**不落在站点目录里**：站点目录里的任何文件都会被 prep-deploy
 *      镜像进 dist 再传上线（store.mjs 里 readJsonSafe 的注释也写着同一件事）。
 *   3. **旧的大文件 `class/data/homework.json`** 如果还有没进 hwk/ 的内容，
 *      写入前先按 `hwk-<id>.json` 的格式补进历史，再写新的（不会覆盖它）。
 *   4. **写完顺手生成清单**：`hwk/index.json`（目录）+ `class/data/index-produce.json`
 *      （生产清单：目录 + 最近 5 天正文，给 CDN 兜底读），并刷新生成物
 *      `docs/info/site-index.js` / `sitemap.xml` —— 新文件会出现在目录树里，
 *      不刷新的话 `verify-manifests.mjs --check` 会报「生成物与现场不一致」。
 *      两个清单的实际实现都在 `build/lib/hwk-index.mjs`（GitHub Actions 里跑的
 *      也是它的一份拷贝），这里只是调用，不重写一遍。
 *
 * 两种输入都收：
 *   · 表单：{ id, date, title, bg, subjects, notes, egg }
 *   · JSON 源码：{ source: '<原文>' } —— 直接把一份记录粘进来
 *
 * 科目顺序、正文一个字都不动：页面 `toList()` 按 `\n` 自己拆行。
 * id 也不要随手换：勾选状态存在 localStorage，键是 `hw:<id>:<条目哈希>`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { exists, isFile, siteRoot, workspaceRoot } from './paths.mjs';
import { backupToState, readJsonSafe, writeAtomic } from './store.mjs';
/* 纯规则只有一份，住在 sync/lib/hwk-schema.mjs —— 桌面版的「作业编辑器」
   （在学校那台机器上离线录作业）用的也是它，所以两边写出来的文件一模一样。
   这里只保留「往仓库里读写」的那部分。 */
import {
  ID_RE, RESERVED, NOTES_KEY, EGG_KEY, BG_KNOWN, DEFAULT_SUBJECTS,
  nameFor, dumpJson, parseLoose, isBlank,
  normalizeDate, idFromDate, dateFromId, todayOf,
  normalizeEntry, mergeIndex, normalizeInput,
} from '../../sync/lib/hwk-schema.mjs';

/* 再转出去：控制台里别处一直是从本模块 import 这些名字的（外部接口不变） */
export {
  ID_RE, RESERVED, NOTES_KEY, EGG_KEY, BG_KNOWN, DEFAULT_SUBJECTS,
  nameFor, normalizeDate, idFromDate, dateFromId, normalizeInput,
};

/* ═══════════════════════════════════════════════════
   位置与常量
   ═══════════════════════════════════════════════════ */

/** 数据目录（站点相对路径 / 磁盘绝对路径） */
export const HWK_REL = 'class/data/hwk';
export const HWK_DIR = path.join(siteRoot, 'class', 'data', 'hwk');
export const INDEX_FILE = path.join(HWK_DIR, 'index.json');
export const INDEX_REL = HWK_REL + '/index.json';

/** 构建时生成的「生产清单」：目录 + 最近几天的正文（CI 与本地同一个脚本出） */
export const PRODUCE_REL = 'class/data/index-produce.json';
export const PRODUCE_FILE = path.join(siteRoot, 'class', 'data', 'index-produce.json');

/** 迁移前的老文件：只读它、只往里补历史，不从它读「今天」 */
export const LEGACY_FILE = path.join(siteRoot, 'class', 'data', 'homework.json');

const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

/* ═══════════════════════════════════════════════════
   小工具
   ═══════════════════════════════════════════════════ */

export const fileFor = (id) => path.join(HWK_DIR, nameFor(id));

/** 站点相对路径（给前端的 href 用；Windows 上也要是正斜杠） */
export const relFor = (id) => HWK_REL + '/' + nameFor(id);

/* ═══════════════════════════════════════════════════
   读
   ═══════════════════════════════════════════════════ */

/** 读 index.json：裸数组或 `{entries: […]}` 都认 */
function readIndexRaw() {
  const data = readJsonSafe(INDEX_FILE, { fallback: [] });
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : null);
  if (!list) throw err('index.json 不是数组（应该是裸数组或 { entries: […] }）', 500);
  return list;
}

const byDateDesc = (a, b) =>
  String(b.date || '').localeCompare(String(a.date || '')) || String(a.id).localeCompare(String(b.id));

/**
 * 现状：目录里的条目 + 磁盘实况 + 老文件
 * ---------------------------------------------------
 * 面板右侧那个列表、终端 `--list` 都用它。只读，不改任何东西。
 */
export function listRecords() {
  const entries = readIndexRaw().map(normalizeEntry).filter(Boolean);
  const onDisk = exists(HWK_DIR)
    ? fs.readdirSync(HWK_DIR).filter((n) => /^hwk-.+\.json$/.test(n)).sort()
    : [];

  const records = entries.map((e) => {
    const file = fileFor(e.id);
    const there = isFile(file);
    return {
      ...e,
      file,
      rel: relFor(e.id),
      exists: there,
      bytes: there ? fs.statSync(file).size : 0,
    };
  }).sort(byDateDesc);

  /* 盘上有、目录里没有的文件：页面看不到它们（页面认 index.json），列出来提醒 */
  const known = new Set(entries.map((e) => e.name));
  const orphans = onDisk.filter((n) => !known.has(n)).map((n) => {
    const id = n.replace(/^hwk-/, '').replace(/\.json$/, '');
    return { id, name: n, rel: relFor(id), bytes: fs.statSync(path.join(HWK_DIR, n)).size };
  });

  const missing = records.filter((r) => !r.exists).map((r) => r.name);

  return {
    dir: HWK_DIR,
    dirRel: HWK_REL,
    indexFile: INDEX_FILE,
    indexRel: INDEX_REL,
    produceFile: PRODUCE_FILE,
    produceRel: PRODUCE_REL,
    produceExists: isFile(PRODUCE_FILE),
    records,
    orphans,
    missing,
    legacy: legacyInfo(),
    defaultSubjects: DEFAULT_SUBJECTS,
    bgKnown: BG_KNOWN,
    today: todayOf(),
  };
}

/** 老的大文件还在不在、里面是哪一份（用来决定写之前要不要先补进历史） */
export function legacyInfo() {
  if (!isFile(LEGACY_FILE)) return null;
  let data = null;
  try { data = parseLoose(fs.readFileSync(LEGACY_FILE, 'utf8')); } catch { /* 坏了就只报存在 */ }
  const id = data && data.id ? String(data.id) : '';
  return {
    file: LEGACY_FILE,
    rel: 'class/data/homework.json',
    bytes: fs.statSync(LEGACY_FILE).size,
    id,
    date: normalizeDate(data && data.date) || dateFromId(id),
    subjects: data && typeof data === 'object'
      ? Object.keys(data).filter((k) => !RESERVED.includes(k) && k !== NOTES_KEY)
      : [],
  };
}

/** 读某一天的记录（面板「以这份为底稿」用） */
export function readRecord(id) {
  const key = String(id || '').trim();
  if (!ID_RE.test(key)) throw err('id 不合法：' + key);
  const file = fileFor(key);
  if (!isFile(file)) throw err('没有这一天：' + nameFor(key), 404);
  const data = parseLoose(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw err(nameFor(key) + ' 不是对象', 500);
  return { id: key, name: nameFor(key), rel: relFor(key), record: data, source: dumpJson(data) };
}

/* ═══════════════════════════════════════════════════
   写（归一的规则在 sync/lib/hwk-schema.mjs，这里只管往仓库里落）
   ═══════════════════════════════════════════════════ */

/**
 * 写入作业
 * ---------------------------------------------------
 * @param {object} input  见 normalizeInput()，另加：
 *   · dryRun  只算不写（面板的「预览」、终端的 --dry-run）
 *   · adoptLegacy  默认 true：老的大文件里那份还没进 hwk/ 就先补进历史
 * @returns {Promise<object>} 写完之后的样子（面板拿去画提示）
 */
export async function saveHomework(input = {}) {
  const dryRun = !!input.dryRun;
  const parsed = normalizeInput(input);
  const { record, meta } = parsed;
  const notes = [...parsed.notes];

  const file = fileFor(record.id);
  const existed = isFile(file);
  const indexBefore = readIndexRaw().map(normalizeEntry).filter(Boolean);
  const knownIds = new Set(indexBefore.map((e) => e.id));

  const archived = [];    /* 自动补进历史的老内容 */
  const backups = [];     /* 同一天被覆盖的旧版本 */
  const written = [];

  /* ── ① 老的大文件里那份还没进 hwk/ → 先按格式补进历史 ── */
  const legacy = input.adoptLegacy === false ? null : legacyInfo();
  if (legacy && legacy.id && !knownIds.has(legacy.id) && legacy.id !== record.id) {
    if (!ID_RE.test(legacy.id)) {
      notes.push(`旧文件 homework.json 里的 id「${legacy.id}」不能当文件名，没敢自动补进历史`);
    } else if (!legacy.date) {
      notes.push(`旧文件 homework.json 里有「${legacy.id}」，但认不出日期，没敢自动补进历史（手动补一份 hwk-${legacy.id}.json 就行）`);
    } else {
      const lf = fileFor(legacy.id);
      let lrec = null;
      try {
        lrec = normalizeInput({
          mode: 'json',
          source: fs.readFileSync(LEGACY_FILE, 'utf8'),
          id: legacy.id,
          date: legacy.date,
        }).record;
      } catch (e) {
        notes.push(`旧文件 homework.json 里的「${legacy.id}」没能自动补进历史：${e.message}`);
      }
      if (lrec) {
        if (!dryRun) {
          if (isFile(lf)) backups.push(backupToState(lf));
          writeAtomic(lf, dumpJson(lrec));
          written.push(relFor(legacy.id));
        }
        archived.push({ id: legacy.id, name: nameFor(legacy.id), date: legacy.date, title: lrec.title });
      }
    }
  }

  /* ── ② 同一天写第二次：旧版本先存一份（备份不进站点目录） ── */
  if (existed && !dryRun) backups.push(backupToState(file));

  /* ── ③ 写当天记录 ── */
  if (!dryRun) {
    writeAtomic(file, dumpJson(record));
    written.push(relFor(record.id));
  }

  /* ── ④ 目录：这条顶上去（按日期倒序，同一天新的在前） ── */
  const entry = {
    id: record.id,
    name: nameFor(record.id),
    date: record.date,
    title: record.title,
  };
  const indexAfter = mergeIndex(indexBefore, entry);
  if (!dryRun) {
    const same = JSON.stringify(indexAfter) === JSON.stringify(indexBefore);
    if (!same) writeAtomic(INDEX_FILE, dumpJson(indexAfter));
  }

  /* ── ⑤ 清单（index.json + index-produce.json）与生成物 ──
     能调生成器就用它：本地清单和「生产清单」一次对齐（同一个脚本，
     GitHub Actions 里跑的就是它的拷贝）。调不到（测试环境没有 build/）
     就退回上面自己合并出来的 index.json —— 规则一样，字节也一样。 */
  let manifests = { skipped: true, reason: 'dry-run' };
  if (!dryRun) {
    manifests = await rebuildManifests();
    if (manifests.skipped) {
      if (written.indexOf(INDEX_REL) < 0) written.push(INDEX_REL);
      notes.push('清单生成器没跑成（' + manifests.reason + '）：只写了 index.json，index-produce.json 没更新');
    } else {
      written.push(...manifests.changed);
      for (const p of manifests.problems || []) notes.push('清单生成器：' + p);
    }
  }

  /* 目录的**最终**样子：生成器跑成了就以它扫出来的为准（它会顺手把上面
     自动补进历史的那些老内容一起收进目录，也可能丢掉「目录里有、文件没了」的条目）。 */
  const indexFinal = (!manifests.skipped && Array.isArray(manifests.entries)) ? manifests.entries : indexAfter;
  const isFirst = !!indexFinal[0] && indexFinal[0].id === record.id;

  return {
    ok: true,
    dryRun,
    id: record.id,
    name: nameFor(record.id),
    rel: relFor(record.id),
    date: record.date,
    title: record.title,
    meta,
    replaced: existed,
    backups,
    archived,
    written: written.filter((v, i) => written.indexOf(v) === i),
    index: indexFinal,
    indexCount: indexFinal.length,
    isFirst,
    manifests,
    generated: manifests && manifests.generated ? manifests.generated : null,
    notes,
  };
}

/* ═══════════════════════════════════════════════════
   清单与生成物
   ═══════════════════════════════════════════════════ */

/**
 * 生成器（`build/lib/hwk-index.mjs`）
 * ---------------------------------------------------
 * 动态 import：控制台得能在「半成品站点」上跑，缺这个文件也只是少一项功能。
 * 测试环境（`DSH_CONSOLE_ROOT`）照样能 import —— 它只碰传进去的那个站点根。
 */
async function loadIndexTool() {
  const mod = path.join(workspaceRoot, 'build', 'lib', 'hwk-index.mjs');
  if (!isFile(mod)) return null;
  try {
    return await import(pathToFileURL(mod).href);
  } catch {
    return null;
  }
}

/**
 * 重写两份清单（`hwk/index.json` + `class/data/index-produce.json`）
 * ---------------------------------------------------
 * 面板上的「重建清单」按钮、每次写入作业之后都走这里 ——
 * 内容和磁盘不一致时，这里说了算（磁盘上的 `hwk-*.json` 是唯一事实）。
 */
export async function rebuildManifests({ preview } = {}) {
  const tool = await loadIndexTool();
  if (!tool) return { skipped: true, reason: '找不到 build/lib/hwk-index.mjs' };
  const res = tool.buildAll(siteRoot, { preview: preview || tool.PREVIEW_COUNT });
  const generated = await refreshGenerated();
  return {
    skipped: false,
    changed: res.changed,
    problems: res.problems,
    count: res.entries.length,
    entries: res.entries,
    generated,
  };
}

/**
 * 刷新生成物（`docs/info/site-index.js` / `sitemap.xml`）
 * ---------------------------------------------------
 * 生成逻辑只有一份，在 `build/lib/site-index.mjs` —— 直接 import，不重写一遍。
 *
 * ⚠️ `build/paths.mjs` **不认** `DSH_CONSOLE_ROOT`（它按自己的位置推站点根），
 * 所以测试跑了这个会去动真站点的生成物。测试环境（设了那个变量）一律跳过。
 */
export async function refreshGenerated() {
  if (process.env.DSH_CONSOLE_ROOT) return { skipped: true, reason: '测试环境（DSH_CONSOLE_ROOT），不碰真生成物' };
  const mod = path.join(workspaceRoot, 'build', 'lib', 'site-index.mjs');
  if (!isFile(mod)) return { skipped: true, reason: '找不到 build/lib/site-index.mjs' };
  try {
    const lib = await import(pathToFileURL(mod).href);
    const { outputs } = lib.checkOutputs();
    const wrote = lib.writeOutputs(outputs);
    return { skipped: false, wrote };
  } catch (e) {
    return { skipped: true, reason: String((e && e.message) || e), stale: ['docs/info/site-index.js', 'sitemap.xml'] };
  }
}
