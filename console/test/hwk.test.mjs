/**
 * 作业数据（`console/lib/hwk.mjs`）的测试
 * ---------------------------------------------------
 * 这一步会**真的写文件**（写 hwk-<id>.json、改 index.json、重建生产清单、
 * 覆盖前备份旧版本），所以全程在一份临时 fixture 站点上跑：
 * 靠 `DSH_CONSOLE_ROOT` 把站点根指到临时目录，绝不碰真数据。
 *
 * 覆盖的契约（改坏了页面就会少一天 / 勾选全清空 / 时光机少内容）：
 *   1. 写一天 → 顶到 index.json 最前；原来那天还在（历史）
 *   2. 老的大文件 homework.json 里那份没进 hwk/ 的，先按格式补进历史
 *   3. 同一天写第二次：旧版本备份到 stateDir/backups/（不进站点、不会被上传）
 *   4. 两种输入（表单 / JSON 源码）写出同一份东西；正文一个字都不改
 *   5. 校验：id 不能当文件名、日期形状、未知背景只是提醒
 *   6. dryRun 一个字节都不写
 *   7. 「重建清单」按磁盘实况来（孤儿文件收进来、目录里多出来的条目清掉）
 *   8. 生产清单 index-produce.json：目录 + 最近 5 天正文
 *
 * 跑法：node --test console/test/hwk.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ═══════════ fixture（必须在 import 控制台模块之前设好根） ═══════════ */

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(here, '..');
const realBuild = path.resolve(consoleDir, '..', 'build');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hwk-test-'));
process.env.DSH_CONSOLE_ROOT = root;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwk-state-'));
process.env.DSH_CONSOLE_STATE_DIR = stateDir;

const site = path.join(root, 'jinsuper.rth1.xyz');
const dataDir = path.join(site, 'class', 'data');
const hwkDir = path.join(dataDir, 'hwk');
fs.mkdirSync(hwkDir, { recursive: true });

/* 生成器：把真实现复制进 fixture（控制台就是这么按路径 import 它的） */
fs.mkdirSync(path.join(root, 'build', 'lib'), { recursive: true });
fs.copyFileSync(path.join(realBuild, 'lib', 'hwk-index.mjs'), path.join(root, 'build', 'lib', 'hwk-index.mjs'));

const DUMP = (o) => JSON.stringify(o, null, '\t') + '\n';
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* 起点：一天 + 目录；旧的大文件里是**另一天**（用来验证自动补历史） */
fs.writeFileSync(path.join(hwkDir, 'hwk-n261010.json'), DUMP({
  id: 'n261010', date: '2026-10-10', title: '作业-20261010', bg: { value: 'default' },
  语文: '1. 旧的语文',
}));
fs.writeFileSync(path.join(hwkDir, 'index.json'), DUMP([
  { id: 'n261010', name: 'hwk-n261010.json', date: '2026-10-10', title: '作业-20261010' },
]));
fs.writeFileSync(path.join(dataDir, 'homework.json'), DUMP({
  id: 'n261009', title: '作业-20261009', bg: 'default', 数学: '1. 老文件那一份',
}));

const hwk = await import('../lib/hwk.mjs');

const fileOf = (id) => path.join(hwkDir, 'hwk-' + id + '.json');
const indexOf = () => readJson(path.join(hwkDir, 'index.json'));
const produceOf = () => readJson(path.join(dataDir, 'index-produce.json'));

/* ═══════════ 1. 看现状 ═══════════ */

test('listRecords：目录 + 磁盘实况 + 老文件，只读', () => {
  const info = hwk.listRecords();
  assert.equal(info.records.length, 1);
  assert.equal(info.records[0].id, 'n261010');
  assert.equal(info.records[0].exists, true);
  assert.equal(info.records[0].bytes > 0, true);
  assert.equal(info.produceExists, false, '还没生成过生产清单');
  assert.equal(info.legacy.id, 'n261009');
  assert.deepEqual(info.legacy.subjects, ['数学']);
  assert.equal(info.records[0].rel, 'class/data/hwk/hwk-n261010.json');
});

test('readRecord：读得到、id 不合法 / 不存在都有明确错误', () => {
  assert.equal(hwk.readRecord('n261010').record.语文, '1. 旧的语文');
  assert.throws(() => hwk.readRecord('n261099'), (e) => e.status === 404);
  assert.throws(() => hwk.readRecord('../x'), (e) => e.status === 400);
});

/* ═══════════ 2. 写一天（表单） ═══════════ */

test('写新的一天：顶到 index.json 最前，原来那天留作历史；生产清单一起生成', async () => {
  const res = await hwk.saveHomework({
    mode: 'form',
    date: '2026-10-11',
    subjects: [{ name: '语文', text: '1. 新的语文\n2. 第二行' }, { name: '体育', text: '1. 跑两圈' }],
    notes: '记得带校牌',
  });

  assert.equal(res.id, 'n261011', 'id 按日期自动生成');
  assert.equal(res.isFirst, true);
  assert.equal(res.replaced, false);
  assert.equal(res.indexCount, 3, 'n261011 + n261010 + 补进来的 n261009');

  /* 写出来的记录：键序固定，正文一个字没动 */
  const rec = readJson(fileOf('n261011'));
  assert.deepEqual(Object.keys(rec), ['id', 'date', 'title', 'bg', '语文', '体育', '笔记']);
  assert.equal(rec.语文, '1. 新的语文\n2. 第二行');
  assert.equal(rec.笔记, '记得带校牌');
  assert.deepEqual(rec.bg, { value: 'default' });

  /* 目录：新的在最前，旧的都还在 */
  const idx = indexOf();
  assert.deepEqual(idx.map((e) => e.id), ['n261011', 'n261010', 'n261009']);

  /* 老文件那份按 hwk-<id>.json 补进了历史（原文件不动） */
  assert.equal(res.archived.length, 1);
  assert.equal(res.archived[0].name, 'hwk-n261009.json');
  assert.equal(readJson(fileOf('n261009')).数学, '1. 老文件那一份');
  assert.equal(readJson(path.join(dataDir, 'homework.json')).id, 'n261009', '老文件原样留着');

  /* 生产清单：目录 + 最近 5 天（现在只有 3 天）的正文 */
  const prod = produceOf();
  assert.equal(prod.count, 3);
  assert.deepEqual(prod.entries.map((e) => e.id), ['n261011', 'n261010', 'n261009']);
  assert.equal(Object.keys(prod.preview).length, 3);
  assert.equal(prod.preview['hwk-n261011.json'].笔记, '记得带校牌');
  assert.equal(prod.previewCount, 3);
});

test('写一天：文件是制表符缩进的 UTF-8，中文不被转义', () => {
  const raw = fs.readFileSync(fileOf('n261011'), 'utf8');
  assert.match(raw, /\n\t"语文":/, '缩进用制表符，和现有那几个文件一致');
  assert.match(raw, /"语文"/, '中文键原样，不写成 \\uXXXX');
  assert.equal(raw.endsWith('\n'), true);
});

/* ═══════════ 3. 同一天写第二次：备份 ═══════════ */

test('同一天再写：旧版本先备份到 stateDir/backups，站点目录里不留备份', async () => {
  const res = await hwk.saveHomework({
    mode: 'form',
    date: '2026-10-11',
    id: 'n261011',
    subjects: [{ name: '语文', text: '1. 改过一次' }],
  });

  assert.equal(res.replaced, true);
  assert.equal(res.backups.length, 1);
  const backup = res.backups[0];
  assert.equal(fs.existsSync(backup), true, '备份文件真在');
  assert.equal(path.resolve(backup).startsWith(path.resolve(stateDir)), true, '备份落在 console 的状态目录');
  assert.equal(readJson(backup).语文, '1. 新的语文\n2. 第二行', '备份的是改动前那一版');
  assert.equal(readJson(fileOf('n261011')).语文, '1. 改过一次');
  assert.equal(readJson(fileOf('n261011')).笔记, undefined, '没填的字段就不写进去');

  /* 站点目录里只该有 hwk-*.json 和 index.json，没有任何 .bak/.tmp 之类 */
  const junk = fs.readdirSync(hwkDir).filter((n) => !/^(hwk-.+\.json|index\.json)$/.test(n));
  assert.deepEqual(junk, []);
});

/* ═══════════ 4. JSON 源码那条路 ═══════════ */

test('JSON 源码：多余逗号也认；科目 / 笔记 / 彩蛋各就各位', async () => {
  const source = `{
    "date": "2026-10-12",
    "title": "作业-20261012",
    "bg": "game-mc",
    "英语": "1. 背单词",
    "科学": "1. 实验报告",
    "笔记": "明天带实验服",
    "彩蛋": "今天没有彩蛋",
  }`;
  const res = await hwk.saveHomework({ mode: 'json', source });
  assert.equal(res.id, 'n261012');
  const rec = readJson(fileOf('n261012'));
  assert.deepEqual(Object.keys(rec), ['id', 'date', 'title', 'bg', '英语', '科学', '笔记', '彩蛋']);
  assert.deepEqual(rec.bg, { value: 'game-mc' });
  assert.equal(rec.彩蛋, '今天没有彩蛋');
  assert.equal(res.indexCount, 4);
});

test('JSON 源码：坏 JSON / 顶层不是对象 → 400 加人话', async () => {
  await assert.rejects(() => hwk.saveHomework({ mode: 'json', source: '{坏' }), (e) => e.status === 400 && /JSON 解析不了/.test(e.message));
  await assert.rejects(() => hwk.saveHomework({ mode: 'json', source: '[1,2]' }), (e) => e.status === 400 && /顶层/.test(e.message));
});

/* ═══════════ 5. 校验 ═══════════ */

test('id 不能当文件名 / 日期写歪 / 一科都没填 → 一次把问题说完', async () => {
  await assert.rejects(
    () => hwk.saveHomework({ mode: 'form', date: '2026-13-40', id: '作业 一天', subjects: [{ name: '语文', text: 'x' }] }),
    (e) => e.status === 400 && /日期要写成/.test(e.message) && /不能当文件名/.test(e.message),
  );
  await assert.rejects(
    () => hwk.saveHomework({ mode: 'form', date: '2026-10-13', id: 'n261013' }),
    (e) => e.status === 400 && /一个科目都没填/.test(e.message),
  );
  await assert.rejects(
    () => hwk.saveHomework({ mode: 'form', date: '2026-10-13', id: 'n261013', subjects: [{ name: 'bg', text: 'x' }] }),
    (e) => e.status === 400 && /保留字/.test(e.message),
  );
});

test('背景认不出：只提醒，照写（页面会按默认处理）', async () => {
  const res = await hwk.saveHomework({
    mode: 'form', date: '2026-10-14', id: 'n261014',
    bg: '星空', subjects: [{ name: '语文', text: '1. x' }],
  });
  assert.equal(res.meta.bg, '星空');
  assert.equal(res.notes.some((n) => /页面不认识/.test(n)), true);
  assert.deepEqual(readJson(fileOf('n261014')).bg, { value: '星空' });
});

test('日期用 / 或 . 写、id 反推日期，都认', async () => {
  const res = await hwk.saveHomework({
    mode: 'form', date: '2026/10/15', subjects: [{ name: '语文', text: '1. x' }],
  });
  assert.equal(res.id, 'n261015');
  assert.equal(res.date, '2026-10-15');
  const res2 = await hwk.saveHomework({
    mode: 'form', id: 'n261016', subjects: [{ name: '语文', text: '1. x' }],
  });
  assert.equal(res2.date, '2026-10-16', '日期从 id 反推');
});

/* ═══════════ 6. dryRun ═══════════ */

test('dryRun：算得出结果，但一个字节都不写', async () => {
  const before = fs.readdirSync(hwkDir).sort().join(',');
  const beforeIndex = fs.readFileSync(path.join(hwkDir, 'index.json'), 'utf8');
  const res = await hwk.saveHomework({
    mode: 'form', date: '2026-10-20', subjects: [{ name: '语文', text: '1. 不算数' }], dryRun: true,
  });
  assert.equal(res.dryRun, true);
  assert.equal(res.isFirst, true);
  assert.equal(fs.existsSync(fileOf('n261020')), false);
  assert.equal(fs.readdirSync(hwkDir).sort().join(','), before);
  assert.equal(fs.readFileSync(path.join(hwkDir, 'index.json'), 'utf8'), beforeIndex);
});

/* ═══════════ 7. 重建清单 ═══════════ */

test('重建清单：按磁盘实况收孤儿、清掉目录里多出来的条目', async () => {
  /* ① 手拷进来一份没登记的（模拟直接丢文件进目录） */
  fs.writeFileSync(fileOf('n261021'), DUMP({
    id: 'n261021', date: '2026-10-21', title: '作业-20261021', bg: { value: 'default' }, 语文: '1. 手拷的',
  }));
  /* ② 目录里塞一条没有对应文件的（模拟删了文件忘了改目录） */
  const idx = indexOf();
  idx.push({ id: 'n261099', name: 'hwk-n261099.json', date: '2026-10-09', title: '早就没了' });
  fs.writeFileSync(path.join(hwkDir, 'index.json'), DUMP(idx));

  const before = hwk.listRecords();
  assert.equal(before.orphans.length, 1);
  assert.equal(before.missing.length, 1);

  const res = await hwk.rebuildManifests();
  assert.equal(res.skipped, false);
  assert.deepEqual(res.changed.sort(), ['class/data/hwk/index.json', 'class/data/index-produce.json']);

  const after = hwk.listRecords();
  assert.deepEqual(after.orphans, [], '孤儿被收进目录了');
  assert.deepEqual(after.missing, [], '没有文件的条目被清掉了');
  assert.equal(after.records[0].id, 'n261021', '日期最新的在最前');
  assert.equal(after.produceExists, true);
});

test('生产清单：最多带 5 天正文，其余靠目录逐份取', async () => {
  /* 现在已经有 6 天以上了（n261021、n261016、n261015、n261014、n261012、n261011、n261010…） */
  const res = await hwk.rebuildManifests();
  assert.equal(res.skipped, false);
  const prod = produceOf();
  assert.equal(prod.count, res.count, 'count 是全量天数');
  assert.equal(prod.previewCount, 5, 'preview 只带 5 天');
  assert.equal(Object.keys(prod.preview).length, 5);
  assert.deepEqual(Object.keys(prod.preview), prod.entries.slice(0, 5).map((e) => e.name));
  assert.equal(Object.prototype.hasOwnProperty.call(prod, 'generatedAt'), false, '不写时间戳（同样的输入要一样的字节）');
});

test('重建清单是幂等的：第二遍一个字节都不变', async () => {
  const first = fs.readFileSync(path.join(hwkDir, 'index.json'), 'utf8') + fs.readFileSync(path.join(dataDir, 'index-produce.json'), 'utf8');
  const res = await hwk.rebuildManifests();
  assert.deepEqual(res.changed, []);
  const second = fs.readFileSync(path.join(hwkDir, 'index.json'), 'utf8') + fs.readFileSync(path.join(dataDir, 'index-produce.json'), 'utf8');
  assert.equal(second, first);
});
