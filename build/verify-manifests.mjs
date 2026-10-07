/**
 * 清单校验：把「清单说有什么」和「磁盘上真有什么」对起来
 * ---------------------------------------------------
 检查项：
 *   1. /site.json 能解析、里面的 collection 都存在
 *   2. 每个 collection：schema、必填、id 唯一、图标名存在
 *   3. 每条 href / iconFile 指向的文件真实存在
 *   4. 跨 collection 的全局键（collection/id）不重复
 *   5. sk.json（文档站）里每条路径存在
 *   6. 站点里的 html 有没有谁都没收录（提示，可用 site.json 的 ignore 豁免）
 *   7. 生成物（sitemap.xml、docs/info/site-index.js）是不是和现场生成的一致
 *   8. 四个卡片页有没有统一引用 /lib/manifest.js
 *   9. docs/info/info.js 的图标名单数量与 /asset/icon 对得上（提示）
 *
 * 跑法：node build/verify-manifests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot, paths } from './paths.mjs';
import { loadManifestLib, readCollection } from './lib/site-lib.mjs';
import { checkOutputs } from './lib/site-index.mjs';
import { collectHtml } from './lib/favicon.mjs';

const M = loadManifestLib();

let fail = 0, warn = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };
const meh = (m) => { console.log('  ⚠ ' + m); warn++; };

const siteJsonPath = path.join(siteRoot, 'site.json');
/* 存在的意思：是个文件；或者是个**带 index.html 的目录**（清单里写 `/p/` 这种地址，
   热铁盒会落回目录里的 index.html，所以它同样指得着） */
const exists = (p) => {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return true;
    if (st.isDirectory()) return fs.statSync(path.join(p, 'index.html')).isFile();
  } catch { /* 不存在 / 没权限都算不存在 */ }
  return false;
};
/** 站点绝对路径 → 磁盘路径（去掉 ?query / #hash） */
const diskOf = (href) => path.join(siteRoot, String(href).split(/[?#]/)[0].replace(/^\/+/, ''));
const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/* ── 1. /site.json ── */
console.log('\n── 1. 站点目录 /site.json ──');

let site = null;
try {
  site = JSON.parse(fs.readFileSync(siteJsonPath, 'utf8'));
  ok('可解析');
} catch (e) {
  bad('读不到或不是合法 JSON：' + e.message);
}

const collections = [];
if (site) {
  if (!Array.isArray(site.collections) || !site.collections.length) {
    bad('collections 是空的，首页就没有东西可渲染');
  } else {
    for (const rel of site.collections) {
      if (exists(diskOf(rel))) ok(`collection 存在：${rel}`);
      else bad(`collection 不存在：${rel}`);
      collections.push(readCollection(rel, { strict: true }));
    }
  }
}

/* ── 2/3/4. 每个 collection ── */
const items = [];
for (const col of collections) {
  console.log(`\n── 2. 清单 ${col.file ? path.relative(siteRoot, col.file).split(path.sep).join('/') : '?'} ──`);
  if (!col.ok) { bad(col.error); continue; }

  const errors = col.problems.filter((p) => p.level === 'error');
  const warns = col.problems.filter((p) => p.level !== 'error');
  if (errors.length) errors.forEach((p) => bad(p.message));
  else ok(`结构 / 必填 / id / 图标名都过（${col.items.length} 条）`);
  warns.forEach((p) => meh(p.message));

  for (const it of col.items) {
    if (!isExternal(it.href) && !exists(diskOf(it.href))) bad(`${it.key}: href 指向的文件不存在（${it.href}）`);
    if (it.iconFile && !isExternal(it.iconFile) && !exists(diskOf(it.iconFile))) bad(`${it.key}: iconFile 不存在（${it.iconFile}）`);
    items.push(it);
  }
  if (col.root && !exists(diskOf(path.join(col.root, 'index.html')))) {
    meh(`${col.collection}: root ${col.root} 下没有 index.html`);
  }
}

/* 4. 跨集合全局键 */
console.log('\n── 3. 跨 collection 唯一性 ──');
{
  const seen = new Map();
  const dups = [];
  for (const it of items) {
    if (seen.has(it.key)) dups.push(it.key);
    seen.set(it.key, true);
  }
  if (dups.length) bad('全局键重复：' + dups.join(', '));
  else ok(`${items.length} 条的 collection/id 都唯一`);
}

/* ── 5. sk.json ── */
console.log('\n── 4. 文档站清单 sk.json ──');
try {
  const sk = JSON.parse(fs.readFileSync(paths.sk, 'utf8'));
  const flat = [];
  for (const [, v] of Object.entries(sk)) {
    if (v && typeof v === 'object') {
      for (const [, p] of Object.entries(v)) if (typeof p === 'string' && p.trim()) flat.push(p.trim());
    } else if (typeof v === 'string' && v.trim()) flat.push(v.trim());
  }
  const missing = flat.filter((p) => !exists(path.resolve(path.join(siteRoot, 'p'), p)));
  if (missing.length) bad('这些文档读不到：' + missing.join(', '));
  else ok(`${flat.length} 篇文档的路径都存在`);
} catch (e) {
  bad('读不到或不是合法 JSON：' + e.message);
}

/* ── 6. 孤儿页面 ── */
console.log('\n── 5. 页面收录情况 ──');
{
  const covered = new Set(items.filter((i) => !isExternal(i.href)).map((i) => i.href));
  for (const ex of site?.extraUrls || []) covered.add(String(ex.loc).split(/[?#]/)[0]);
  const ignore = (site?.ignore || []).map(String);

  const skipped = (href) =>
    ignore.some((pat) => href === pat || href.startsWith(pat.replace(/\/?$/, '/'))) ||
    href.startsWith('/old/') ||
    /* 目录落地页（任何 /xxx/index.html）天然属于那个目录，不需要单独收录 */
    href.endsWith('/index.html');

  const orphans = [];
  for (const abs of collectHtml(siteRoot)) {
    const href = '/' + path.relative(siteRoot, abs).split(path.sep).join('/');
    if (covered.has(href) || skipped(href)) continue;
    orphans.push(href);
  }
  if (orphans.length) {
    meh(`${orphans.length} 个页面没被任何清单收录（有意的就加进 site.json 的 ignore）：` +
      orphans.slice(0, 6).join(', ') + (orphans.length > 6 ? ` …另 ${orphans.length - 6} 个` : ''));
  } else {
    ok('每个 html 都有归属（收录或明确忽略）');
  }
}

/* ── 7. 生成物新鲜度 ── */
console.log('\n── 6. 生成物 ──');
{
  /* 直接调库比对：这个环境里 spawn 捞输出会被管道限制挡掉 */
  const { stale } = checkOutputs();
  if (stale.length) bad('生成物过期或被手改：' + stale.map((s) => s.label).join(', ') +
    '（跑 node build/gen-site-index.mjs 重新生成）');
  else ok('sitemap.xml 与 docs/info/site-index.js 都是现场生成的结果');
}

/* ── 8. 卡片页是否都在用同一个运行时 ──
   新的卡片页要加进下面这个清单；引用写法必须一字不差：<script src="/lib/manifest.js"></script> */
console.log('\n── 7. 卡片页引用 ──');
for (const rel of ['index.html', 'web/index.html', 'Skills/index.html', '811/index.html', '811/english.html']) {
  const file = path.join(siteRoot, rel);
  if (!exists(file)) { meh(`${rel} 不存在，跳过`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (/<script src="\/lib\/manifest\.js"><\/script>/.test(html)) ok(`${rel} 引用了 /lib/manifest.js`);
  else bad(`${rel} 没有引用 /lib/manifest.js`);
  if (/function guessKind|const KIND_RULES|const ICONS = \{/.test(html)) {
    meh(`${rel} 里还留着本地图标 / kind 逻辑，可以删了`);
  }
}

/* ── 9. 图标名单数量（人工维护的部分） ── */
console.log('\n── 8. 图标名单 ──');
{
  const infoJs = path.join(siteRoot, 'docs', 'info', 'info.js');
  const iconDir = path.join(siteRoot, 'asset', 'icon');
  try {
    const src = fs.readFileSync(infoJs, 'utf8');
    const m = /const ICONS = \[([\s\S]*?)\];/.exec(src);
    const listed = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    const onDisk = fs.existsSync(iconDir)
      ? fs.readdirSync(iconDir).filter((n) => /\.svg$/i.test(n)).map((n) => n.replace(/\.svg$/i, ''))
      : [];
    const setDisk = new Set(onDisk);
    const setList = new Set(listed);
    const missing = listed.filter((n) => !setDisk.has(n));
    const extra = onDisk.filter((n) => !setList.has(n));
    if (missing.length) bad(`info.js 里这些图标在 /asset/icon 找不到：${missing.slice(0, 6).join(', ')}`);
    else if (extra.length) {
      meh(`info.js 的图标名单没列这几个（${extra.length} 个，不是 AntD 那套就正常）：${extra.slice(0, 6).join(', ')}`);
    } else {
      ok(`info.js 的图标名单与 /asset/icon 完全对上（${onDisk.length} 枚）`);
    }
  } catch (e) {
    meh('读不到 docs/info/info.js：' + e.message);
  }
}

console.log(`\n${fail ? `✗ ${fail} 项失败` : '✓ 全部通过'}${warn ? `，${warn} 项提示` : ''}\n`);
process.exit(fail ? 1 : 0);
