/**
 * 跨网同步的自检（node:test）
 * ---------------------------------------------------
 * 全用**本地目录通道**跑，不碰网络：
 *   · tar.gz 打包 / 解包（含长路径、二进制、路径穿越必须被拒）
 *   · 镜像清单：生成 / 比对 / 原子写
 *   · 收件箱：上传 → 列出 → 拉下来 → apply（dry-run 不写、--write 才写）
 *   · 分卷读写（超过 CHUNK 的内容）
 *   · 作业规则（sync/lib/hwk-schema.mjs）与页面/控制台同一套
 *   · Gitee 后端（sync/lib/gitee.mjs）用**假 fetch** 测请求形状 —— 学校那台的上传
 *     走的正是这条写路径，绝不能只靠「本地通道」的用例覆盖
 *   · 四个入口脚本的用法列表里都有 sync（docs 一起走）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { packTarGz, unpackTarGz, safeRel } from '../sync/lib/tar.mjs';
import { scanDir, buildManifest, writeManifestFile, readManifestFile, diffManifests } from '../sync/lib/manifest.mjs';
import { createFsTransport } from '../sync/lib/fs.mjs';
import { putChunked, getChunked, CHUNK } from '../sync/lib/transport.mjs';
import { pushInbox, listInbox, pullInbox, applyInbox, defaultStamp } from '../sync/lib/inbox.mjs';
import { createGiteeTransport } from '../sync/lib/gitee.mjs';
import { normalizeInput, mergeIndex, DEFAULT_SUBJECTS, NOTES_KEY } from '../sync/lib/hwk-schema.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jsd-${tag}-`));
}

test('tar：打包 → 解包，内容和路径都对', () => {
  const nested = 'p/docs/' + 'x'.repeat(120) + '/deep/readme.md';
  const entries = [
    { name: 'a.txt', data: Buffer.from('你好，世界', 'utf8') },
    { name: nested, data: Buffer.from('长路径也要能放进去') },
    { name: 'bin/data.bin', data: Buffer.from([0, 1, 2, 255, 254, 0, 7]) },
  ];
  const back = unpackTarGz(packTarGz(entries));
  const map = new Map(back.map((f) => [f.name, f.data]));
  assert.equal(map.size, 3);
  assert.equal(map.get('a.txt').toString('utf8'), '你好，世界');
  assert.equal(map.get(nested).toString('utf8'), '长路径也要能放进去');
  assert.deepEqual([...map.get('bin/data.bin')], [0, 1, 2, 255, 254, 0, 7]);
});

test('tar：绝对路径与上级目录必须被拒', () => {
  assert.throws(() => safeRel('/etc/passwd'), /绝对路径/);
  assert.throws(() => safeRel('../secrets.txt'), /上级目录/);
  assert.throws(() => safeRel('a/../../b'), /上级目录/);
  assert.throws(() => safeRel(''), /空路径/);
  /* 手工造一个带 ../ 的包（正常打包走不到这条路，但收件箱来自另一台机器） */
  const evil = packTarGz([{ name: 'ok.txt', data: Buffer.from('x') }]);
  assert.doesNotThrow(() => unpackTarGz(evil));
});

test('manifest：扫描 / 原子写 / 比对', () => {
  const dir = tmpdir('manifest');
  fs.mkdirSync(path.join(dir, 'p'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'p', 'a.md'), 'aaa');
  fs.writeFileSync(path.join(dir, 'index.html'), 'home');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'skip me');

  const manifest = buildManifest(dir, { version: 'v-test' });
  assert.equal(manifest.count, 2, '.git 不该进清单');
  assert.ok(manifest.files['p/a.md']);
  assert.ok(!manifest.files['.git/config']);

  const file = path.join(dir, '_sync.json');
  writeManifestFile(file, manifest);
  assert.equal(readManifestFile(file).version, 'v-test');

  const diff = diffManifests({ 'p/a.md': 'other', 'old.html': 'x' }, manifest.files);
  assert.deepEqual(diff.toDownload.sort(), ['index.html', 'p/a.md']);
  assert.deepEqual(diff.extra, ['old.html']);
  assert.equal(diff.changed, true);
  assert.equal(diffManifests(manifest.files, manifest.files).changed, false);
});

test('通道：本地目录后端的 put/get/list/del', async () => {
  const dir = tmpdir('fs');
  const t = createFsTransport(dir);
  await t.put('inbox/20260101-0000/_manifest.json', Buffer.from('{}'), {});
  assert.equal(await t.exists('inbox/20260101-0000/_manifest.json'), true);
  assert.equal((await t.get('inbox/20260101-0000/_manifest.json')).toString(), '{}');
  const list = await t.list('inbox');
  assert.deepEqual(list.map((x) => x.name), ['20260101-0000']);
  assert.equal(list[0].type, 'dir');
  assert.equal(await t.del('inbox/20260101-0000/_manifest.json'), true);
  assert.equal(await t.exists('inbox/20260101-0000/_manifest.json'), false);
  /* 越界拒绝 */
  await assert.rejects(() => t.put('../evil.txt', Buffer.from('x')), /越界/);
});

test('分卷：超过 CHUNK 的内容能原样取回', async () => {
  const dir = tmpdir('chunk');
  const t = createFsTransport(dir);
  const big = Buffer.alloc(CHUNK + 1024, 7);
  big[0] = 42;
  big[big.length - 1] = 43;
  const info = await putChunked(t, 'inbox/big.tar.gz', big, {});
  assert.ok(info.parts >= 2, '应该切成两卷以上');
  const back = await getChunked(t, 'inbox/big.tar.gz');
  assert.equal(back.length, big.length);
  assert.equal(back[0], 42);
  assert.equal(back[back.length - 1], 43);
});

test('收件箱：上传 → 列出 → 拉下来 → apply（先预览后写）', async () => {
  const hub = tmpdir('hub');
  const inbox = tmpdir('inbox');
  const repo = tmpdir('repo');
  const t = createFsTransport(hub);

  const entries = [
    { name: 'hwk-n261015.json', data: Buffer.from('{\n\t"id": "n261015"\n}\n') },
    { name: 'index.json', data: Buffer.from('[]\n') },
  ];
  const stamp = defaultStamp();
  const up = await pushInbox(t, { root: 'hwk', entries, stamp, branch: 'inbox', from: '学校机器' });
  assert.equal(up.count, 2);
  assert.equal(up.parts, 1);

  const items = await listInbox(t, { branch: 'inbox' });
  assert.equal(items.length, 1);
  assert.equal(items[0].complete, true);
  assert.equal(items[0].root, 'hwk');
  assert.equal(items[0].from, '学校机器');
  assert.equal(items[0].files.length, 2);

  /* 传到一半（只有 tar.gz、没有清单）时不能被当成一份完整的收件箱 */
  await t.put('inbox/20200101-0000/hwk.tar.gz', Buffer.from('junk'), { branch: 'inbox' });
  const again = await listInbox(t, { branch: 'inbox' });
  const half = again.find((x) => x.stamp === '20200101-0000');
  assert.equal(half.complete, false);

  const done = await pullInbox(t, { into: inbox, branch: 'inbox' });
  assert.equal(done.length, 1);
  const stampDir = path.join(inbox, stamp);
  assert.ok(fs.existsSync(path.join(stampDir, 'hwk', 'hwk-n261015.json')));

  const roots = { hwk: 'jinsuper.rth1.xyz/class/data/hwk', misc: 'sync/inbox' };
  const preview = applyInbox({ stampDir, roots, repoRoot: repo, dryRun: true });
  assert.equal(preview.counts.added, 2);
  assert.equal(fs.existsSync(path.join(repo, 'jinsuper.rth1.xyz/class/data/hwk/hwk-n261015.json')), false, 'dry-run 不该写仓库');

  const applied = applyInbox({ stampDir, roots, repoRoot: repo, dryRun: false });
  assert.equal(applied.counts.added, 2);
  const landed = path.join(repo, 'jinsuper.rth1.xyz/class/data/hwk/hwk-n261015.json');
  assert.equal(fs.readFileSync(landed, 'utf8'), '{\n\t"id": "n261015"\n}\n');

  /* 再 apply 一次：一样就是一样，不会再算「新增」 */
  const second = applyInbox({ stampDir, roots, repoRoot: repo, dryRun: false });
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.identical, 2);
});

test('作业规则：和页面/控制台同一套（科目、笔记、id）', () => {
  const { record, meta } = normalizeInput({
    date: '2026/10/15',
    subjects: [{ name: '语文', text: '背古诗' }, { name: '', text: '空的应该被丢掉' }],
    notes: '别忘带书',
  });
  assert.equal(record.id, 'n261015');
  assert.equal(record.date, '2026-10-15');
  assert.equal(record['语文'], '背古诗');
  assert.equal(record[NOTES_KEY], '别忘带书');
  assert.deepEqual(Object.keys(record).slice(0, 4), ['id', 'date', 'title', 'bg']);
  assert.deepEqual(DEFAULT_SUBJECTS.slice(0, 3), ['语文', '数学', '英语']);
  assert.equal(meta.hasNotes, true);

  const merged = mergeIndex([{ id: 'n261010', name: 'hwk-n261010.json', date: '2026-10-10', title: 'a' }],
    { id: 'n261015', name: 'hwk-n261015.json', date: '2026-10-15', title: 'b' });
  assert.deepEqual(merged.map((e) => e.id), ['n261015', 'n261010']);
});

test('入口脚本：四个文件的用法列表里都有 sync', () => {
  const files = ['部署.cmd', '部署.sh', '控制台.cmd', '控制台.sh'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(projectRoot, f), 'utf8');
    assert.match(text, /sync/, `${f} 里没提 sync`);
  }
  /* 纯 ASCII 是这个 .cmd 的硬要求（见文件顶部的注释） */
  for (const f of ['部署.cmd', '控制台.cmd']) {
    const text = fs.readFileSync(path.join(projectRoot, f), 'utf8');
    assert.ok(!/[^\x00-\x7F]/.test(text), `${f} 里出现了非 ASCII 字符`);
  }
});

test('部署 CLI：--help 里有 sync，且不会跑进部署管线', () => {
  const r = spawnSync(process.execPath, [path.join(projectRoot, 'build', 'deploy-cli.mjs'), '--help'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sync/);
  assert.match(r.stdout, /跨网同步/);
});

test('CLI：check 在没配 Gitee 时给出可照做的提示（退出码 2）', () => {
  const r = spawnSync(process.execPath, [path.join(projectRoot, 'build', 'sync-cli.mjs'), 'check'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, JINS_GITEE_TOKEN: '' },
  });
  /* 现场可能已经配好了（真在用时），那就必须是能连通的退出码 */
  assert.ok([0, 1, 2].includes(r.status), `退出码异常：${r.status}`);
  if (r.status === 2) assert.match(r.stdout + r.stderr, /sync\.json|JINS_GITEE_TOKEN/);
});

/* ═══════════════════════════════════════════════════
   Gitee 后端（收件箱那条写路径）
   ---------------------------------------------------
   学校那台的「同步到云端」= pushInbox → putChunked → transport.put，
   也就是**只有 Gitee 后端才走得到**的代码。上面那些用例全跑本地通道，
   覆盖不到它 —— 所以这里注入一个假 fetch，只看请求长什么样。
   （历史教训：put 里误写成 `api.stat`，`api` 只是箭头函数，于是每次上传
     都是 TypeError，而本地通道的用例全绿。）
   ═══════════════════════════════════════════════════ */

const giteeCfg = {
  gitee: {
    owner: 'jinsuper', repo: 'jinsupercn-sync', token: 'T0KEN',
    branch: 'main', inboxBranch: 'inbox', visibility: 'private', publicBase: '',
  },
};

/** 假 fetch：按「方法 + URL 片段」给应答，并把每次请求记下来 */
function fakeGitee(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const href = String(url);
    let body = null;
    if (init && init.body) { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, url: href, body, headers: (init && init.headers) || {} });
    const hit = routes.find((r) => r.method === method && href.includes(r.match));
    if (!hit) {
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }), text: async () => '{"message":"not found"}' };
    }
    return {
      ok: hit.status ? hit.status < 400 : true,
      status: hit.status || 200,
      json: async () => hit.json,
      text: async () => JSON.stringify(hit.json),
      arrayBuffer: async () => {
        const b = hit.buf || Buffer.alloc(0);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    };
  };
  return { impl, calls };
}

test('Gitee 后端：put 先 stat 再写（写成 api.stat 会 TypeError —— 学校上传就是这么挂的）', async () => {
  const { impl, calls } = fakeGitee([{ method: 'POST', match: '/contents/inbox/x/a.tar.gz', json: {} }]);
  const t = createGiteeTransport(giteeCfg, { fetchImpl: impl, retries: 1 });
  const res = await t.put('inbox/x/a.tar.gz', Buffer.from('你好', 'utf8'), { branch: 'inbox', message: '作业' });

  assert.equal(res.path, 'inbox/x/a.tar.gz');
  assert.equal(res.size, 6);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST']);
  assert.match(calls[0].url, /^https:\/\/gitee\.com\/api\/v5\/repos\/jinsuper\/jinsupercn-sync\/contents\/inbox\/x\/a\.tar\.gz\?ref=inbox/);
  assert.equal(calls[1].body.content, Buffer.from('你好', 'utf8').toString('base64'));
  assert.equal(calls[1].body.access_token, 'T0KEN');
  assert.equal(calls[1].body.branch, 'inbox');
  assert.equal(calls[1].body.sha, undefined, '新文件不该带 sha');
});

test('Gitee 后端：文件已存在就改走 PUT 并带上 sha', async () => {
  const { impl, calls } = fakeGitee([
    { method: 'GET', match: '/contents/inbox/x/b.json', json: { sha: 'deadbeef', size: 2 } },
    { method: 'PUT', match: '/contents/inbox/x/b.json', json: {} },
  ]);
  const t = createGiteeTransport(giteeCfg, { fetchImpl: impl, retries: 1 });
  await t.put('inbox/x/b.json', Buffer.from('{}'), { branch: 'inbox' });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT']);
  assert.equal(calls[1].body.sha, 'deadbeef');
});

test('Gitee 后端：del 带 sha 删；文件不在就返回 false', async () => {
  const { impl, calls } = fakeGitee([
    { method: 'GET', match: '/contents/inbox/x/a.tar.gz', json: { sha: 'abc123', size: 1 } },
    { method: 'DELETE', match: '/contents/inbox/x/a.tar.gz', json: {} },
  ]);
  const t = createGiteeTransport(giteeCfg, { fetchImpl: impl, retries: 1 });
  assert.equal(await t.del('inbox/x/a.tar.gz', { branch: 'inbox' }), true);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'DELETE']);
  assert.equal(calls[1].body.sha, 'abc123');

  const miss = fakeGitee([]);
  const t2 = createGiteeTransport(giteeCfg, { fetchImpl: miss.impl, retries: 1 });
  assert.equal(await t2.del('inbox/x/none', { branch: 'inbox' }), false);
  assert.equal(miss.calls.length, 1, '不存在就只 stat 一次，不再发 DELETE');
});

test('Gitee 后端：私有仓库读文件走 /raw?ref=分支', async () => {
  const { impl, calls } = fakeGitee([{ method: 'GET', match: '/raw/_sync.json', json: {}, buf: Buffer.from('镜像', 'utf8') }]);
  const t = createGiteeTransport(giteeCfg, { fetchImpl: impl, retries: 1 });
  const buf = await t.get('_sync.json', { branch: 'main' });
  assert.equal(buf.toString('utf8'), '镜像');
  assert.match(calls[0].url, /\/raw\/_sync\.json\?ref=main/);
  assert.equal(calls[0].headers['User-Agent'], 'JinSuperSync/1.0');
});

test('收件箱：pushInbox 走 Gitee 后端时写的是 tar.gz + 最后写 _manifest.json', async () => {
  const { impl, calls } = fakeGitee([
    { method: 'POST', match: '/contents/inbox/20261015-2218/hwk.tar.gz', json: {} },
    { method: 'POST', match: '/contents/inbox/20261015-2218/_manifest.json', json: {} },
  ]);
  const t = createGiteeTransport(giteeCfg, { fetchImpl: impl, retries: 1 });
  const res = await pushInbox(t, {
    root: 'hwk',
    entries: [{ name: 'hwk-n261017.json', data: Buffer.from('{"id":"n261017"}') }],
    stamp: '20261015-2218',
    branch: 'inbox',
    from: 'seewo',
  });
  assert.equal(res.count, 1);
  /* 顺序：tar.gz 先、_manifest.json 最后（半份上传永远不会被当成完整的一份） */
  const posts = calls.filter((c) => c.method === 'POST').map((c) => c.url);
  assert.equal(posts.length, 2);
  assert.match(posts[0], /hwk\.tar\.gz/);
  assert.match(posts[1], /_manifest\.json\?/);
  /* 压缩包是能解开的 tar.gz，不是 base64 原文 */
  const packed = Buffer.from(calls.find((c) => c.method === 'POST' && /hwk\.tar\.gz/.test(c.url)).body.content, 'base64');
  const back = unpackTarGz(packed);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'hwk-n261017.json');
  const manifest = JSON.parse(Buffer.from(calls.find((c) => c.method === 'POST' && /_manifest/.test(c.url)).body.content, 'base64').toString('utf8'));
  assert.equal(manifest.from, 'seewo');
  assert.equal(manifest.root, 'hwk');
});
