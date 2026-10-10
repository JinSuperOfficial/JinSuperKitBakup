#!/usr/bin/env node
/**
 * 迁移：一天一个大文件 → 一天一个小文件
 * ---------------------------------------------------------------------------
 * 原来作业页一次性读 `class/data/homework.json`（所有数据堆一起）。现在改成
 * `class/data/hwk/hwk-<id>.json` —— **一天一个文件，科目正文直接写在里面**：
 *
 *   class/data/hwk/hwk-<id>.json     当天记录：
 *                                     id / date / title / bg + 各科正文（"语文": "…"）+ "笔记"
 *   class/data/hwk/index.json        目录：所有 hwk-*.json 的列表（**裸数组**，新的在前）
 *
 * 科目就是顶层键（和老的 homework.json 一样），所以：
 *   · 加一天 = 加一个 `hwk-<id>.json`，再把它登记进 index.json（或再跑一次本脚本重建索引）
 *   · 想合并回去也简单：把几个文件的键并回一个 homework.json 就行
 *
 * 将来若想把某段内容抽成「多天共用的一份」，可以在记录里写
 * `subjects: {语文: "<id>"}` / `notesId` / `eggId` 指向同目录的 `<id>.json` 内容片 ——
 * 页面两条路都认（见 homework.html 的 loadHwkNew）。
 *
 * 幂等：已存在的 `hwk-<id>.json` 默认**不覆盖**（要覆盖加 --force）；
 * index.json 每次按目录实际内容重建；旧 homework.json 默认**保留**（--prune-old 才改名成 .bak）。
 *
 * 用法：
 *   node build/migrate-hwk.mjs                     # 默认：读 class/data/homework.json → 写 class/data/hwk/
 *   node build/migrate-hwk.mjs --dry-run           # 只打印计划，一个字节都不写
 *   node build/migrate-hwk.mjs --force             # 覆盖已存在的 hwk-<id>.json
 *   node build/migrate-hwk.mjs --prune-old         # 迁移完把 homework.json 改名成 .bak
 *   node build/migrate-hwk.mjs --in <文件> --out <目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const SITE = path.join(PROJECT, 'jinsuper.rth1.xyz');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const IN_FILE = path.resolve(opt('in',  path.join(SITE, 'class/data/homework.json')));
const OUT_DIR = path.resolve(opt('out', path.join(SITE, 'class/data/hwk')));
const DRY     = flag('dry-run');
const FORCE   = flag('force');
const PRUNE   = flag('prune-old');

/* ---------- 小工具 ---------- */

/** 和页面一样宽容：手写的 JSON 常有多余的逗号 */
function parseLoose(text) {
  return JSON.parse(String(text).replace(/,\s*([}\]])/g, '$1'));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 'n20261010' / '2026-10-10' / '作业-n20261010' → '2026-10-10'；认不出返回 null */
function toISODate(v) {
  const s = String(v == null ? '' : v);
  let m = s.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) m = s.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [y, mo, d] = [m[1], String(m[2]).padStart(2, '0'), String(m[3]).padStart(2, '0')];
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** 文件名安全：只留 [A-Za-z0-9._-]，其余换成短哈希（作业 id 一般已经是 n261010 这种） */
function safeId(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (/^[A-Za-z0-9._-]{1,64}$/.test(s)) return s;
  return 'x' + fnv1a(s);
}

const textOf = (v) => (Array.isArray(v) ? v.join('\n') : String(v));

function readJson(file) { return parseLoose(fs.readFileSync(file, 'utf8')); }
function write(file, data) {
  if (DRY) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n', 'utf8');
  return true;
}

/* ---------- 1. 读旧文件 ---------- */

if (!fs.existsSync(IN_FILE)) {
  console.error('找不到旧数据文件：' + IN_FILE);
  console.error('（用 --in <文件> 指定；默认找 class/data/homework.json）');
  process.exit(1);
}
const old = readJson(IN_FILE);
const mtime = fs.statSync(IN_FILE).mtimeMs;

/* 元数据用保留字；剩下的顶层键全是科目 */
const RESERVED = new Set(['title', 'id', 'bg', 'date', 'homework', '笔记', 'notes', 'egg', '彩蛋']);

const date = toISODate(old.title) || toISODate(old.id) || new Date(mtime).toISOString().slice(0, 10);
const id = safeId(old.id) || date;
const title = (old.title == null || String(old.title).trim() === '') ? (date + ' 作业') : String(old.title).trim();

/* 当天记录：id / date / title / bg + 各科正文 + 笔记（顺序就是老文件里的顺序） */
const record = { id, date, title, bg: { value: old.bg === undefined ? 'default' : old.bg } };
const subjectNames = [];
for (const key of Object.keys(old)) {
  if (RESERVED.has(key)) continue;
  const raw = old[key];
  if (raw === null || raw === undefined) continue;
  const text = textOf(raw);
  if (text.trim() === '') continue;
  record[key] = text;
  subjectNames.push(key);
}
const noteRaw = old['笔记'] !== undefined ? old['笔记'] : old['notes'];
if (noteRaw !== null && noteRaw !== undefined && textOf(noteRaw).trim() !== '') record['笔记'] = textOf(noteRaw);
const eggRaw = old['彩蛋'] !== undefined ? old['彩蛋'] : old['egg'];
if (eggRaw !== null && eggRaw !== undefined && textOf(eggRaw).trim() !== '') record['彩蛋'] = textOf(eggRaw);

const recordFile = 'hwk-' + id + '.json';

/* ---------- 2. 落盘 ---------- */

const report = { record: 'skip', cleaned: [], index: 0 };
fs.mkdirSync(OUT_DIR, { recursive: true });

const recordPath = path.join(OUT_DIR, recordFile);
const existed = fs.existsSync(recordPath);
if (existed && !FORCE) {
  report.record = 'exists';
} else {
  write(recordPath, record);
  report.record = DRY ? 'dry' : 'created';
}

/* index.json：每次按目录实际内容重建（裸数组，新的在前）—— 幂等 */
const hwkFiles = fs.readdirSync(OUT_DIR).filter((n) => /^hwk-.+\.json$/.test(n));
const entries = hwkFiles.map((name) => {
  let one = {};
  try { one = readJson(path.join(OUT_DIR, name)); } catch (e) { /* 坏文件也列出来，别漏项 */ }
  return {
    id: String(one.id || name.replace(/^hwk-/, '').replace(/\.json$/, '')),
    name,
    date: one.date || '',
    title: one.title || ''
  };
}).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
write(path.join(OUT_DIR, 'index.json'), entries);
report.index = entries.length;

/* 收拾旧版留下的内容片（hwc-*.json）：现在科目都写在当天文件里了，
   没有任何记录再引用它们 —— 原文都在 homework.json 备份里，删掉不丢东西。 */
const referenced = new Set();
for (const name of hwkFiles) {
  let one = {};
  try { one = readJson(path.join(OUT_DIR, name)); } catch (e) { continue; }
  Object.values(one.subjects || {}).forEach((v) => referenced.add(v));
  [one.notesId, one.eggId].forEach((v) => { if (v) referenced.add(v); });
}
for (const name of fs.readdirSync(OUT_DIR).filter((n) => /^hwc-.+\.json$/.test(n))) {
  if (referenced.has(name.replace(/\.json$/, ''))) continue;
  if (!DRY) fs.rmSync(path.join(OUT_DIR, name));
  report.cleaned.push(name);
}

if (PRUNE && !DRY) {
  const bak = IN_FILE.replace(/\.json$/, '') + '.json.bak';
  if (!fs.existsSync(bak)) fs.renameSync(IN_FILE, bak);
  report.pruned = path.basename(bak);
}

/* ---------- 3. 报账 ---------- */

const rel = (p) => path.relative(PROJECT, p);
console.log((DRY ? '（dry-run，什么都没写）\n' : '') + '读：' + rel(IN_FILE));
console.log('写：' + rel(OUT_DIR));
console.log('  当天记录 ' + recordFile + ' → ' + report.record + (FORCE ? '（--force）' : ''));
console.log('  正文直接写在记录里：' + subjectNames.length + ' 科' +
  (record['笔记'] ? ' + 笔记' : '') + (record['彩蛋'] ? ' + 彩蛋' : ''));
console.log('  index.json 重建：' + report.index + ' 条（新的在前）');
if (report.cleaned.length) console.log('  清掉旧版内容片 ' + report.cleaned.length + ' 个：' + report.cleaned.join(', '));
if (report.pruned) console.log('  旧文件已改名：' + report.pruned);
else console.log('  旧文件保留：' + rel(IN_FILE) + '（备份；要收起来加 --prune-old）');
console.log('\n科目：' + subjectNames.join(' / '));
