/**
 * 发布控制台验收（node:test）
 * ---------------------------------------------------
 * 全程在一份**临时 fixture 站点**上跑：不动真实站点、不动真实 sk.json、
 * 也不会往项目根写 para/ —— 靠 DSH_CONSOLE_ROOT 把所有路径指到临时目录。
 *
 * 为什么必须有这层：归档会**移动和删除文件**。测试要敢覆盖覆盖/跳过/回滚
 * 这些破坏性路径，就不能拿真站点练手。
 *
 * 跑法：node console/test/console.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ═══════════ 搭 fixture（必须在 import 控制台模块之前设好根） ═══════════ */

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(here, '..');
const realBuild = path.resolve(consoleDir, '..', 'build');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-test-'));
process.env.DSH_CONSOLE_ROOT = root;
/* 状态文件也指到临时目录：测试会改设置、写归档元数据，
   不能让它落到人用的 console/state.json 上 */
const stateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'console-state-'));
process.env.DSH_CONSOLE_STATE_DIR = stateTmp;

const site = path.join(root, 'jinsuper.rth1.xyz');
const p = path.join(site, 'p');
const build = path.join(root, 'build');

fs.mkdirSync(path.join(p, 'idea'), { recursive: true });
fs.mkdirSync(path.join(p, 'asset'), { recursive: true });
fs.mkdirSync(path.join(build, 'lib'), { recursive: true });

/* 预渲染核心：直接复用真实实现（控制台就是靠它），fixture 里只放一份引用 */
fs.writeFileSync(path.join(build, 'package.json'), JSON.stringify({ name: 'fixture-build', private: true }, null, 2));
fs.copyFileSync(path.join(realBuild, 'lib', 'markdown.cjs'), path.join(build, 'lib', 'markdown.cjs'));
fs.copyFileSync(path.join(realBuild, 'lib', 'docs-card.cjs'), path.join(build, 'lib', 'docs-card.cjs'));
fs.mkdirSync(path.join(build, 'lib', 'vendor'), { recursive: true });
fs.copyFileSync(
  path.join(realBuild, 'lib', 'vendor', 'mdit-tab.cjs'),
  path.join(build, 'lib', 'vendor', 'mdit-tab.cjs'),
);
/* build/node_modules：用软链指到真实的那份，省得复制 200MB */
fs.symlinkSync(path.join(realBuild, 'node_modules'), path.join(build, 'node_modules'), 'junction');

const SK = {
  启程: { 启程篇: 'para/1SetUp.md', 测试文档: 'TEST.md' },
  奇思妙想: { 索引: 'idea/index.md' },
};
fs.writeFileSync(path.join(site, 'sk.json'), JSON.stringify(SK, null, 2) + '\n');

fs.mkdirSync(path.join(p, 'para'), { recursive: true });
fs.writeFileSync(path.join(p, 'para', '1SetUp.md'), '# 启程\n\n第一课。\n');
fs.writeFileSync(path.join(p, 'TEST.md'), [
  '# 语法测试稿',
  '',
  '行内公式 $E = mc^2$，块级公式：',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```js:line-numbers {2}',
  'const a = 1;',
  'const b = 2;',
  '```',
  '',
  '> [!NOTE] 自定义名字',
  '> 告示内容',
  '',
  '::: tip',
  '提示框内容',
  ':::',
  '',
  '::: tabs',
  '@tab:active 第一个',
  '面板一',
  '',
  '@tab 第二个',
  '面板二',
  ':::',
  '',
  '::: code-group',
  '```js [JavaScript]',
  'const x = 1;',
  '```',
  '```python [Python]',
  'x = 1',
  '```',
  ':::',
  '',
  '>! 这是折起来的剧透',
  '',
  '!!行内剧透!!',
  '',
  '[[toc]]',
  '',
  '<card link="idea/1.归途且慢.md" date="2026.9.27">归途，且慢</card>',
  '',
  '- [x] 做完了',
  '- [ ] 还没做',
  '',
  '脚注[^1]',
  '',
  '[^1]: 脚注正文',
  '',
].join('\n'));
fs.writeFileSync(path.join(p, 'idea', 'index.md'), [
  '# 索引',
  '',
  '想到什么写什么。',
  '',
  '<card link="idea/1.归途且慢.md">归途，且慢</card>',
  '',
].join('\n'));
fs.writeFileSync(path.join(p, 'idea', '1.归途且慢.md'), '# 归途，且慢\n\n夏夜。\n');
/* 没登记的临时稿：状态必须是「未发布」 */
fs.writeFileSync(path.join(p, 'draft-temp.md'), '# 临时稿\n\n还没想好放哪。\n');
/* 素材 */
fs.writeFileSync(path.join(p, 'asset', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
/* 构建产物：不该出现在文章列表里 */
fs.writeFileSync(path.join(p, 'docs.html'), '<!doctype html><title>阅读器外壳</title>');

/* ═══════════ 起服务（import 之后 paths 才会读到 DSH_CONSOLE_ROOT） ═══════════ */

const { listen, server } = await import('../server.mjs');

const PORT = 18791 + (process.pid % 500);
await new Promise((resolve, reject) => {
  server.once('error', reject);
  listen(PORT, '127.0.0.1', { open: false, quiet: true });
  server.once('listening', resolve);
});

const BASE = `http://127.0.0.1:${PORT}`;

async function call(method, url, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data };
}
const get = (u) => call('GET', u);
const post = (u, b) => call('POST', u, b);
const put = (u, b) => call('PUT', u, b);

test.after(() => {
  server.close();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* Windows 偶尔删不掉，无所谓 */ }
  try { fs.rmSync(stateTmp, { recursive: true, force: true }); } catch { /* 同上 */ }
});

/* ═══════════ 1. 基础 ═══════════ */

test('1. 状态与自检：核心就绪、统计正确', async () => {
  const st = await get('/api/state');
  assert.equal(st.status, 200);
  assert.equal(st.data.core.ok, true, '预渲染核心应该能加载');

  /* 期望值现场数：fixture 里 /p 下（不含 archive/、不含构建产物）的 .md */
  const mdFiles = [];
  (function walkMd(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name !== 'archive' && !e.name.startsWith('.')) walkMd(path.join(dir, e.name), r); }
      else if (/\.md$/i.test(e.name)) mdFiles.push(r);
    }
  })(p, '');
  assert.equal(st.data.stats.total, mdFiles.length, '文章数应等于盘上的 .md（' + mdFiles.join(', ') + '）');
  assert.ok(st.data.stats.unpublished >= 1, '临时稿应计入未发布');
  assert.deepEqual(st.data.groups.sort(), ['启程', '奇思妙想'].sort());

  const sc = await get('/api/selfcheck');
  assert.equal(sc.data.ok, true, JSON.stringify(sc.data.problems));
});

test('2. 扫描：构建产物不进列表、未登记显示未发布', async () => {
  const r = await get('/api/articles');
  const paths = r.data.articles.map((a) => a.path);
  assert.ok(!paths.includes('docs.html'), 'docs.html 是产物，不该被当文章列出来');

  const tmp = r.data.articles.find((a) => a.path === 'draft-temp.md');
  assert.equal(tmp.status, 'unpublished');
  assert.equal(tmp.draft, false, '没编辑过的未发布 ≠ 草稿');

  const reg = r.data.articles.find((a) => a.path === 'idea/index.md');
  assert.equal(reg.status, 'published');
  assert.equal(reg.group, '奇思妙想');
  assert.equal(reg.title, '索引');
});

/* ═══════════ 2. 写作（读写 / 草稿 / 发布） ═══════════ */

test('3. 读一篇：正文、状态、分组都对得上', async () => {
  const r = await get('/api/article?path=' + encodeURIComponent('idea/index.md'));
  assert.equal(r.status, 200);
  assert.ok(r.data.content.includes('想到什么写什么'));
  assert.equal(r.data.group, '奇思妙想');

  /* 站点绝对写法也要能读 */
  const r2 = await get('/api/article?path=' + encodeURIComponent('/p/idea/index.md'));
  assert.equal(r2.status, 200);
  assert.equal(r2.data.path, 'idea/index.md');
});

test('4. 保存草稿：写盘 + 进草稿状态，但不登记', async () => {
  const body = '# 临时稿\n\n改了一版，还没发布。\n';
  const r = await put('/api/article', { path: 'draft-temp.md', content: body });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(path.join(p, 'draft-temp.md'), 'utf8'), body);

  const list = await get('/api/articles');
  const a = list.data.articles.find((x) => x.path === 'draft-temp.md');
  assert.equal(a.draft, true, '编辑过就该是草稿');
  assert.equal(a.status, 'unpublished');
  assert.equal(list.data.stats.draft, 1);

  const sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.ok(!JSON.stringify(sk).includes('draft-temp'), '草稿不该进 sk.json');
});

test('5. 发布：登记进 sk.json，草稿标记清掉', async () => {
  const r = await put('/api/article', {
    path: 'draft-temp.md', content: '# 临时稿\n\n定稿了。\n', publish: true, group: '启程', title: '临时稿',
  });
  assert.equal(r.status, 200);

  const sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.equal(sk['启程']['临时稿'], 'draft-temp.md');

  const list = await get('/api/articles');
  const a = list.data.articles.find((x) => x.path === 'draft-temp.md');
  assert.equal(a.status, 'published');
  assert.equal(a.draft, false);
});

test('6. 新建 / 改名 / 移动分组 / 删除', async () => {
  const n = await post('/api/article/new', { path: '笔记/想法.md', title: '想法' });
  assert.equal(n.status, 200);
  assert.ok(fs.existsSync(path.join(p, '笔记', '想法.md')));

  const dup = await post('/api/article/new', { path: '笔记/想法.md' });
  assert.equal(dup.status, 409, '重名新建应该被拒');

  const rn = await post('/api/article/rename', { path: '笔记/想法.md', to: '想法-2.md' });
  assert.equal(rn.status, 200);
  assert.ok(fs.existsSync(path.join(p, '笔记', '想法-2.md')));

  await put('/api/article', { path: '笔记/想法-2.md', content: '# 想法\n', publish: true, group: '奇思妙想', title: '想法' });
  const mv = await post('/api/article/move', { path: '笔记/想法-2.md', group: '启程' });
  assert.equal(mv.status, 200);
  let sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.equal(sk['启程']['想法'], '笔记/想法-2.md');
  assert.ok(!sk['奇思妙想'] || !sk['奇思妙想']['想法'], '旧分组里不该还留着');

  const del = await post('/api/article/delete', { path: '笔记/想法-2.md' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(p, '笔记', '想法-2.md')));
  sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.ok(!JSON.stringify(sk).includes('想法-2'), '登记也该撤掉');
});

/* ═══════════ 3. 预览（渲染保真） ═══════════ */

test('7. 预览用服务端渲染核心，全部现代语法都在', async () => {
  const src = fs.readFileSync(path.join(p, 'TEST.md'), 'utf8');
  const r = await post('/api/preview', { content: src });
  assert.equal(r.status, 200);
  const h = r.data.html;

  const checks = [
    ['KaTeX 行内/块级', /class="katex/],
    ['代码高亮', /class="hljs/],
    ['行号', /with-lines|show-lines/],
    ['高亮指定行', /class="cl hl"/],
    ['GitHub 告示', /markdown-alert markdown-alert-note/],
    ['告示自定义名字', /自定义名字/],
    ['提示框', /md-box md-box-tip/],
    ['选项卡', /tabs-tabs-wrapper/],
    ['选项卡 ARIA', /role="tablist"/],
    ['代码组', /class="code-group"/],
    ['剧透块', /md-spoiler/],
    ['行内剧透', /class="spoiler"/],
    ['目录', /md-toc/],
    ['卡片', /class="card"/],
    ['任务列表', /type="checkbox"/],
    ['脚注', /footnote/],
  ];
  for (const [name, re] of checks) assert.ok(re.test(h), name + ' 丢了');
});

/* ═══════════ 4. 归档 / 重建 / 回滚 / 取消归档 ═══════════ */

let archivedRel = null;

test('8. 归档：原文搬走、产物落 /p/archive、sk.json 改指向', async () => {
  const src = fs.readFileSync(path.join(p, 'idea', 'index.md'), 'utf8');
  const r = await post('/api/archive', { paths: ['idea/index.md'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rec = r.data.archived[0];
  archivedRel = rec.output;
  assert.equal(archivedRel, 'archive/idea/index.html', 'output 用 /p 相对写法');
  assert.equal(rec.sitePath, 'p/archive/idea/index.html', 'sitePath 是站点根相对，算 URL 时用');

  /* 原文不在 /p 了，留底目录里有 */
  assert.ok(!fs.existsSync(path.join(p, 'idea', 'index.md')), '/p 下不该再留着原文');
  const paraFile = path.join(root, 'para', 'idea', 'index.md');
  assert.ok(fs.existsSync(paraFile), '留底目录应该有原文（保持相对结构）');
  assert.equal(fs.readFileSync(paraFile, 'utf8'), src);

  /* 产物存在且是自包含的成品 */
  const outAbs = path.join(p, archivedRel);
  assert.ok(fs.existsSync(outAbs));
  const html = fs.readFileSync(outAbs, 'utf8');
  assert.ok(html.includes('class="md"'), '产物正文要包在 .md 里，阅读器才能内联');
  assert.ok(html.includes('docs-md.css'));
  assert.ok(!/<script[^>]+https?:/.test(html), '产物不能带 CDN');
  assert.ok(html.includes('class="card"'), '卡片语法要在预渲染时展开');

  /* 登记必须用 sk.json 的约定：相对 /p（不能带 p/ 前缀，否则构建会拼成 p/p/…） */
  const sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.equal(sk['奇思妙想']['索引（归档）'], 'archive/idea/index.html');
  assert.ok(!/^p\//.test(sk['奇思妙想']['索引（归档）']), 'sk.json 的值不能带 p/ 前缀');
  assert.equal(sk['奇思妙想']['索引'], undefined);

  /* 面板状态：归档产物（.html）也在这个列表里，路径是 /p 相对 */
  const list = await get('/api/articles');
  const a = list.data.articles.find((x) => x.path === archivedRel);
  assert.ok(a, '归档产物应该在文章列表里（' + archivedRel + '）');
  assert.equal(a.status, 'archived');
  assert.equal(a.isArchive, true);
  /* sk.json 里登记的是站点根相对写法，列表里也认它 */
  assert.ok(findByPathForTest(list.data.articles, rec.sitePath), '站点根相对写法也要能定位到同一篇');
  const ar = await get('/api/archive');
  assert.equal(ar.data.archived.length, 1);
  assert.equal(ar.data.archived[0].originalExists, true);
  assert.equal(ar.data.archived[0].title, '索引');
});

/** 列表里按任一种写法找一篇（测试用） */
function findByPathForTest(list, p) {
  const norm = (s) => String(s || '').replace(/^[/\\]+/, '').replace(/^p[/\\]/, '');
  return list.find((x) => norm(x.path) === norm(p));
}

test('9. 重新构建：内容变了才出新版，旧版进 .versions', async () => {
  fs.writeFileSync(path.join(root, 'para', 'idea', 'index.md'), '# 索引\n\n第二版内容。\n');
  const r = await post('/api/archive/rebuild', { paths: [archivedRel] });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const html = fs.readFileSync(path.join(p, archivedRel), 'utf8');
  assert.ok(html.includes('第二版内容'), '重建后应该是新内容');

  const list = await get('/api/archive');
  assert.equal(list.data.archived[0].versions, 1, '应该留了一版旧的');
});

test('10. 回滚：回到上一版，当前版也存下来', async () => {
  const r = await post('/api/archive/rollback', { path: archivedRel });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const html = fs.readFileSync(path.join(p, archivedRel), 'utf8');
  assert.ok(!html.includes('第二版内容'), '回滚后不该是第二版');
  assert.ok(html.includes('想到什么写什么'), '应该回到第一版');
});

test('11. 取消归档：产物删掉、原文回 /p、登记还原', async () => {
  const r = await post('/api/unarchive', { path: archivedRel });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.restored, 'idea/index.md');
  assert.ok(fs.existsSync(path.join(p, 'idea', 'index.md')), '原文该回来了');
  assert.ok(!fs.existsSync(path.join(p, archivedRel)), '产物该删掉');
  assert.ok(!fs.existsSync(path.join(root, 'para', 'idea', 'index.md')), '留底那份该搬走');

  const sk = JSON.parse(fs.readFileSync(path.join(site, 'sk.json'), 'utf8'));
  assert.equal(sk['奇思妙想']['索引'], 'idea/index.md');
  assert.ok(!sk['奇思妙想']['索引（归档）'], '归档那条登记该撤掉');
});

test('12. 归档只作用于勾选项（不传就报错，别的文件不动）', async () => {
  const bad = await post('/api/archive', { paths: [] });
  assert.equal(bad.status, 400);

  const before = fs.readdirSync(path.join(p, 'idea')).sort();
  const r = await post('/api/archive', { paths: ['idea/1.归途且慢.md'] });
  assert.equal(r.status, 200);
  const after = fs.readdirSync(path.join(p, 'idea')).sort();
  assert.deepEqual(after, before.filter((f) => f !== '1.归途且慢.md'), '只该动勾的那一篇');
  assert.ok(fs.existsSync(path.join(p, 'idea', 'index.md')), '没勾的必须原封不动');

  /* 收尾：取消归档，别把 fixture 留在归档态 */
  await post('/api/unarchive', { path: r.data.archived[0].output });
});

/* ═══════════ 5. 拖拽发布 ═══════════ */

test('13. 队列预判：类型、目标路径、重名都算出来', async () => {
  const r = await post('/api/queue', {
    files: [
      { name: '新笔记.md', targetDir: '', bytes: 10 },
      { name: 'pic.png', targetDir: 'asset', bytes: 20 },
      { name: 'pic.png', targetDir: 'asset', bytes: 20 },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.items[0].kind, 'md');
  assert.equal(r.data.items[0].isText, true);
  assert.equal(r.data.items[0].target, '新笔记.md');
  assert.equal(r.data.items[1].kind, 'image');
  /* 第一次判重名时 asset/pic.png 还在（前一个用例没删它） */
  assert.equal(r.data.items[2].conflict, true, '同名的第二个应该判为重名');
});

test('14. 拖拽发布：三种重名策略各走一遍', async () => {
  const target = 'asset/pic.png';

  /* 覆盖 */
  await post('/api/publish-drop', {
    items: [{ name: 'pic.png', target, text: 'OVERWRITTEN', conflict: 'overwrite' }],
  });
  assert.equal(fs.readFileSync(path.join(p, 'asset', 'pic.png'), 'utf8'), 'OVERWRITTEN');

  /* 自动改名 */
  const rn = await post('/api/publish-drop', {
    items: [{ name: 'pic.png', target, text: 'RENAMED', conflict: 'rename' }],
  });
  assert.equal(rn.data.results[0].path, 'asset/pic-2.png');
  assert.equal(fs.readFileSync(path.join(p, 'asset', 'pic-2.png'), 'utf8'), 'RENAMED');

  /* 跳过 */
  const sk = await post('/api/publish-drop', {
    items: [{ name: 'pic.png', target, text: 'SHOULD-NOT-WRITE', conflict: 'skip' }],
  });
  assert.equal(sk.data.results[0].ok, false);
  assert.equal(sk.data.results[0].skipped, true);
  assert.equal(fs.readFileSync(path.join(p, 'asset', 'pic.png'), 'utf8'), 'OVERWRITTEN', '跳过就不该动它');
});

test('15. 拖拽发布：默认不归档，勾了才预渲染', async () => {
  const plain = await post('/api/publish-drop', {
    items: [{ name: '随手记.md', target: '随手记.md', text: '# 随手记\n\n临时用。\n', conflict: 'rename', publish: true, archive: false }],
  });
  assert.equal(plain.data.results[0].ok, true);
  assert.ok(fs.existsSync(path.join(p, '随手记.md')), '不归档就该留在 /p');
  assert.ok(!fs.existsSync(path.join(p, 'archive', '随手记.html')), '没勾就不该有产物');

  const arch = await post('/api/publish-drop', {
    items: [{ name: '要归档.md', target: '要归档.md', text: '# 要归档\n\n写完了。\n', conflict: 'rename', publish: true, archive: true }],
  });
  assert.equal(arch.data.archived.length, 1, JSON.stringify(arch.data));
  assert.ok(fs.existsSync(path.join(p, 'archive', '要归档.html')));
  assert.ok(!fs.existsSync(path.join(p, '要归档.md')), '勾了归档就该搬走原文');
  assert.ok(fs.existsSync(path.join(root, 'para', '要归档.md')));
});

/* ═══════════ 6. 安全与容错 ═══════════ */

test('16. 路径穿越一律 403', async () => {
  const cases = [
    '/api/article?path=' + encodeURIComponent('../../../etc/passwd'),
    '/api/article?path=' + encodeURIComponent('../../.env'),
    '/api/article?path=' + encodeURIComponent('/etc/hosts'),
  ];
  for (const u of cases) {
    const r = await get(u);
    assert.equal(r.status, 403, u + ' 应该被拒');
  }

  const w = await put('/api/article', { path: '../../evil.md', content: 'x' });
  assert.equal(w.status, 403);
  assert.ok(!fs.existsSync(path.join(root, '..', 'evil.md')));
});

test('17. 静态服务：站点文件能取到，穿越取不到', async () => {
  const ok = await fetch(BASE + '/p/TEST.md');
  assert.equal(ok.status, 200);
  assert.ok((await ok.text()).includes('语法测试稿'));

  /* 路径穿越：URL 层会先把 %2e%2e 归一成 ..，服务端必须挡住。
     先在站点外放一个诱饵文件，再试各种绕法 —— 读到它就是漏。 */
  fs.writeFileSync(path.join(root, 'secret.env'), 'RTH_API_KEY=should-never-be-served');
  for (const probe of [
    '/p/%2e%2e/%2e%2e/secret.env',
    '/p/..%2f..%2fsecret.env',
    '/%2e%2e/secret.env',
  ]) {
    const bad = await fetch(BASE + probe, { redirect: 'manual' });
    assert.ok(bad.status === 404 || bad.status === 403, probe + ' 应该被拒，实际 ' + bad.status);
    if (bad.status === 200) {
      const body = await bad.text();
      assert.ok(!body.includes('should-never-be-served'), probe + ' 把站点外的文件读出来了');
    }
  }
  /* 归一到站点内的路径仍能正常读到（这是设计行为，不是漏洞） */
  const normalized = await fetch(BASE + '/%2e%2e/sk.json');
  assert.equal(normalized.status, 200);
  assert.ok((await normalized.text()).includes('启程篇'), '归一后应命中站点根的 sk.json');

  const ui = await fetch(BASE + '/');
  assert.equal(ui.status, 200);
  assert.ok((await ui.text()).includes('发布控制台'));
});

test('18. sk.json 坏掉：备份 + 可读报错，不覆盖原文件', async () => {
  const skPath = path.join(site, 'sk.json');
  const good = fs.readFileSync(skPath, 'utf8');
  fs.writeFileSync(skPath, '{ 这不是 json');

  const r = await get('/api/state');
  assert.equal(r.status, 500);
  assert.match(r.data.error, /不是合法 JSON/);
  assert.ok(r.data.backup, '应该回报备份文件名');
  /* 备份不能留在站点目录：那里的文件会被 prep-deploy 镜像进 dist 传上线 */
  const baks = fs.readdirSync(site).filter((n) => n.includes('.bak-'));
  assert.equal(baks.length, 0, '备份不该落在站点目录里');

  fs.writeFileSync(skPath, good);
  const again = await get('/api/state');
  assert.equal(again.status, 200, '恢复后应该还能用');
});

test('19. 设置：改了能存、能读回来', async () => {
  const r = await put('/api/settings', {
    settings: { uiTheme: 'light', editorFontSize: 17, autosaveMs: 800, confirmDanger: false },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.uiTheme, 'light');
  assert.equal(r.data.settings.editorFontSize, 17);

  /* 越界值要被夹住 */
  const r2 = await put('/api/settings', { settings: { editorFontSize: 999, autosaveMs: 1 } });
  assert.equal(r2.data.settings.editorFontSize, 24);
  assert.equal(r2.data.settings.autosaveMs, 400);
});

test('20. 归档产物自包含：CSS 相对前缀按目录深度算', async () => {
  /* 收尾时再归档一次，专门验深层目录的前缀 */
  fs.mkdirSync(path.join(p, 'deep', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(p, 'deep', 'nested', 'x.md'), '# 深一篇\n\n内容。\n');
  await put('/api/article', { path: 'deep/nested/x.md', content: '# 深一篇\n\n内容。\n', publish: true, group: '启程', title: '深一篇' });

  const r = await post('/api/archive', { paths: ['deep/nested/x.md'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rel = r.data.archived[0].output;
  /* output 是 /p 相对（面板列表用），sitePath 是 sk.json 里登记的那个 */
  assert.equal(rel, 'archive/deep/nested/x.html');
  assert.equal(r.data.archived[0].sitePath, 'p/archive/deep/nested/x.html');

  const html = fs.readFileSync(path.join(p, rel), 'utf8');
  /* p/archive/deep/nested/x.html：
       · 回到站点根要四级 → ../../../../p/…（docs.html、docs-card.js 走这个前缀）
       · 回到 /p/ 要三级 → ../../../docs-md.css（样式表住在 /p 下！）
     两个前缀不一样，早先 CSS 也接了站点根前缀，产物里就成了
     /docs-md.css（404）—— 死链检查把这个抓出来了，这里把两种都钉住。 */
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/docs-md\.css"/);
  assert.match(html, /src="\.\.\/\.\.\/\.\.\/\.\.\/p\/docs-card\.js"/);
  /* 回站点根（页脚的「回百宝箱」）走站点根前缀，和 /p 下的资源前缀不是一回事 */
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/\.\.\/">回百宝箱<\/a>/);

  /* 归档稿和静态文章页共用外壳：站点顶栏 + 侧栏目录（build/lib/chrome.mjs，只有一份） */
  assert.match(html, /<header class="top">/);
  assert.match(html, /<nav class="top-nav" aria-label="站点导航">[\s\S]*?博客[\s\S]*?百宝箱/);
  assert.match(html, /<article class="md" id="post">/);
  /* 只有一节也画目录（以前「不足两节就不显示」，短文于是完全没有目录） */
  assert.match(html, /class="wrap has-toc"/);
  assert.match(html, /<ul id="ptocList">[\s\S]*?深一篇<\/a>/);

  await post('/api/unarchive', { path: rel });
});

test('20.1 重刷外壳：正文不动，只按当前模板重写头 / 顶栏 / 目录 / 页脚', async () => {
  /* 一篇有章节的文章 → 归档后目录里应该有两条以上 */
  const md = '# 外壳试验\n\n## 第一节\n\n甲。\n\n## 第二节\n\n乙。\n';
  fs.writeFileSync(path.join(p, 'shell.md'), md);
  await put('/api/article', { path: 'shell.md', content: md, publish: true, group: '启程', title: '外壳试验' });

  const r = await post('/api/archive', { paths: ['shell.md'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rel = r.data.archived[0].output;              /* archive/shell.html */
  const abs = path.join(p, rel);

  /* 把它换成**没有外壳的老样子**：只有 head 的 title/description + 一个 .md 容器，
     模拟「原文早就不在了、但产物还在」的老归档稿 */
  const body = fs.readFileSync(abs, 'utf8');
  const inner = body.slice(body.indexOf('<article class="md" id="post">'));
  const innerHtml = inner.slice(inner.indexOf('>') + 1, inner.lastIndexOf('</article>'));
  fs.writeFileSync(abs,
    '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8">\n' +
    '<meta name="description" content="外壳试验摘要">\n<title>外壳试验 · JinSuper</title>\n' +
    '</head><body>\n<div class="md">' + innerHtml + '</div>\n</body></html>\n');

  const legacy = fs.readFileSync(abs, 'utf8');
  assert.ok(!legacy.includes('top-nav'), '老产物本来就没有顶栏');
  assert.ok(!legacy.includes('class="ptoc"'), '老产物本来就没有侧栏目录');

  const versionsBefore = fs.readdirSync(path.join(p, 'archive', '.versions')).length;
  const ok = await post('/api/archive/reshell', { paths: [rel] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.reshelled.length, 1, JSON.stringify(ok.data));
  assert.equal(ok.data.failed.length, 0, JSON.stringify(ok.data.failed));

  const fresh = fs.readFileSync(abs, 'utf8');
  /* 外壳换新了：顶栏 + 导航项 + 侧栏目录 + 正文容器 */
  assert.match(fresh, /<header class="top">/);
  assert.match(fresh, /<nav class="top-nav" aria-label="站点导航">[\s\S]*?阅读器[\s\S]*?百宝箱/);
  assert.match(fresh, /class="wrap has-toc"/);
  assert.match(fresh, /<ul id="ptocList">[\s\S]*?第一节[\s\S]*?第二节/);
  assert.match(fresh, /<article class="md" id="post">/);
  /* 正文一个字都没动 */
  assert.ok(fresh.includes('甲。') && fresh.includes('乙。'), '正文要原样保留');
  /* 元数据沿用老产物 head 里的那份 */
  assert.match(fresh, /<title>外壳试验 · JinSuper 奇思妙想<\/title>/);
  assert.match(fresh, /<meta name="description" content="外壳试验摘要">/);
  /* canonical 不能是空的（老产物没有这一行，要落回自己的地址） */
  assert.match(fresh, /<link rel="canonical" href="https:\/\/jinsuper\.rth1\.xyz\/p\/archive\/shell\.html">/);
  /* 覆盖前留了一版 */
  assert.ok(fs.readdirSync(path.join(p, 'archive', '.versions')).length > versionsBefore, '重刷要留版本备份');

  /* 非产物路径要挡住（这是「已归档产物」专用动作）。
     批量动作的规矩：单项失败不进 failed 之外的地方 —— 返回 200 + failed 列表，
     界面把每条原因都列出来，别的条目照刷不误。 */
  const bad = await post('/api/archive/reshell', { paths: ['idea/index.md'] });
  assert.equal(bad.status, 200, JSON.stringify(bad.data));
  assert.equal(bad.data.failed.length, 1, JSON.stringify(bad.data.failed));
  assert.match(bad.data.failed[0].error, /只能作用于已归档的 \.html 产物/);
  assert.equal(bad.data.reshelled.length, 0);

  await post('/api/unarchive', { path: rel });
});

/* ═══════════ 21. 预览：页面树 ═══════════ */

test('20.2 没有小节的短文，也有「本页目录」（兜底那一条指向正文容器）', async () => {
  const md = '通篇就是几段话，一个小标题都没有。\n\n第二段。\n';
  fs.writeFileSync(path.join(p, 'plain.md'), md);
  await put('/api/article', { path: 'plain.md', content: md, publish: true, group: '启程', title: '无小节随笔' });

  const r = await post('/api/archive', { paths: ['plain.md'] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rel = r.data.archived[0].output;              /* archive/plain.html */
  const html = fs.readFileSync(path.join(p, rel), 'utf8');

  assert.match(html, /class="wrap has-toc"/, '短文也要有目录块，页面形状才和别的文章一致');
  assert.match(html, /<ul id="ptocList">[\s\S]*?<a href="#post"[^>]*>无小节随笔<\/a>/);

  await post('/api/unarchive', { path: rel });
});

test('21. 预览页面树：清单和目录都读得到，而且不重复列', async () => {
  const auto = await get('/api/pages');
  assert.equal(auto.status, 200, JSON.stringify(auto.data));
  assert.equal(auto.data.source, 'auto');
  assert.ok(auto.data.stats.pages > 0, '至少得列出首页和文档');
  assert.ok(Array.isArray(auto.data.tree) && auto.data.tree.length, 'tree 不能是空的');

  /* 摊平一遍：分组 + 页面 */
  const flat = [];
  (function walk(ns) {
    for (const n of ns) { flat.push(n); if (n.children) walk(n.children); }
  })(auto.data.tree);

  const groups = flat.filter((n) => n.type === 'group').map((n) => n.title);
  const pages = flat.filter((n) => n.type === 'page');

  /* fixture 里 sk.json 的两组 + 目录扫描，是这一份数据的两个来源 */
  assert.ok(groups.includes('文档站（sk.json）'), '应该有 sk.json 那一组：' + groups.join(', '));
  assert.ok(groups.some((g) => g.startsWith('目录扫描')), '应该有一组目录扫描：' + groups.join(', '));
  assert.ok(groups.includes('启程'), '文档站里应该有「启程」小组');

  /* 登记过的 .md 走阅读器 deep-link，别拿原始 .md 当页面 */
  const setup = pages.find((n) => n.title === '启程篇');
  assert.ok(setup, '「启程篇」应该在树里');
  assert.equal(setup.href, '/p/docs.html#para/1SetUp.md');
  assert.equal(setup.kind, 'doc');

  /* 同一份站点文件不能在清单和目录扫描里各出现一次。
     注意比对的是**完整 href**：文档站的每一篇都挂在 /p/docs.html 上，
     靠 #后面的路径区分，剥掉 hash 就成了同一个地址（false positive）。 */
  const seen = new Map();
  for (const n of pages) {
    seen.set(n.href, (seen.get(n.href) || 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dup, [], '有重复列出的页面：' + JSON.stringify(dup));

  /* 只扫目录：应该没有清单那两组，但盘上的 .html 还在 */
  const dir = await get('/api/pages?source=dir');
  const dirGroups = [];
  (function walk(ns) { for (const n of ns) { if (n.type === 'group') dirGroups.push(n.title); if (n.children) walk(n.children); } })(dir.data.tree);
  assert.ok(!dirGroups.includes('文档站（sk.json）'), 'dir 模式不该出现清单分组');
  assert.ok(dirGroups.some((g) => g.startsWith('目录扫描')));

  /* 只看清单：不该出现目录扫描那一组 */
  const man = await get('/api/pages?source=manifest');
  const manGroups = [];
  (function walk(ns) { for (const n of ns) { if (n.type === 'group') manGroups.push(n.title); if (n.children) walk(n.children); } })(man.data.tree);
  assert.ok(manGroups.includes('文档站（sk.json）'));
  assert.ok(!manGroups.some((g) => g.startsWith('目录扫描')), 'manifest 模式不该扫目录');

  /* 不认识的 source 退回 auto（不报错） */
  const bad = await get('/api/pages?source=nonsense');
  assert.equal(bad.status, 200);
  assert.equal(bad.data.source, 'auto');
});

/* ═══════════ 22. 预览服务 ═══════════ */

/** 找个能用的端口（测试机上 18791+ 那一段可能被占） */
function freePreviewPort(start) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const s = http.createServer();
      s.once('error', () => probe(port + 1));
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(port)));
    };
    probe(start);
  });
}

test('22. 预览服务：起得来、服务的是站点根、raw.php 也能用、停得掉', async () => {
  const before = await get('/api/preview/status');
  assert.equal(before.data.running, false, '测试开始时不该有预览服务');
  assert.equal(before.data.app, 'jinsuper-preview');

  const port = await freePreviewPort(19500 + (process.pid % 300));
  const start = await post('/api/preview/start', { port });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.running, true);
  assert.equal(start.data.port, port);
  assert.equal(start.data.url, `http://127.0.0.1:${port}/`);

  /* 名字牌：headless 靠它认「端口上是不是预览服务」 */
  const card = await fetch(`http://127.0.0.1:${port}/__preview.json`);
  assert.equal(card.status, 200);
  assert.equal((await card.json()).app, 'jinsuper-preview');

  /* 站点根的路径按原样服务（这就是和控制台 8791 的关键区别：
     8791 上 /index.html 是控制台自己的页面，预览服务上才是站点首页） */
  const md = await fetch(`http://127.0.0.1:${port}/p/TEST.md`);
  assert.equal(md.status, 200);
  assert.ok((await md.text()).includes('语法测试稿'));

  /* 模拟线上那个云函数：?f= 读原文 */
  const raw = await fetch(`http://127.0.0.1:${port}/p/raw.php?f=/p/TEST.md`);
  assert.equal(raw.status, 200);
  assert.match(await raw.text(), /语法测试稿/);
  const rawOut = await fetch(`http://127.0.0.1:${port}/p/raw.php?f=../../../.env`);
  assert.equal(rawOut.status, 404, 'raw.php 也不能读站点外面的东西');

  /* 穿越照样挡住 */
  fs.writeFileSync(path.join(root, 'secret.env'), 'RTH_API_KEY=should-never-be-served');
  const evil = await fetch(`http://127.0.0.1:${port}/p/%2e%2e/%2e%2e/secret.env`, { redirect: 'manual' });
  assert.ok(evil.status === 404 || evil.status === 403, '穿越应该被拒，实际 ' + evil.status);

  /* 端口被占时给的是人话，不是堆栈 */
  const again = await post('/api/preview/start', { port: PORT });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.match(again.data.error, /被占用/);

  const stop = await post('/api/preview/stop');
  assert.equal(stop.status, 200);
  assert.equal(stop.data.running, false);
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/p/TEST.md`), '停掉之后不该还能连上');
});

/* ═══════════ 23. 预览设置 ═══════════ */

test('23. 预览设置：端口夹住、枚举只认自己的值', async () => {
  const r = await put('/api/settings', {
    settings: {
      previewPort: 9001, previewAutoStart: true, previewOpenAfterStart: false,
      previewClickMode: 'path', previewTreeSource: 'dir',
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.previewPort, 9001);
  assert.equal(r.data.settings.previewAutoStart, true);
  assert.equal(r.data.settings.previewOpenAfterStart, false);
  assert.equal(r.data.settings.previewClickMode, 'path');
  assert.equal(r.data.settings.previewTreeSource, 'dir');

  /* 乱填的：端口回到默认，枚举回到默认 */
  const bad = await put('/api/settings', {
    settings: { previewPort: 'abc', previewClickMode: 'nonsense', previewTreeSource: 'x' },
  });
  assert.equal(bad.data.settings.previewPort, 8790);
  assert.equal(bad.data.settings.previewClickMode, 'auto');
  assert.equal(bad.data.settings.previewTreeSource, 'auto');

  /* 越界端口也回到默认，别把 0 / 70000 存进去 */
  const out = await put('/api/settings', { settings: { previewPort: 70000 } });
  assert.equal(out.data.settings.previewPort, 8790);

  /* 还原成默认，别让后面的用例读到改过的设置 */
  await put('/api/settings', {
    settings: {
      previewPort: 8790, previewAutoStart: false, previewOpenAfterStart: true,
      previewClickMode: 'auto', previewTreeSource: 'auto',
    },
  });
});
