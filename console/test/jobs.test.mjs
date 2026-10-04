/**
 * 部署作业（console/lib/jobs.mjs）的测试
 * ---------------------------------------------------
 * 作业是「控制台点一键部署」背后那条子进程。它必须：
 *   · 只跑白名单里的管线与开关（前端传不了任意命令）
 *   · 单飞（同时只允许一个）
 *   · 把 JSON Lines 进度解析成步骤状态，并留下**人类可读的完整日志**
 *   · 日志能按字节偏移增量读（界面靠它做实时 tail）
 *   · 能中止
 *
 * 这里用真的子进程（node -e 吐几行 JSONL），但**不碰任何真实部署**：
 * argv 是测试注入的。临时目录当 stateDir，不会污染真控制台。
 *
 * 跑法：node --test console/test/jobs.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* paths.mjs 在 import 时就读环境变量 —— 所以必须先把目录定好再动态 import */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-jobs-'));
process.env.DSH_CONSOLE_ROOT = root;
process.env.DSH_CONSOLE_STATE_DIR = path.join(root, 'state');
fs.mkdirSync(path.join(root, 'jinsuper.rth1.xyz'), { recursive: true });
fs.mkdirSync(process.env.DSH_CONSOLE_STATE_DIR, { recursive: true });

const jobs = await import('../lib/jobs.mjs');

before(() => jobs._resetForTest());
after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 忽略 */ } });

/* 一个玩具「管线」：吐 3 条日志 + 2 个步骤，然后退出 */
const FAKE_OK = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ ev: 'start', steps: [{ id: 'build', label: '构建' }, { id: 'prep', label: '组装 dist/' }] });
out({ ev: 'step', id: 'build', state: 'start' });
out({ ev: 'log', id: 'build', line: '  文档站构建 · 预渲染 + 本地化', stream: 'out' });
out({ ev: 'step', id: 'build', state: 'ok', ms: 1200, code: 0 });
out({ ev: 'step', id: 'prep', state: 'start' });
out({ ev: 'log', id: 'prep', line: '  新增 1 · 更新 5 · 未变 1311', stream: 'out' });
out({ ev: 'step', id: 'prep', state: 'ok', ms: 800, code: 0 });
out({ ev: 'done', ok: true, ms: 2000, domains: ['www.jinsuper.cn'], changed: ['p/docs.html'] });
`;

const FAKE_FAIL = `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ ev: 'start', steps: [{ id: 'build', label: '构建' }, { id: 'prep', label: '组装 dist/' }] });
out({ ev: 'step', id: 'build', state: 'start' });
out({ ev: 'step', id: 'build', state: 'ok', ms: 10, code: 0 });
out({ ev: 'step', id: 'prep', state: 'start' });
process.stderr.write('  组装失败：磁盘满了\\n');
out({ ev: 'step', id: 'prep', state: 'fail', ms: 5, code: 1 });
out({ ev: 'done', ok: false, ms: 20, domains: [], changed: [] });
process.exitCode = 1;
`;

const FAKE_SLOW = `
process.stdout.write(JSON.stringify({ ev: 'start', steps: [{ id: 'prep', label: '组装 dist/' }] }) + '\\n');
process.stdout.write(JSON.stringify({ ev: 'step', id: 'prep', state: 'start' }) + '\\n');
setTimeout(() => process.exit(0), 30000);
`;

const runFake = (script) => jobs.startJob(
  { pipeline: 'full', label: '测试作业' },
  { argv: ['-e', script] },
);

/* ═══════════ 白名单 ═══════════ */

test('pipelineArgv：只认白名单里的管线', () => {
  assert.throws(() => jobs.pipelineArgv('nope', {}), (e) => e.status === 400 && /不认识的管线/.test(e.message));
  const argv = jobs.pipelineArgv('full', {});
  assert.ok(argv[0].endsWith(path.join('build', 'run-pipeline.mjs')) || argv[0].endsWith('run-pipeline.mjs'));
  assert.deepEqual(argv.slice(1), ['--steps=full', '--json']);
});

test('pipelineArgv：开关映射成 CLI 参数，未知开关直接拒', () => {
  const argv = jobs.pipelineArgv('full', { noBuild: true, noCheck: true, noGh: true, noRetry: true, noVerify: true });
  assert.deepEqual(argv.slice(3), ['--no-build', '--no-check', '--no-gh', '--no-retry', '--no-verify']);
  assert.throws(() => jobs.pipelineArgv('full', { rm: true }), (e) => e.status === 400 && /不支持的开关/.test(e.message));
  /* 值为 false 的开关直接忽略（前端把开关都传过来也不会误加参数） */
  assert.deepEqual(jobs.pipelineArgv('build', { noBuild: false }).slice(3), []);
});

/* ═══════════ 正常跑完 ═══════════ */

test('作业跑完：步骤状态、日志文件、增量读都对', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_OK);
  assert.equal(jobs.isBusy(), true, '刚起应该算忙');

  const done = await jobs._waitFor(id);
  assert.equal(done.state, 'done');
  assert.equal(done.exitCode, 0);
  assert.equal(done.ok, true);
  assert.deepEqual(done.steps.map((s) => `${s.id}:${s.state}`), ['build:ok', 'prep:ok']);
  assert.deepEqual(done.domains, ['www.jinsuper.cn']);
  assert.deepEqual(done.changed, ['p/docs.html']);
  assert.equal(jobs.isBusy(), false);

  /* 日志：既有人类可读的步骤标记，也有子进程原样输出 */
  const log = fs.readFileSync(done.logFile, 'utf8');
  assert.match(log, /▶ 构建/);
  assert.match(log, /✓ 构建 · 1\.2s/);
  assert.match(log, /文档站构建 · 预渲染 \+ 本地化/);
  assert.match(log, /新增 1 · 更新 5 · 未变 1311/);
  assert.match(log, /── 全部完成/);

  /* 增量读：从 0 读一段，再从 nextOffset 接着读，拼起来正好是全文 */
  const a = jobs.readLog(id, 0);
  assert.ok(a.chunk.length > 0);
  assert.equal(a.eof, true);
  const b = jobs.readLog(id, a.nextOffset);
  assert.equal(b.chunk, '');
  assert.equal(b.nextOffset, a.nextOffset);

  /* 偏移是**字节**偏移：从中间任意位置接着读，拿到的必须是同位置之后的内容 */
  const full = fs.readFileSync(done.logFile);
  const half = Math.floor(a.nextOffset / 2);
  const partial = jobs.readLog(id, half);
  assert.equal(partial.nextOffset, full.length);
  assert.equal(partial.chunk, full.subarray(half).toString('utf8'));
});

test('作业失败：state=failed、stderr 也进日志、done.ok=false', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_FAIL);
  const done = await jobs._waitFor(id);

  assert.equal(done.state, 'failed');
  assert.equal(done.exitCode, 1);
  assert.equal(done.ok, false);
  assert.equal(done.steps.find((s) => s.id === 'prep').state, 'fail');
  const log = fs.readFileSync(done.logFile, 'utf8');
  assert.match(log, /✗ 组装 dist\/ 失败/);
  assert.match(log, /组装失败：磁盘满了/, 'stderr 也要落到日志里');
  assert.match(log, /── 结束（退出码 1）/);
});

/* ═══════════ 单飞 / 中止 ═══════════ */

test('单飞：有作业在跑时再起一个 → 409', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_SLOW);
  try {
    assert.throws(() => runFake(FAKE_OK), (e) => e.status === 409 && /已经有一个作业在跑/.test(e.message));
  } finally {
    jobs.stopJob(id);
    await jobs._waitFor(id, 10000).catch(() => { /* 强杀可能让状态最终由 close 事件更新 */ });
  }
});

test('中止：SIGINT + 强杀之后作业不再是 running', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_SLOW);
  const r = jobs.stopJob(id);
  assert.equal(r.ok, true);

  const settled = await jobs._waitFor(id, 10000);
  assert.notEqual(settled.state, 'running');
});

test('中止一个不存在的作业 → 404', () => {
  assert.throws(() => jobs.stopJob('不存在'), (e) => e.status === 404);
});

/* ═══════════ 列表 / 持久化 ═══════════ */

test('作业列表：最新在前，带状态与日志字节数', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_OK);
  await jobs._waitFor(id);
  const list = jobs.listJobs();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  assert.equal(list[0].state, 'done');
  assert.ok(list[0].logBytes > 0);
  assert.ok(fs.existsSync(path.join(process.env.DSH_CONSOLE_STATE_DIR, 'jobs.json')));
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DSH_CONSOLE_STATE_DIR, 'jobs.json'), 'utf8'));
  assert.equal(saved.jobs[0].id, id);
});

test('控制台重启后：上次还在跑的作业标成 unknown（而不是假装还在跑）', async () => {
  jobs._resetForTest();
  const { id } = runFake(FAKE_SLOW);
  /* 直接把 jobs.json 改成像"上次崩了"的样子，再重新 import 一次模块 */
  const file = path.join(process.env.DSH_CONSOLE_STATE_DIR, 'jobs.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.jobs[0].state, 'running');

  jobs.stopJob(id);
  await jobs._waitFor(id, 10000).catch(() => {});

  /* 造一条 running 记录（模拟断电），再重新加载 */
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.jobs.unshift({ id: 'stale-1', label: '上次没跑完', pipeline: 'full', state: 'running', startedAt: Date.now() });
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  const mod = '../lib/jobs.mjs?reload=' + Date.now();
  const reloaded = await import(mod);
  const stale = reloaded.listJobs().find((j) => j.id === 'stale-1');
  assert.equal(stale.state, 'unknown');
});
