/**
 * 作业页回归测试：数据读写 + 时光机
 * ---------------------------------------------------------------------------
 * A 段（纯静态）：811 → class 的改名有没有漏；迁移产物（hwk-*.json / hwc-*.json / index.json）
 *                是否齐全、能不能原样拼回旧的 homework.json；迁移脚本幂等
 * B 段（jsdom）：主页在「新结构」和「旧 homework.json 兜底」两种情况下都渲染得一模一样，
 *                勾选键（localStorage 的 key）不能变
 * C 段（jsdom）：时光机三级降级（GitHub API → CDN index.json → 同源）、超时、缓存 5 分钟、
 *                并发 ≤8、50 条分页 + 加载更多、键盘 Esc / 焦点归还、不支持 fetch 时隐藏按钮
 *
 * 跑法：node build/test-homework.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const SITE = path.join(PROJECT, 'jinsuper.rth1.xyz');
const PAGE_REL = 'class/homework.html';
const HWK_REL = 'class/data/hwk';
const HWK_DIR = path.join(SITE, HWK_REL);
const PAGE = path.join(SITE, PAGE_REL);
const HTML = fs.readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0, warn = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.log('  ✗ ' + m); };
const meh = (m) => { warn++; console.log('  ⚠ ' + m); };
const check = (m, cond, extra) => (cond ? ok(m + (extra ? '：' + extra : '')) : bad(m + (extra ? '：' + extra : '')));

/* ── 和页面同款的小工具（用来独立算一遍期望值） ── */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const itemHash = (sub, i, text) => fnv1a('hw1|' + sub + '|' + i + '|' + text);
const looseJson = (t) => JSON.parse(String(t).replace(/,\s*([}\]])/g, '$1'));
const lines = (v) => String(v == null ? '' : v).replace(/\\n/g, '\n').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/* ═══════════════════════ A. 改名与迁移 ═══════════════════════ */
console.log('\n── A1. 811 → class 改名 ──');
check('站点里已经没有 811/ 目录', !fs.existsSync(path.join(SITE, '811')));
check('class/ 目录在', fs.existsSync(path.join(SITE, 'class/index.html')));

const tools = JSON.parse(fs.readFileSync(path.join(SITE, 'class/tools.json'), 'utf8'));
check('清单 collection / root / href 都指向 class',
  tools.collection === 'class' && tools.root === '/class/' &&
  tools.items.every((i) => i.href.startsWith('/class/')),
  tools.collection + ' · ' + tools.root);
const siteJson = JSON.parse(fs.readFileSync(path.join(SITE, 'site.json'), 'utf8'));
check('site.json 的 collections 指向 /class/tools.json',
  siteJson.collections.includes('/class/tools.json') && !siteJson.collections.some((c) => c.includes('/811/')));

/* 全站扫一遍：路径形状的 811 一个都不该剩（历史记录 / 备份目录不算） */
const SKIP_DIRS = new Set(['node_modules', '.git', '.npm-cache', '.deno-cache', 'dist', '.backup-manifest-plan', '.agent', '.agents', '_plot', 'logs', 'old']);
/* 跳过的：历史记录（改不动也不该改）、还有本文件自己（下面的正则里就写着那个路径） */
const SKIP_FILES = new Set(['MANIFEST-PLAN.md', 'jobs.json', '.deploy-changed.txt', 'test-homework.mjs',
  'project.md' /* 交接文档里要留着「老地址 /811/… 会 404」这句说明 */]);
const leftovers = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.tmp-') || ent.name.startsWith('.deploy-logs')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(p); continue; }
    if (SKIP_FILES.has(ent.name)) continue;
    if (!/\.(html|js|mjs|cjs|json|md|css|xml|txt|php)$/i.test(ent.name)) continue;
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    const hits = text.match(/(?<![\w.-])(\/?811[/\\])/g);
    if (hits && !/^asset[/\\]/.test(path.relative(PROJECT, p))) {
      leftovers.push(path.relative(PROJECT, p) + ' ×' + hits.length);
    }
  }
})(PROJECT);
check('全仓没有遗留的 811/ 路径引用（历史日志 / 备份计划不算）', leftovers.length === 0, leftovers.join(', ') || '干净');

console.log('\n── A2. 迁移产物 ──');
const idx = JSON.parse(fs.readFileSync(path.join(HWK_DIR, 'index.json'), 'utf8'));
check('index.json 是裸数组（CDN 回退代码直接 .map 它）', Array.isArray(idx), Array.isArray(idx) ? idx.length + ' 条' : typeof idx);
check('index.json 每条都是 {id, name}，且 name 是 hwk-*.json',
  idx.every((e) => e && typeof e.id === 'string' && /^hwk-.+\.json$/.test(e.name)));
check('新的在前（按 date / id 倒序）',
  idx.every((e, i) => i === 0 ||
    String(idx[i - 1].date || idx[i - 1].id).localeCompare(String(e.date || e.id)) >= 0));

const hwkFiles = fs.readdirSync(HWK_DIR).filter((n) => /^hwk-.+\.json$/.test(n));
check('目录里的 hwk-*.json 数量和 index.json 对得上', hwkFiles.length === idx.length, hwkFiles.length + ' / ' + idx.length);

const NEED = ['id', 'title', 'bg'];
let fieldOK = true, inlineOK = true, pieceOK = true;
for (const name of hwkFiles) {
  const rec = JSON.parse(fs.readFileSync(path.join(HWK_DIR, name), 'utf8'));
  for (const k of NEED) if (!(k in rec)) { fieldOK = false; console.log('    ' + name + ' 缺字段 ' + k); }
  if (!rec.bg || typeof rec.bg !== 'object') fieldOK = false;
  /* 科目内联：至少一科，值是字符串 */
  const inline = Object.keys(rec).filter((k) => !['id', 'date', 'title', 'bg', 'subjects', 'notesId', 'eggId', 'homework', 'notes', 'egg', '彩蛋'].includes(k));
  if (!inline.length || inline.some((k) => typeof rec[k] !== 'string')) inlineOK = false;
  /* 若写了 subjects/notesId/eggId（抽共用片的老写法），指到的文件必须在盘上 */
  const ids = Object.values(rec.subjects || {}).concat([rec.notesId, rec.eggId]).filter((v) => typeof v === 'string');
  for (const id of ids) if (!fs.existsSync(path.join(HWK_DIR, id + '.json'))) { pieceOK = false; console.log('    ' + name + ' 指到不存在的内容片 ' + id); }
}
check('每份 hwk-*.json 都有 id / title / bg（一天一个文件）', fieldOK);
check('科目正文直接写在当天文件里（"语文": "…"）', inlineOK);
check('万一用了 subjects / notesId / eggId，指到的内容片也都在盘上', pieceOK);
check('目录里只剩 hwk-*.json + index.json（旧版内容片已清）',
  fs.readdirSync(HWK_DIR).every((n) => /^hwk-.+\.json$/.test(n) || n === 'index.json'),
  fs.readdirSync(HWK_DIR).join(', '));

console.log('\n── A3. 迁移能不能原样拼回去 ──');
const OLD_FILE = path.join(SITE, 'class/data/homework.json');
const old = looseJson(fs.readFileSync(OLD_FILE, 'utf8'));
const rec0 = JSON.parse(fs.readFileSync(path.join(HWK_DIR, idx[0].name), 'utf8'));
const pieceOf = (id) => (id ? JSON.parse(fs.readFileSync(path.join(HWK_DIR, id + '.json'), 'utf8')).text : null);
const oldSubjects = Object.keys(old).filter((k) => !['title', 'id', 'bg', 'date', 'homework', '笔记', 'notes', 'egg', '彩蛋'].includes(k));
let same = JSON.stringify(oldSubjects.filter((k) => k in rec0)) === JSON.stringify(oldSubjects);
for (const s of oldSubjects) if (rec0[s] !== old[s]) same = false;
if (rec0['笔记'] !== old['笔记']) same = false;
if (rec0.bg.value !== old.bg) same = false;
if (rec0.id !== old.id) same = false;
check('科目文本 / 笔记 / bg / id 与旧 homework.json 逐字节一致', same, oldSubjects.join(','));

console.log('\n── A4. 迁移脚本幂等 ──');
{
  const { execFileSync } = await import('node:child_process');
  const listBefore = fs.readdirSync(HWK_DIR).sort().join(',');
  const out1 = execFileSync(process.execPath, [path.join(HERE, 'migrate-hwk.mjs'), '--dry-run'], { encoding: 'utf8' });
  check('重跑 migrate-hwk.mjs 什么都不改（幂等）',
    /当天记录 hwk-.*→ exists/.test(out1) && fs.readdirSync(HWK_DIR).sort().join(',') === listBefore,
    (out1.match(/当天记录[^\n]*/) || [''])[0].trim());
  const out2 = execFileSync(process.execPath, [path.join(HERE, 'migrate-hwk.mjs'), '--in', OLD_FILE, '--out', HWK_DIR, '--dry-run'], { encoding: 'utf8' });
  check('--in / --out 参数可用', /index\.json 重建：\d+ 条/.test(out2));
  check('旧 homework.json 默认保留（备份）', fs.existsSync(OLD_FILE));
}

/* ═══════════════════════ jsdom 引导 ═══════════════════════ */
/** 用 jsdom 跑作业页；fetchPlan(url) 决定每个请求怎么答 */
function boot({ fetchPlan, withFetch = true, beforeParse } = {}) {
  const errors = [], logs = [], reqs = [];
  let inflight = 0, maxInflight = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (/Could not parse CSS stylesheet/.test(m)) return;      /* jsdom 的 CSS 解析器不认 @supports/color-mix */
    errors.push('jsdomError: ' + m);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', (...a) => logs.push('warn: ' + a.join(' ')));
  vc.on('log', (...a) => logs.push(a.join(' ')));

  const dom = new JSDOM(HTML, {
    url: 'http://127.0.0.1:8123/' + PAGE_REL,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.CSS = { supports: () => false };
      w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ target: el, isIntersecting: true }], this); } unobserve() {} disconnect() {} };
      w.ResizeObserver = class { constructor() {} observe() {} disconnect() {} };
      if (beforeParse) beforeParse(w);
      if (!withFetch) { try { delete w.fetch; } catch (e) { w.fetch = undefined; } return; }
      w.fetch = (url, opt) => new Promise((resolve, reject) => {
        const u = String(url);
        reqs.push(u);
        const signal = opt && opt.signal;
        if (signal) {
          if (signal.aborted) return reject(new Error('AbortError'));
          signal.addEventListener('abort', () => reject(new Error('AbortError')));
        }
        const plan = fetchPlan ? fetchPlan(u) : { ok: false, status: 404, body: '' };
        inflight++;
        if (inflight > maxInflight) maxInflight = inflight;
        setTimeout(() => {
          inflight--;
          if (!plan) return reject(new Error('network error'));
          if (plan.hang) return;                                  /* 永不落地：等外面 abort */
          resolve({ ok: plan.ok, status: plan.status, text: () => Promise.resolve(plan.body || '') });
        }, plan.delay || 0);
      });
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors, logs, reqs, stats: () => ({ maxInflight }) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const qa = (win, sel) => [].slice.call(win.document.querySelectorAll(sel));

/* 磁盘上的数据（新结构 + 旧备份），给「主页」那几段用 */
const serveFile = (rel) => {
  const p = path.join(SITE, rel);
  return fs.existsSync(p) ? { ok: true, status: 200, body: fs.readFileSync(p, 'utf8') } : { ok: false, status: 404, body: '' };
};

/* ═══════════════════════ B. 主页数据 ═══════════════════════ */
console.log('\n── B1. 主页读新结构（data/hwk/） ──');
{
  const A = boot({ fetchPlan: (u) => serveFile(u.replace(/^\//, '').replace(/^class\//, 'class/')) });
  await wait(600);
  const doc = A.doc;
  const rows = qa(A.win, 'tbody tr[data-subject]');
  const items = qa(A.win, 'tbody .hw-item');
  check('主页无报错', A.errors.length === 0, A.errors.join(' | ') || '干净');
  check('科目行 / 作业条目数量与旧数据一致',
    rows.length === oldSubjects.length && items.length === oldSubjects.reduce((n, s) => n + lines(old[s]).length, 0),
    rows.length + ' 行 / ' + items.length + ' 条（旧数据 ' + oldSubjects.reduce((n, s) => n + lines(old[s]).length, 0) + ' 条）');
  check('科目顺序不变', rows.map((r) => r.dataset.subject).join(',') === oldSubjects.join(','),
    rows.map((r) => r.dataset.subject).join(','));

  /* 勾选键：localStorage 的 key 必须和旧版一模一样（不然用户的勾全丢） */
  const expectKeys = new Set();
  oldSubjects.forEach((s) => lines(old[s]).forEach((t, i) => expectKeys.add(`hw:${old.id}:${itemHash(s, i, t)}`)));
  const gotKeys = items.map((el) => el.getAttribute('data-key'));
  check('勾选键（localStorage key）与旧版逐个一致',
    gotKeys.length === expectKeys.size && gotKeys.every((k) => expectKeys.has(k)),
    gotKeys.length + ' 个键');

  /* 文本逐条一致 */
  let textSame = true;
  let n = 0;
  oldSubjects.forEach((s) => {
    const tr = rows.find((r) => r.dataset.subject === s);
    lines(old[s]).forEach((t, i) => {
      const el = tr && tr.querySelectorAll('.hw-item .text')[i];
      n++;
      if (!el || el.textContent.trim() !== t) textSame = false;
    });
  });
  check('每一条作业的正文与旧数据逐条一致', textSame, n + ' 条比对');

  const note = doc.getElementById('note');
  check('笔记渲染出来了（Notes 便签）', !note.hidden && doc.getElementById('noteText').textContent.includes('返校'));
  check('背景配置读到了（bg 对象 → 老逻辑）', doc.getElementById('bgBtnText').textContent.includes('随机'),
    doc.getElementById('bgBtnText').textContent);
  check('科目图标 / 滚动条刻度都按科目数生成',
    qa(A.win, 'tbody tr .subject svg.ico').length === rows.length && qa(A.win, '.rail-mark').length === rows.length,
    qa(A.win, 'tbody tr .subject svg.ico').length + ' 图标 / ' + qa(A.win, '.rail-mark').length + ' 刻度');
  check('进度条统计没变（0 / ' + expectKeys.size + '）',
    doc.getElementById('progressText').textContent.includes('0 / ' + expectKeys.size),
    doc.getElementById('progressText').textContent.trim());
}

console.log('\n── B2. 旧 homework.json 兜底（新结构读不到时） ──');
{
  const A = boot({
    fetchPlan: (u) => {
      if (u.includes('/data/hwk/')) return { ok: false, status: 404, body: '' };
      if (u.includes('homework.json')) return serveFile('class/data/homework.json');
      return { ok: false, status: 404, body: '' };
    }
  });
  await wait(600);
  const items = qa(A.win, 'tbody .hw-item');
  check('新结构 404 时自动退回旧文件，主页照常', items.length === oldSubjects.reduce((n, s) => n + lines(old[s]).length, 0),
    items.length + ' 条');
  check('兜底路径下也不报错', A.errors.length === 0, A.errors.join(' | ') || '干净');
  check('控制台说明了用的是旧备份',
    A.logs.some((l) => /旧的 .*homework\.json/.test(l)), (A.logs.find((l) => l.includes('homework.json')) || '').slice(0, 60));
}

/* ═══════════════════════ C. 时光机 ═══════════════════════ */
console.log('\n── C1. 时光机：GitHub API 正常（raw 拉文件） ──');
const RAW_BASE = 'https://raw.githubusercontent.com/JinSuperOfficial/jinsuperofficial.github.io/main/class/data/hwk/';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/JinSuperOfficial/jinsuperofficial.github.io@main/class/data/hwk/';
const API_URL = 'https://api.github.com/repos/JinSuperOfficial/jinsuperofficial.github.io/contents/class/data/hwk';
{
  const A = boot({
    fetchPlan: (u) => {
      if (u === API_URL) {
        return { ok: true, status: 200, body: JSON.stringify(idx.map((e) => ({
          type: 'file', name: e.name, sha: 'sha-' + e.id, download_url: RAW_BASE + e.name
        })).concat([{ type: 'file', name: 'index.json', download_url: RAW_BASE + 'index.json' }])) };
      }
      if (u.startsWith(RAW_BASE)) return serveFile('class/data/hwk/' + u.slice(RAW_BASE.length));
      if (u.startsWith(CDN_BASE)) return { ok: false, status: 404, body: '' };
      if (u.includes('/data/hwk/')) return serveFile('class/data/hwk/' + u.split('/data/hwk/')[1]);
      return { ok: false, status: 404, body: '' };
    }
  });
  await wait(600);
  const doc = A.doc;
  doc.getElementById('tmBtn').focus();                 /* 真浏览器里点按钮就是先聚焦 */
  doc.getElementById('tmBtn').click();
  await wait(500);
  const listed = qa(A.win, '#tmList .log-item');
  check('时光机按钮能打开，列表按 index 渲染', listed.length === idx.length, listed.length + ' 条');
  check('列表里没有 index.json 这种非作业文件（只认 hwk-*.json）',
    A.reqs.filter((u) => u.endsWith('index.json') && u.startsWith(RAW_BASE)).length === 0);
  check('计数标签显示条数', /1 条/.test(doc.getElementById('tmCount').textContent), doc.getElementById('tmCount').textContent);
  const detail = doc.getElementById('tmDetail');
  check('第一天详情：标题 + 科目 + 条目都在',
    detail.textContent.includes(rec0.title) && detail.textContent.includes('语文') && detail.textContent.includes('组合'),
    detail.querySelector('.log-h') ? detail.querySelector('.log-h').textContent : '(无标题)');
  check('详情里的科目数 = 记录的科目数',
    detail.querySelectorAll('.tm-subj-row').length === oldSubjects.length,
    detail.querySelectorAll('.tm-subj-row').length + ' 科');
  check('详情里带 Notes 便签', !!detail.querySelector('.tm-note'));
  check('文件是从 raw.githubusercontent 拉的（科目内联，不再另拉内容片）',
    A.reqs.some((u) => u.startsWith(RAW_BASE) && u.endsWith('hwk-n261010.json')) &&
    !A.reqs.some((u) => /hwc-/.test(u)),
    A.reqs.filter((u) => u.includes('hwk-')).length + ' 次文件请求');
  check('模态框：Esc 能关、焦点归还给按钮',
    (() => {
      doc.dispatchEvent(new A.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const closed = !doc.getElementById('tmWin').classList.contains('show');
      return closed && doc.activeElement === doc.getElementById('tmBtn');
    })(), doc.activeElement && doc.activeElement.id);
}

console.log('\n── C2. 时光机：GitHub API 超时（3 秒）→ CDN 索引 + CDN 文件 ──');
{
  const A = boot({
    fetchPlan: (u) => {
      if (u === API_URL) return { hang: true };                       /* 卡住，等 3 秒 abort */
      if (u === CDN_BASE + 'index.json') return serveFile('class/data/hwk/index.json');
      if (u.startsWith(CDN_BASE)) return serveFile('class/data/hwk/' + u.slice(CDN_BASE.length));
      if (u.startsWith(RAW_BASE)) return { ok: false, status: 500, body: '' };   /* raw 挂了 */
      return { ok: false, status: 404, body: '' };
    }
  });
  await wait(500);
  const doc = A.doc;
  const t0 = Date.now();
  doc.getElementById('tmBtn').click();
  await wait(3600);                                                   /* 3 秒超时 + 余量 */
  const el = Date.now() - t0;
  check('GitHub 超时后退回 CDN 的 index.json',
    A.reqs.includes(CDN_BASE + 'index.json'), A.reqs.filter((u) => u.includes('index.json')).join(' , '));
  check('每份文件改从 CDN 拉（raw 失败自动下一档）',
    A.reqs.some((u) => u.startsWith(CDN_BASE) && u.endsWith('hwk-n261010.json')));
  check('超时到回退的总耗时在 3 秒量级', el > 2900 && el < 6000, el + ' ms');
  check('CDN 回退后照样能看详情',
    doc.getElementById('tmDetail').textContent.includes('语文'),
    (doc.getElementById('tmDetail').textContent || '').slice(0, 30).replace(/\s+/g, ' '));
  check('这条路上也没有报错', A.errors.length === 0, A.errors.join(' | ') || '干净');
}

console.log('\n── C3. 时光机：GitHub 403 / CDN 挂 → 同源兜底 ──');
{
  const A = boot({
    fetchPlan: (u) => {
      if (u === API_URL) return { ok: false, status: 403, body: '{"message":"rate limit"}' };
      if (u.startsWith(CDN_BASE)) return { ok: false, status: 404, body: '' };
      if (u.includes('/data/hwk/')) return serveFile('class/data/hwk/' + u.split('/data/hwk/')[1]);
      return { ok: false, status: 404, body: '' };
    }
  });
  await wait(500);
  const doc = A.doc;
  doc.getElementById('tmBtn').click();
  await wait(600);
  check('403 时不硬刚，直接走下一档', A.reqs.filter((u) => u === API_URL).length === 1);
  check('同源 ./data/hwk/index.json 也能当目录用',
    A.reqs.some((u) => u === './data/hwk/index.json'), A.reqs.filter((u) => u.includes('index.json')).join(' , '));
  check('同源这条路也渲染出了详情', doc.getElementById('tmDetail').textContent.includes('语文'));
}

console.log('\n── C4. 时光机：三个来源全挂 → 迷路提示，主页不受影响 ──');
{
  const A = boot({ fetchPlan: () => ({ ok: false, status: 404, body: '' }) });
  await wait(600);
  const doc = A.doc;
  doc.getElementById('tmBtn').click();
  await wait(500);
  check('窗口里说「时光机暂时迷路了」', doc.getElementById('tmDetail').textContent.includes('时光机暂时迷路了'),
    doc.getElementById('tmDetail').textContent.trim());
  check('主页照常（科目行还在）', qa(A.win, 'tbody tr[data-subject]').length === 6 || qa(A.win, 'tbody tr[data-subject]').length > 0,
    qa(A.win, 'tbody tr[data-subject]').length + ' 行');
  check('全挂时也不报错（只有 console.warn）', A.errors.length === 0, A.errors.join(' | ') || '干净');
}

console.log('\n── C5. 缓存 5 分钟 / 并发 ≤8 / 50 条分页 ──');
{
  /* 60 份作业：看分页与并发 */
  const many = [];
  for (let i = 0; i < 60; i++) {
    const id = 'n26' + String(1000 + i);
    many.push({ id, name: 'hwk-' + id + '.json', date: '2026-0' + (1 + (i % 9)) + '-01', title: '历史的作业 ' + i });
  }
  const bodies = {};
  many.forEach((e) => {
    bodies[e.name] = JSON.stringify({
      id: e.id, date: e.date, title: e.title, bg: { value: 'default' },
      notesId: null, eggId: null, subjects: { 语文: 'hwc-041c72f1' }
    });
  });
  const A = boot({
    fetchPlan: (u) => {
      if (u === API_URL) {
        return { ok: true, status: 200, body: JSON.stringify(many.map((e) => ({
          type: 'file', name: e.name, download_url: RAW_BASE + e.name
        }))) };
      }
      if (u.startsWith(RAW_BASE) && bodies[u.slice(RAW_BASE.length)]) {
        return { ok: true, status: 200, body: bodies[u.slice(RAW_BASE.length)], delay: 4 };   /* 加一点延迟，好看并发 */
      }
      if (u.includes('/data/hwk/')) return serveFile('class/data/hwk/' + u.split('/data/hwk/')[1]);
      return { ok: false, status: 404, body: '' };
    }
  });
  await wait(600);
  const doc = A.doc;
  doc.getElementById('tmBtn').click();
  await wait(900);

  check('并发不超过 8', A.stats().maxInflight <= 8, '峰值 ' + A.stats().maxInflight);
  check('列表先画 50 条（不一次性堆 60 条）', qa(A.win, '#tmList .log-item').length === 50,
    qa(A.win, '#tmList .log-item').length + ' 条');
  const more = doc.getElementById('tmMore');
  check('「加载更多」出现并写清还剩多少',
    !more.hidden && /还有 10 条/.test(more.textContent), more.textContent);
  more.click();
  await wait(100);
  check('点了之后 60 条全在，按钮自己藏起来',
    qa(A.win, '#tmList .log-item').length === 60 && more.hidden,
    qa(A.win, '#tmList .log-item').length + ' 条');

  /* 缓存：关掉再开，不该再打 API / index.json */
  const before = A.reqs.length;
  doc.dispatchEvent(new A.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  doc.getElementById('tmBtn').click();
  await wait(200);
  const added = A.reqs.slice(before);
  check('5 分钟内再打开不再请求目录（用 localStorage 缓存）',
    !added.some((u) => u === API_URL || u.endsWith('index.json')), added.length + ' 个新请求');
  check('计数标签标出这是缓存', /缓存/.test(doc.getElementById('tmCount').textContent), doc.getElementById('tmCount').textContent);
}

console.log('\n── C6. 降级：没有 fetch 的浏览器 ──');
{
  const A = boot({ withFetch: false });
  await wait(500);
  check('不支持 fetch / Promise 时时光机按钮直接藏掉',
    A.doc.getElementById('tmBtn').hidden === true, 'hidden=' + A.doc.getElementById('tmBtn').hidden);
  check('主页功能不受影响（科目行照常）', qa(A.win, 'tbody tr[data-subject]').length > 0,
    qa(A.win, 'tbody tr[data-subject]').length + ' 行');
}

console.log('\n── C7. 静态约定（超时 / 缓存 / CDN / CORS / reduced-motion） ──');
{
  check('超时 3 秒写在常量里', /timeout:\s*3000/.test(HTML));
  check('缓存 TTL 5 分钟 + localStorage 键名', /ttl:\s*5\s*\*\s*60\s*\*\s*1000/.test(HTML) && /cacheKey:\s*'hwk-index-v2'/.test(HTML));
  check('并发 8 / 分页 50 写在常量里', /concurrency:\s*8/.test(HTML) && /page:\s*50/.test(HTML));
  check('CDN 前缀按 仓库@分支/路径 拼', /cdn\.jsdelivr\.net\/gh\/\$\{TM\.owner\}\/\$\{TM\.repo\}@\$\{TM\.branch\}\/\$\{TM\.path\}\//.test(HTML));
  check('Contents API 只列第一层、且带 Accept 头',
    /api\.github\.com\/repos\/\$\{TM\.owner\}\/\$\{TM\.repo\}\/contents\/\$\{TM\.path\}/.test(HTML) &&
    /'Accept':'application\/vnd\.github\+json'/.test(HTML));
  check('拉文件不带任何认证头（raw 的 CORS 预检会挂）',
    !/Authorization/.test(HTML), '没有 Authorization');
  check('时光机按钮是 <button type="button">（Tab / Enter 可用）',
    /<button class="more-btn" id="tmBtn" type="button"/.test(HTML));
  check('reduced-motion 下时光机按钮的过渡也关掉',
    /prefers-reduced-motion: reduce\)\{\s*\n\s*\.tm-more\{ transition:none \}/.test(HTML));
  check('骨架复用更新日志那套（Esc / 焦点 / 遮罩点击）',
    /tmWin\.classList\.add\('show'\)/.test(HTML) && /closeTimeline\(\)/.test(HTML) &&
    /e\.target === tmWin/.test(HTML));
}

console.log('\n合计 ' + (pass + fail) + ' 项：通过 ' + pass + '，失败 ' + fail + (warn ? '，提示 ' + warn : ''));
process.exit(fail ? 1 : 0);
