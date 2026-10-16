'use strict';
/**
 * desktop/test/hwk-store.test.cjs —— 作业编辑器「先落本地」的那一半
 * ---------------------------------------------------------------
 * 学校那台机器没有仓库、常常没有网，所以这些必须在纯 node 下就能验：
 *   · 保存一天 → 文件形状 / 键序 / index.json 顺序，和站点里那份一致
 *   · 第一次打开从随包副本导基线（只导一次、不覆盖本机已有）
 *   · 快照（「先同步到本地」）落盘，上云失败也还在
 *   · 脏标记：保存过才需要同步，同步完清掉
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 跑测试时同步实现就在仓库里（打包后才换成 resources/sync/lib） */
process.env.JSD_SYNC_LIB = path.resolve(__dirname, '..', '..', 'sync', 'lib');

const { createHwkStore, stampOf } = require('../src/hwk-store');

/* 跑完统一清掉临时目录（见 build/test-sync.mjs 里同一段注释） */
const TEMPS = [];
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `jsd-hwk-${tag}-`));
  TEMPS.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ } }
});

function makeStore({ baseline = null } = {}) {
  const base = tmp('base');
  const dir = path.join(base, 'hwk');
  const outbox = path.join(base, 'sync', 'outbox');
  let baselineDir = path.join(base, 'baseline');
  if (baseline) {
    fs.mkdirSync(baselineDir, { recursive: true });
    for (const [name, data] of Object.entries(baseline)) {
      fs.writeFileSync(path.join(baselineDir, name), typeof data === 'string' ? data : JSON.stringify(data, null, '\t') + '\n');
    }
  }
  return { store: createHwkStore({ dir, baselineDir, outboxDir: outbox }), dir, outbox, baselineDir };
}

test('保存一天：文件形状、键序、目录顺序都和站点里那份一致', async () => {
  const { store, dir } = makeStore();
  const res = await store.save({
    date: '2026/10/15',
    subjects: [{ name: '语文', text: '背古诗\n抄写' }, { name: '数学', text: 'P32' }],
    notes: '别忘带书',
  });
  assert.equal(res.record.id, 'n261015');
  assert.deepEqual(Object.keys(res.record).slice(0, 4), ['id', 'date', 'title', 'bg']);

  const text = fs.readFileSync(path.join(dir, 'hwk-n261015.json'), 'utf8');
  assert.match(text, /^\{\n\t"id": "n261015",/, '制表符缩进 + 固定键序');
  assert.match(text, /\n\t"笔记": "别忘带书"\n\}\n$/, '结尾换行，和控制台写的一模一样');

  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.equal(index[0].id, 'n261015');
  assert.equal(index[0].name, 'hwk-n261015.json');

  /* 第二天写进去 → 新的在前 */
  await store.save({ date: '2026-10-16', subjects: [{ name: '英语', text: 'U1' }] });
  const index2 = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  assert.deepEqual(index2.map((e) => e.id), ['n261016', 'n261015']);
});

test('校验走的是共用规则（空内容/非法 id 都要拦住）', async () => {
  const { store } = makeStore();
  await assert.rejects(() => store.save({ date: '2026-10-15', subjects: [] }), /一个科目都没填/);
  await assert.rejects(() => store.save({ date: '2026-10-15', id: '中文 id', subjects: [{ name: '语文', text: 'x' }] }), /不能当文件名/);
  await assert.rejects(() => store.read('../etc/passwd'), /id 不合法/);
});

test('第一次打开导基线，只导一次，且不覆盖本机已有的', async () => {
  const baseline = {
    'hwk-n261010.json': { id: 'n261010', date: '2026-10-10', title: '作业-20261010', bg: { value: 'default' }, 语文: '旧的一天' },
    'index.json': [{ id: 'n261010', name: 'hwk-n261010.json', date: '2026-10-10', title: '作业-20261010' }],
  };
  const { store, dir } = makeStore({ baseline });
  const first = await store.seed();
  assert.equal(first.seeded, true);
  assert.equal(first.count, 1);
  const list = await store.list();
  assert.deepEqual(list.records.map((r) => r.id), ['n261010']);

  /* 本机改过之后再 seed：什么都不做 */
  await store.save({ date: '2026-10-16', subjects: [{ name: '数学', text: 'P1' }] });
  const again = await store.seed();
  assert.equal(again.seeded, false);
  assert.equal(fs.existsSync(path.join(dir, 'hwk-n261016.json')), true);

  /* 基线里那份没有被写坏 */
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'hwk-n261010.json'), 'utf8'));
  assert.equal(kept.语文, '旧的一天');
});

test('快照 = 「先同步到本地」：改动落盘成本地文件，脏标记还在', async () => {
  const { store, outbox } = makeStore();
  await store.save({ date: '2026-10-15', subjects: [{ name: '语文', text: '背古诗' }] });
  assert.deepEqual(store.dirtyIds(), ['n261015']);

  const snap = await store.snapshot();
  assert.ok(fs.existsSync(path.join(snap.dir, 'hwk-n261015.json')));
  assert.ok(fs.existsSync(path.join(snap.dir, 'index.json')));
  assert.ok(snap.dir.startsWith(outbox), '快照要落在 outbox 里');
  assert.equal(path.basename(path.dirname(snap.dir)), snap.stamp, '快照目录名就是这次的时间戳');
  assert.match(snap.stamp, /^\d{8}-\d{6}$/);

  /* 上云成功之后才清脏标记 */
  assert.deepEqual(store.dirtyIds(), ['n261015']);
  store.markSynced(snap.stamp);
  assert.deepEqual(store.dirtyIds(), []);
  const after = await store.list();
  assert.equal(after.dirty.length, 0);
  assert.equal(after.lastSyncStamp, snap.stamp);
});

test('同一天写第二次会留一份备份（备份不进任何会被上传的目录）', async () => {
  const { store, dir } = makeStore();
  await store.save({ date: '2026-10-15', subjects: [{ name: '语文', text: '第一版' }] });
  const second = await store.save({ date: '2026-10-15', subjects: [{ name: '语文', text: '第二版' }] });
  assert.equal(second.existed, true);
  const backups = path.join(dir, 'backups');
  assert.ok(fs.existsSync(backups));
  const dirs = fs.readdirSync(backups);
  assert.equal(dirs.length, 1);
  const kept = fs.readFileSync(path.join(backups, dirs[0], 'hwk-n261015.json'), 'utf8');
  assert.match(kept, /第一版/);
});

test('时间戳：人能看懂，也能直接当目录名', () => {
  const s = stampOf(new Date(2026, 9, 15, 22, 18, 7));
  assert.equal(s, '20261015-221807');
});
