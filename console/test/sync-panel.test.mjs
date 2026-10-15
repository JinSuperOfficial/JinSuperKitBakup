/**
 * 跨网同步面板验收（node:test）
 * ---------------------------------------------------
 * 这一份不搭 fixture：它盯的是「面板这条线接上了没有」——
 *   · 服务端路由表里有那 5 条 sync 路由（`/api/sync/check` 刻意不单开，
 *     「检查」就是再拉一次 GET /api/sync）；
 *   · lib/api.mjs 真的导出了那 5 个函数；
 *   · 前端有 tab-sync / panel-sync，而且确实在调 /api/sync；
 *   · 最要紧的一条：**配置不全时 getSyncState() 不能抛异常**。
 *     现在的仓库 `sync.json` 里 gitee.owner 是空的、.env 里也没有令牌，
 *     面板要拿到 {ok:false, error, problems} 才能把「去哪儿配」显示出来；
 *     要是这里抛了，界面上就是一个白屏 + 一个 500。
 *
 * 跑法：node console/test/sync-panel.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(here, '..');
const projectRoot = path.resolve(consoleDir, '..');
const read = (rel) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const serverSrc = read('console/server.mjs');
const htmlSrc = read('console/web/index.html');
const appSrc = read('console/web/app.js');

const SYNC_ROUTES = [
  'GET /api/sync',
  'POST /api/sync/pull',
  'POST /api/sync/apply',
  'POST /api/sync/upload',
  'POST /api/sync/push',
];

/* ═══════════ 1. 服务端路由 ═══════════ */

test('1. 服务端 ROUTES 里有 5 条 sync 路由，且没有多余的 /api/sync/check', () => {
  for (const route of SYNC_ROUTES) {
    assert.ok(
      serverSrc.includes(`'${route}'`),
      `console/server.mjs 的路由表里少了 '${route}'`,
    );
  }
  /* 「检查」复用 GET /api/sync：别多造一条路由，前端重新拉一次就够 */
  assert.ok(!serverSrc.includes("'/api/sync/check'"), '不该有 /api/sync/check（检查就是重新 GET /api/sync）');
  /* 5 条都应该是挂到 api 上的，别写成空实现 */
  for (const route of SYNC_ROUTES) {
    assert.match(serverSrc, new RegExp(`'${route.replace(/[/]/g, '\\/')}':\\s*\\(`), `${route} 没有挂在路由表上`);
  }
});

/* ═══════════ 2. API 导出 ═══════════ */

test('2. lib/api.mjs 导出了 5 个 sync 函数（都是函数）', async () => {
  const api = await import('../lib/api.mjs');
  for (const name of ['getSyncState', 'postSyncPull', 'postSyncApply', 'postSyncUpload', 'postSyncPush']) {
    assert.equal(typeof api[name], 'function', `api.mjs 没导出函数 ${name}`);
  }
});

/* ═══════════ 3. 前端骨架 ═══════════ */

test('3. index.html 里有 tab-sync 与 panel-sync（并在导航里成对出现）', () => {
  assert.match(htmlSrc, /id="tab-sync"/, 'index.html 少了 tab-sync');
  assert.match(htmlSrc, /id="panel-sync"/, 'index.html 少了 panel-sync');
  assert.match(htmlSrc, /data-view="sync"/, 'tab-sync 没有 data-view="sync"');
  assert.match(htmlSrc, /aria-controls="panel-sync"/, 'tab-sync 没有 aria-controls="panel-sync"');
  assert.match(htmlSrc, /aria-labelledby="tab-sync"/, 'panel-sync 没有 aria-labelledby="tab-sync"');
  /* 位置：紧挨「发布与部署」（先 deploy 后 sync，再 cloud） */
  const iDeploy = htmlSrc.indexOf('id="panel-deploy"');
  const iSync = htmlSrc.indexOf('id="panel-sync"');
  const iCloud = htmlSrc.indexOf('id="panel-cloud"');
  assert.ok(iDeploy >= 0 && iSync > iDeploy && iCloud > iSync, 'panel-sync 应该夹在 panel-deploy 和 panel-cloud 之间');
});

test('4. app.js 里引用了 /api/sync，并且有 sync 视图的渲染入口', () => {
  assert.ok(appSrc.includes('/api/sync'), 'app.js 没有调 /api/sync');
  for (const p of ['/api/sync/pull', '/api/sync/apply', '/api/sync/upload', '/api/sync/push']) {
    assert.ok(appSrc.includes(p), 'app.js 没有调 ' + p);
  }
  assert.match(appSrc, /'sync'/, "VIEWS 里应该加上 'sync'");
  assert.match(appSrc, /function initSync\s*\(/, 'app.js 少了 initSync()');
  assert.match(appSrc, /function renderSync\s*\(/, 'app.js 少了 renderSync()');
  assert.match(appSrc, /initSync\(\);/, 'boot() 里没有调用 initSync()');
});

/* ═══════════ 5. 最要紧的一条：配置不全不白屏 ═══════════ */

test('5. 配置不全（sync.json 里 owner 为空）时 getSyncState() 不抛异常，返回 ok:false + problems', async () => {
  /* 先确认「现场」真的还没配：配了的话这条用例就换个说法（见下） */
  const cfgPath = path.join(projectRoot, 'sync.json');
  const cfg = JSON.parse(read('sync.json'));
  const owner = (cfg.gitee && cfg.gitee.owner) || '';
  const hasProblems = owner === '';   /* 没 owner 就一定算「配置不全」 */

  const api = await import('../lib/api.mjs');
  let r;
  await assert.doesNotReject(async () => { r = await api.getSyncState(); },
    '配置不全时 getSyncState() 不能抛 —— 抛了面板就是白屏 + 500');
  assert.ok(r && typeof r === 'object', 'getSyncState() 应该返回一个对象');
  assert.equal(r.ok, false, '配置不全必须是 ok:false');
  assert.ok(Array.isArray(r.problems), 'problems 必须是数组（前端照着它提示怎么配）');
  assert.ok(r.problems.length || r.error, 'ok:false 时必须带 problems 或 error');
  if (hasProblems) {
    assert.ok(r.problems.length > 0, 'sync.json 里 owner 是空的，problems 里就该说这一条');
    assert.match(r.problems.join('；'), /owner/, 'problems 应该点名 gitee.owner');
    assert.match(String(r.error), /还没配好|owner/, 'error 也该有一句人话');
  }
  /* 顺便确认没有副作用：只读状态不该写任何东西 */
  assert.equal(cfgPath.length > 0, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).gitee.owner, owner, 'getSyncState() 不该改 sync.json');
});
