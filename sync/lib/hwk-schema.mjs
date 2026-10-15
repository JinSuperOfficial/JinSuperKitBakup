/**
 * 作业数据的**纯规则**（唯一来源）
 * ---------------------------------------------------
 * 这些函数原先只住在 console/lib/hwk.mjs 里。桌面版的「作业编辑器」
 * 要在学校那台机器上（没有仓库、没有控制台）离线录作业，用的必须是
 * 同一套规则：id 怎么生成、日期怎么归一、科目怎么排、键序怎么定。
 * 所以纯逻辑抽到这里，两边都 import 这一份，绝不各写一套。
 *
 * 这里**不碰文件系统**：路径、读写留在调用方（console/lib/hwk.mjs 写仓库，
 * desktop/src/hwk-store.js 写 userData）。
 *
 * 数据形状（和 `class/data/hwk/` 完全一致）：
 *   hwk-<id>.json   { id, date, title, bg:{value}, "语文": "…", "笔记": "…" }
 *   index.json      [{ id, name, date, title }, …]  日期倒序
 */

/* ═══════════════════════════════════════════════════
   常量
   ═══════════════════════════════════════════════════ */

/** id 会变成文件名，所以只放 ASCII：没中文、没空格、没路径分隔符 */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;

/**
 * 记录里的保留字。**必须和页面 `homework.html` 的 `INLINE_RESERVED` 对齐**：
 * 页面把「不在这个表里的顶层键」一律当科目画成一行，多一个保留字就多一行假科目，
 * 少一个科目就被吞掉。
 */
export const RESERVED = [
  'id', 'date', 'title', 'bg', 'name', 'file',
  'subjects', 'notesId', 'eggId', 'homework', 'notes', 'egg', '彩蛋',
];

/** 笔记与彩蛋是记录里的特殊键（笔记：页面底部那块；彩蛋：竖排字） */
export const NOTES_KEY = '笔记';
export const EGG_KEY = '彩蛋';

/** 页面认得的背景档位（认不出的值页面会退回默认，所以这里只提醒、不拦） */
export const BG_KNOWN = [
  'default', 'auto', '随机', 'game-mc', 'game-ut', 'egg',
  'bg_grid', 'bg_ink', 'bg_map', 'bg_botanical',
];

/** 面板/终端预填的科目清单（只是提示，写进去的以用户填的为准） */
export const DEFAULT_SUBJECTS = ['语文', '数学', '英语', '科学', '社会', '班务'];

export const INDENT = '\t';
export const MAX_TEXT = 20000;

/* ═══════════════════════════════════════════════════
   小工具
   ═══════════════════════════════════════════════════ */

export const nameFor = (id) => 'hwk-' + id + '.json';

/** 带状态码的错误（控制台的 API 层靠它决定回 400 还是 500） */
export function hwkError(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

/** 写 JSON：制表符缩进 + 一个换行，和现有那几个文件逐字节一致 */
export const dumpJson = (data) => JSON.stringify(data, null, INDENT) + '\n';

/** 手写的 JSON 常有多余逗号，跟页面 `parseLooseJson()` 一个口径 */
export function parseLoose(text) {
  return JSON.parse(String(text).replace(/,\s*([}\]])/g, '$1'));
}

export const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/* ═══════════════════════════════════════════════════
   日期 / id
   ═══════════════════════════════════════════════════ */

/** `2026-10-10` / `2026/10/10` / `2026.10.10` → `2026-10-10`；不认识就返回 '' */
export function normalizeDate(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m) return '';
  const [, y, mo, d] = m;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const dt = new Date(`${y}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  /* Date 会把 2 月 31 日滚到 3 月，滚过的就当写错了 */
  if (dt.getFullYear() !== Number(y) || dt.getMonth() + 1 !== Number(mm) || dt.getDate() !== Number(dd)) return '';
  return `${y}-${mm}-${dd}`;
}

/** 日期 → 默认 id：2026-10-11 → n261011（沿用现有那份 `n261010` 的命名） */
export function idFromDate(date) {
  const d = normalizeDate(date);
  if (!d) return '';
  return 'n' + d.slice(2).replace(/-/g, '');
}

/** id → 日期：n261011 → 2026-10-11（只认这个形状，认不出返回 ''） */
export function dateFromId(id) {
  const m = /^n(\d{2})(\d{2})(\d{2})$/.exec(String(id || ''));
  if (!m) return '';
  return normalizeDate(`20${m[1]}-${m[2]}-${m[3]}`);
}

/** 今天（本地时区）→ 2026-10-11 */
export function todayOf(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ═══════════════════════════════════════════════════
   目录条目
   ═══════════════════════════════════════════════════ */

/** 一条目录记录 → 归一（只要能拼出文件名就算数） */
export function normalizeEntry(raw) {
  const e = (raw && typeof raw === 'object') ? raw : { name: raw };
  const name = String(e.name || '').trim();
  const id = String(e.id || name.replace(/^hwk-/, '').replace(/\.json$/, '')).trim();
  if (!id) return null;
  return {
    id,
    name: name || nameFor(id),
    date: normalizeDate(e.date) || dateFromId(id),
    title: String(e.title || ''),
  };
}

export const byDateDesc = (a, b) =>
  String(b.date || '').localeCompare(String(a.date || '')) || String(a.id).localeCompare(String(b.id));

/** 目录里顶上一条：日期倒序，同一天按 id 倒序（页面 normalizeIndex() 同一条规则） */
export function mergeIndex(list, entry) {
  const rest = (Array.isArray(list) ? list : []).map(normalizeEntry).filter(Boolean).filter((e) => e.id !== entry.id);
  return [entry, ...rest].sort((a, b) =>
    String(b.date || b.id).localeCompare(String(a.date || a.id)) ||
    String(b.id).localeCompare(String(a.id)));
}

/* ═══════════════════════════════════════════════════
   归一：表单 / JSON 源码 → 一条记录
   ═══════════════════════════════════════════════════ */

/** 表单里的科目：数组 [{name,text}] 或对象 {name: text} 都收 */
function subjectsFromInput(input) {
  const out = [];
  const push = (name, text) => {
    const n = String(name == null ? '' : name).trim();
    if (!n || isBlank(text)) return;
    out.push([n, String(text)]);
  };
  const src = input.subjects;
  if (Array.isArray(src)) src.forEach((s) => push(s && s.name, s && s.text));
  else if (src && typeof src === 'object') Object.entries(src).forEach(([k, v]) => push(k, v));
  return out;
}

/**
 * 输入 → { record, meta }
 * ---------------------------------------------------
 * `record` 就是最终要写进 `hwk-<id>.json` 的对象（键序：id/date/title/bg/各科/笔记/彩蛋）。
 * 校验不通过时抛 400，把**所有**问题一次说完，别让人改一条报一条。
 */
export function normalizeInput(input = {}) {
  const mode = input.mode === 'json' ? 'json' : 'form';
  const problems = [];
  let raw = {};

  if (mode === 'json') {
    const text = String(input.source == null ? '' : input.source).trim();
    if (!text) throw hwkError('JSON 源码是空的');
    try {
      raw = parseLoose(text);
    } catch (e) {
      throw hwkError('JSON 解析不了：' + e.message);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw hwkError('JSON 顶层得是一个对象');
  }

  /* ── 日期：表单优先，其次记录里的，最后拿 id 反推；一路都没给就默认今天 ── */
  let date = normalizeDate(input.date) || normalizeDate(raw.date);
  const idGiven = String(input.id || raw.id || '').trim();
  if (!date && idGiven) date = dateFromId(idGiven);
  if (!date) {
    if (isBlank(input.date) && isBlank(raw.date) && !idGiven) date = todayOf();
    else problems.push('日期要写成 2026-10-11 这样（也可以用 / 或 . 分隔）');
  }

  /* ── id ── */
  const id = String(input.id || raw.id || (date ? idFromDate(date) : '')).trim();
  if (!id) problems.push('缺 id（留空的话按日期自动生成，形如 n261011）');
  else if (!ID_RE.test(id)) problems.push(`id「${id}」不能当文件名：只用字母数字和 . _ -，别用中文/空格/斜杠`);

  /* ── 标题 ── */
  const title = String(input.title || raw.title || (date ? '作业-' + date.replace(/-/g, '') : '')).trim();
  if (!title) problems.push('标题不能空');
  if (title.length > 120) problems.push('标题太长了（>120 字）');

  /* ── 正文：JSON 模式下顶层非保留键就是科目 ── */
  const subjects = [];
  if (mode === 'json') {
    Object.keys(raw).forEach((k) => {
      if (RESERVED.includes(k) || k === NOTES_KEY) return;
      if (k.slice(0, 2) === '__') return;               /* 内部记账键 */
      if (isBlank(raw[k])) return;
      if (typeof raw[k] !== 'string') { problems.push(`科目「${k}」的正文得是字符串`); return; }
      subjects.push([k, raw[k]]);
    });
  }
  subjectsFromInput(input).forEach(([n, t]) => {
    if (RESERVED.includes(n) || n === NOTES_KEY) { problems.push(`「${n}」是保留字，不能当科目名`); return; }
    const at = subjects.findIndex(([x]) => x === n);
    if (at >= 0) subjects[at][1] = t; else subjects.push([n, t]);
  });

  const notes = !isBlank(input.notes) ? String(input.notes)
    : (!isBlank(raw[NOTES_KEY]) ? String(raw[NOTES_KEY]) : '');
  const egg = !isBlank(input.egg) ? String(input.egg)
    : (!isBlank(raw[EGG_KEY]) ? String(raw[EGG_KEY]) : '');

  for (const [n, t] of subjects) {
    if (n.length > 20) problems.push(`科目名太长了：「${n}」`);
    if (t.length > MAX_TEXT) problems.push(`「${n}」的正文太长了（>${MAX_TEXT} 字）`);
  }
  if (notes.length > MAX_TEXT) problems.push(`笔记太长了（>${MAX_TEXT} 字）`);
  if (!subjects.length && !notes) problems.push('一个科目都没填（至少写一科，或者写笔记）');

  /* ── 背景 ── */
  const bgRaw = !isBlank(input.bg) ? input.bg : raw.bg;
  let bgValue = 'default';
  const notesOut = [];
  if (bgRaw !== null && bgRaw !== undefined && !isBlank(bgRaw)) {
    bgValue = typeof bgRaw === 'object'
      ? String(bgRaw.value !== undefined ? bgRaw.value : (bgRaw.slug !== undefined ? bgRaw.slug : ''))
      : String(bgRaw);
    bgValue = bgValue.trim() || 'default';
    if (!BG_KNOWN.includes(bgValue)) {
      notesOut.push(`背景「${bgValue}」页面不认识，会按默认处理（认得的：${BG_KNOWN.join(' / ')}）`);
    }
  }

  if (problems.length) throw hwkError(problems.join('；'));

  /* 键序固定：id / date / title / bg / 各科 / 笔记 / 彩蛋 —— 和现有那份一样，diff 才干净 */
  const record = { id, date, title, bg: { value: bgValue } };
  for (const [n, t] of subjects) record[n] = t;
  if (notes) record[NOTES_KEY] = notes;
  if (egg) record[EGG_KEY] = egg;

  return {
    record,
    meta: { mode, id, date, title, bg: bgValue, subjects: subjects.map(([n]) => n), hasNotes: !!notes, hasEgg: !!egg },
    notes: notesOut,
    extra: raw,   /* JSON 模式下多出来的保留字（subjects/notesId/eggId…）——提示用 */
  };
}

/**
 * 一条记录 → 表单能回填的形状（桌面版作业编辑器编辑已有那天时用）。
 * 只认页面那套口径：非保留键 = 科目，顺序保持文件里的原样。
 */
export function recordToForm(record) {
  const r = (record && typeof record === 'object') ? record : {};
  const subjects = Object.keys(r)
    .filter((k) => !RESERVED.includes(k) && k !== NOTES_KEY)
    .map((k) => ({ name: k, text: String(r[k] == null ? '' : r[k]) }));
  return {
    id: String(r.id || ''),
    date: normalizeDate(r.date) || dateFromId(r.id),
    title: String(r.title || ''),
    bg: (r.bg && typeof r.bg === 'object') ? String(r.bg.value || 'default') : String(r.bg || 'default'),
    subjects,
    notes: String(r[NOTES_KEY] || ''),
    egg: String(r[EGG_KEY] || ''),
  };
}
