'use strict';
/**
 * test/origins.test.cjs —— 来源表 / 回落链 / 本地服务路径归一
 * 纯逻辑，不需要 Electron，`npm test` 就能跑。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  DEFAULT_ORIGIN,
  DEFAULT_SETTINGS,
  ORIGINS,
  NAV,
  getOrigin,
  normalizeSettings,
  buildChain,
  originUrl,
  matchOrigin,
} = require('../src/origins.js');

const { resolveFile, mimeOf } = require('../src/local-server.js');

test('默认来源是主站，两档回落默认开着', () => {
  assert.strictEqual(DEFAULT_ORIGIN, 'cn');
  assert.strictEqual(DEFAULT_SETTINGS.originId, 'cn');
  assert.strictEqual(DEFAULT_SETTINGS.autoFallback, true);
  assert.strictEqual(DEFAULT_SETTINGS.offlineFallback, true);
});

test('来源表：四个来源，id 唯一，云端都有 https 根地址', () => {
  assert.strictEqual(ORIGINS.length, 4);
  const ids = ORIGINS.map((o) => o.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const o of ORIGINS) {
    if (o.id === 'local') continue;
    assert.match(o.url, /^https:\/\/[^/]+$/, `${o.id} 必须是站点根地址`);
  }
});

test('默认回落链：主站 → 热铁盒 → GitHub → 离线副本', () => {
  assert.deepStrictEqual(buildChain(DEFAULT_SETTINGS), ['cn', 'rth', 'gh', 'local']);
});

test('指定来源永远排第一', () => {
  assert.deepStrictEqual(buildChain(DEFAULT_SETTINGS, 'gh'), ['gh', 'cn', 'rth', 'local']);
});

test('关掉「云端互相顶替」：只试选中的那个，再退离线副本', () => {
  const s = normalizeSettings({ originId: 'rth', autoFallback: false });
  assert.deepStrictEqual(buildChain(s), ['rth', 'local']);
});

test('关掉「离线副本」：云端之间还能顶替，但不落到本地', () => {
  const s = normalizeSettings({ offlineFallback: false });
  assert.deepStrictEqual(buildChain(s), ['cn', 'rth', 'gh']);
});

test('两档都关：只试用户选的那一个', () => {
  const s = normalizeSettings({ autoFallback: false, offlineFallback: false });
  assert.deepStrictEqual(buildChain(s), ['cn']);
});

test('选了离线副本就只走本地（明确选了离线，别再跳回云端）', () => {
  const s = normalizeSettings({ originId: 'local' });
  assert.deepStrictEqual(buildChain(s), ['local']);
  assert.deepStrictEqual(buildChain(s, 'gh'), ['gh', 'cn', 'rth', 'local']);
});

test('normalizeSettings：坏字段一律回落默认值', () => {
  const s = normalizeSettings({
    originId: '不存在的来源',
    autoFallback: 'yes',
    offlineFallback: 0,
    zoom: 99,
    bounds: { width: 10, height: 'x' },
  });
  assert.strictEqual(s.originId, 'cn');
  assert.strictEqual(s.autoFallback, true);
  assert.strictEqual(s.offlineFallback, true);
  assert.strictEqual(s.zoom, 1);
  assert.strictEqual(s.bounds, null);
});

test('normalizeSettings：留得住的缩放与窗口尺寸', () => {
  const s = normalizeSettings({
    zoom: 1.25,
    bounds: { x: 100.4, y: 50.6, width: 1280.2, height: 800.9, maximized: 1 },
  });
  assert.strictEqual(s.zoom, 1.25);
  assert.deepStrictEqual(s.bounds, { x: 100, y: 51, width: 1280, height: 801, maximized: true });
});

test('originUrl：云端直接用表里的地址，本地要现场给端口', () => {
  assert.strictEqual(originUrl('cn'), 'https://www.jinsuper.cn');
  assert.strictEqual(originUrl('local', 'http://127.0.0.1:51234/'), 'http://127.0.0.1:51234');
  assert.throws(() => originUrl('local'));
});

test('matchOrigin：四个来源都认得出来，外站返回 null', () => {
  assert.strictEqual(matchOrigin('https://www.jinsuper.cn/class/index.html'), 'cn');
  assert.strictEqual(matchOrigin('https://jinsuper.rth1.xyz/'), 'rth');
  assert.strictEqual(matchOrigin('https://jinsuperofficial.github.io/p/'), 'gh');
  assert.strictEqual(matchOrigin('http://127.0.0.1:53421/class/index.html'), 'local');
  assert.strictEqual(matchOrigin('https://example.com/'), null);
  assert.strictEqual(matchOrigin('file:///tmp/x.html'), null);
  assert.strictEqual(matchOrigin('乱写的'), null);
});

test('导航项都是站点根绝对路径', () => {
  assert.ok(NAV.length >= 4);
  for (const n of NAV) {
    assert.match(n.path, /^\//, `${n.id} 的路径要以 / 开头`);
    assert.ok(n.label && n.id);
  }
});

test('本地服务：路径归一不许越界', () => {
  const root = '/tmp/site';
  assert.strictEqual(resolveFile(root, '/index.html'), path.join(root, 'index.html'));
  assert.strictEqual(resolveFile(root, '/'), path.join(root, 'index.html'));
  assert.strictEqual(resolveFile(root, '/class/%E4%BD%9C%E4%B8%9A.html'), path.join(root, 'class', '作业.html'));
  assert.strictEqual(resolveFile(root, '/a/b/../c.html'), path.join(root, 'a', 'c.html'));
  // 带 ../ 的请求会被按站点根夹住，绝不会跑到 root 外面去
  for (const evil of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/a/../../../../etc/passwd']) {
    const got = resolveFile(root, evil);
    assert.ok(got === null || got.startsWith(root + path.sep), `${evil} 跑出去了：${got}`);
    assert.notStrictEqual(got, '/etc/passwd');
  }
});

test('本地服务：常见后缀有对的 MIME', () => {
  assert.match(mimeOf('a.html'), /^text\/html/);
  assert.match(mimeOf('a.JSON'), /^application\/json/);
  assert.match(mimeOf('a.mp3'), /^audio\/mpeg/);
  assert.strictEqual(mimeOf('a.未知'), 'application/octet-stream');
});

test('getOrigin：认不出的 id 回落到主站', () => {
  assert.strictEqual(getOrigin('gh').host, 'jinsuperofficial.github.io');
  assert.strictEqual(getOrigin('???').id, 'cn');
});
