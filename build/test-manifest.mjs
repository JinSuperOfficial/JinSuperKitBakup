/**
 * 清单系统验收：共用运行时 + 四个卡片页
 * ---------------------------------------------------
 * 两段：
 *   1. 纯逻辑（在 Node 里载入站点自己的 /lib/manifest.js，跑归一/排序/去重/兜底）
 *   2. jsdom 真跑页面（经典脚本，用 window.eval 注入 /lib/manifest.js，和 test-dom.mjs 同套路）
 *      并和 dist/ 里改造前的产物做 DOM 对照，确保外观零回归
 *
 * 跑法：node build/test-manifest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { siteRoot, buildDir } from './paths.mjs';
import { loadManifestLib, readCollection } from './lib/site-lib.mjs';

const projectRoot = path.resolve(buildDir, '..');
const distRoot = path.join(projectRoot, 'dist');
const LIB_REL = 'lib/manifest.js';

let fail = 0, warn = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };
const meh = (m) => { console.log('  ⚠ ' + m); warn++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = loadManifestLib();

/* ═══════════════════════════════════════════════════
   工具
   ═══════════════════════════════════════════════════ */

/** 卡片 DOM 规范化：忽略 data-*、card-lead、序号、href 归一；
    opts.ignoreIcon / opts.ignoreDesc 把图标、简介抹平（这两处各自单独比对，见 §6） */
function canonCard(el, pageUrl, opts = {}) {
  const c = el.cloneNode(true);
  for (const a of [...c.attributes]) {
    if (a.name.toLowerCase().startsWith('data-')) c.removeAttribute(a.name);
  }
  c.classList.remove('card-lead');
  const num = c.querySelector('.card-num');
  if (num) num.textContent = '##';
  if (opts.ignoreIcon) {
    const icon = c.querySelector('.card-icon');
    if (icon) icon.innerHTML = '%%';
  }
  if (opts.ignoreDesc) {
    const desc = c.querySelector('.card-esc, .card-desc, p');
    if (desc) desc.textContent = '%%';
  }
  const href = c.getAttribute('href');
  if (href) {
    try { c.setAttribute('href', new URL(href, pageUrl).pathname); } catch { /* 原样留着 */ }
  }
  return c.outerHTML.replace(/\s+/g, ' ').replace(/>\s+</g, '><').replace(/\s+>/g, '>').trim();
}

/**
 * 起一个页面。
 * @param {object} o
 *   html      页面 HTML 文本
 *   pageUrl   形如 'http://x/class/index.html'
 *   root      相对路径的落地根（站点根或 dist 根）
 *   overlay   虚拟文件覆盖：{'/class/tools.json': '…'}，优先于磁盘
 */
function boot({ html, pageUrl, root, overlay = {} }) {
  const errs = [];
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(e.message));
  for (const lvl of ['error', 'warn', 'log']) {
    vc.on(lvl, (...a) => logs.push(lvl + ': ' + a.map((x) => String(x)).join(' ')));
  }

  const dom = new JSDOM(html, { url: pageUrl, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;

  window.matchMedia = (q) => ({
    matches: false, media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });

  const reqLog = [];
  window.fetch = (url) => {
    const u = String(url);
    reqLog.push(u);
    const key = u.split('?')[0];
    const abs = key.startsWith('/') ? key : new URL(key, pageUrl).pathname;
    const text = overlay[abs] != null
      ? String(overlay[abs])
      : (() => {
        const f = path.join(root, abs.replace(/^\/+/, ''));
        return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null;
      })();
    if (text == null) {
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, text: () => Promise.resolve('') });
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text)),
    });
  };

  /* 经典脚本：先注入站点运行时，再按顺序跑页面里的内联脚本 */
  window.eval(fs.readFileSync(path.join(siteRoot, LIB_REL), 'utf8'));
  for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) window.eval(s[1]);

  return { window, doc: window.document, errs, reqLog, logs };
}

const cards = (doc) => [...doc.querySelectorAll('#tool-grid > .card, .grid > .card')];
const titles = (doc) => cards(doc).map((c) => (c.querySelector('h2, .card-title') || {}).textContent || '');

/* ═══════════════════════════════════════════════════
   1. 纯逻辑
   ═══════════════════════════════════════════════════ */
console.log('\n── 1. 共用运行时（/lib/manifest.js） ──');

{
  if (typeof M.normalizeCollection === 'function' && M.ICON_NAMES.length) ok(`载入成功，${M.ICON_NAMES.length} 个图标：${M.ICON_NAMES.join(', ')}`);
  else bad('载入失败');

  const col = M.normalizeCollection({
    collection: 't', title: 'T', root: '/t/',
    items: [
      { id: 'b', title: 'B', desc: '', href: '/t/b.html', order: 20 },
      { id: 'a', title: 'A', desc: '', href: './a.html', order: 5 },
      { id: 'h', title: 'H', desc: '', href: '/t/h.html', hidden: true },
      { id: 'c', title: 'C', desc: '', href: '/t/c.html' },
    ],
  }, { base: '/t/' });

  if (col.items.map((i) => i.id).join(',') === 'a,b,c') ok('order 升序 + hidden 过滤 + 缺 order 排最后：' + col.items.map((i) => i.id).join(','));
  else bad('排序/过滤不对：' + col.items.map((i) => i.id).join(','));
  if (col.items[0].href === '/t/a.html') ok('相对 href 归一：./a.html → /t/a.html');
  else bad('相对 href 归一失败：' + col.items[0].href);
  if (col.root === '/t/') ok('collection root 归一');
  if (+col.items[0].order === 5 && +col.items[2].order === 999) ok('order 数字与默认 999');

  const dup = M.normalizeCollection([{ id: 'x', title: 'X', desc: '', href: '/x.html' }, { id: 'x', title: 'X2', desc: '', href: '/y.html' }]);
  if (dup.items.length === 1 && dup.problems.some((p) => p.code === 'dup-id')) ok('重复 id：去重 + 记 error');
  else bad('重复 id 处理不对');

  const skipped = M.normalizeCollection([
    { title: '没 id', desc: '', href: '/1.html' },
    { id: 'ok2', title: '没 href', desc: '' },
    { id: 'ok3', title: '正常', desc: '', href: '/3.html' },
    null,
  ]);
  if (skipped.items.length === 1 && skipped.items[0].id === 'ok3') ok('缺必填 / null 条目：跳过并记 error');
  else bad('必填校验不对：' + skipped.items.map((i) => i.id).join(','));

  const legacy = M.normalizeCollection({ items: [{ id: 'l', title: 'L', desc: '', file: 'tools/x.html' }] }, { base: '/Skills/' });
  if (legacy.items[0].href === '/Skills/tools/x.html' && legacy.problems.some((p) => p.code === 'legacy-file')) ok('旧字段 file → 按清单目录换算（并告警）');
  else bad('旧字段换算不对：' + JSON.stringify(legacy.items[0] && legacy.items[0].href));

  const icon = M.normalizeItem({ id: 'i', title: 'I', desc: '', href: '/i.html', icon: '不存在' }, { collection: 't' });
  if (icon.item.icon === 'default' && icon.issues.some((p) => p.code === 'unknown-icon')) ok('未知图标名 → 回落 default 并告警');
  else bad('未知图标处理不对');

  const rawSvg = M.normalizeItem({ id: 'i', title: 'I', desc: '', href: '/i.html', icon: '<circle r="1"/>' }, {});
  if (rawSvg.item.iconSvg === '<circle r="1"/>' && !rawSvg.item.icon) ok('icon 直接写 svg → 当成 iconSvg');
  else bad('原始 svg 兼容失败');

  if (M.resolveHref('中文 名.md', '/p/') === '/p/%E4%B8%AD%E6%96%87%20%E5%90%8D.md') ok('中文/空格逐段编码');
  else bad('编码不对：' + M.resolveHref('中文 名.md', '/p/'));
  if (M.resolveHref('/a/b.html#x', '/') === '/a/b.html#x') ok('hash 原样保留');
  if (M.resolveHref('https://x.com/a', '/') === 'https://x.com/a') ok('外链原样返回');
  if (M.sitePath('Skills/../class/x.html') === 'class/x.html') ok('sitePath 折叠 ..');
}

/* ═══════════════════════════════════════════════════
   2. 811 页：渲染 + 与 dist 对照
   ═══════════════════════════════════════════════════ */
console.log('\n── 2. /class/index.html ──');

const PAGE_811 = 'class/index.html';
const newHtml811 = fs.readFileSync(path.join(siteRoot, PAGE_811), 'utf8');
const oldFile811 = path.join(distRoot, PAGE_811);

{
  const M811 = readCollection('/class/tools.json', { strict: true });
  const wantTitles = M811.items.map((i) => i.title).join(',');
  const wantCount = M811.items.length;

  const { doc, errs, reqLog } = boot({
    html: newHtml811,
    pageUrl: 'http://x/class/index.html',
    root: siteRoot,
  });
  await sleep(80);

  if (errs.length) bad('页面报错：' + errs.join(' | ')); else ok('页面无 JS 报错');
  if (reqLog.some((u) => u.includes('/class/tools.json'))) ok('清单走 fetch：' + reqLog.join(', ')); else bad('没有请求清单');

  /* 卡片数 / 顺序 / 标题都按现清单算，加一条工具不用回来改测试 */
  const cs = cards(doc);
  if (cs.length === wantCount) ok(`渲染 ${wantCount} 张卡片（tools.json 里有几条就几张）`);
  else bad(`卡片数：${cs.length}，按 tools.json 应该是 ${wantCount}`);
  if (titles(doc).join(',') === wantTitles) ok('顺序与标题正确');
  else bad('标题/顺序：' + titles(doc).join(','));
  if (cs[0] && cs[0].getAttribute('href') === '/class/homework.html') ok('href 已归一为站点根绝对路径');
  else bad('href：' + (cs[0] && cs[0].getAttribute('href')));
  if (cs[0] && cs[0].dataset.id === 'homework' && cs[0].dataset.key === 'class/homework') ok('data-id / data-key 正确');
  else bad('dataset：' + JSON.stringify(cs[0] && cs[0].dataset));

  const ico = cs[0] && cs[0].querySelector('.card-ico svg');
  if (ico && ico.children.length === 3) ok('图标来自注册表（clipboardCheck，3 条 path）');
  else bad('图标不对');
  if (!doc.querySelector('#tool-grid > a.card')) bad('grid 里出现了非 JS 生成的卡片');

  /* 与 dist 里的旧版逐字符对照：旧版只可能少几张（新加的条目不算回归） */
  if (!fs.existsSync(oldFile811)) {
    meh('dist/class/index.html 不存在，跳过 DOM 对照（未组装过产物时属正常）');
  } else {
    const old = boot({
      html: fs.readFileSync(oldFile811, 'utf8'),
      pageUrl: 'http://x/class/index.html',
      root: distRoot,
    });
    await sleep(80);
    const oldCards = cards(old.doc).map((c) => canonCard(c, old.window.location.href));
    const newCards = cards(doc).map((c) => canonCard(c, 'http://x/class/index.html'));
    if (newCards.length < oldCards.length) {
      bad(`比旧版少了卡片：旧 ${oldCards.length} / 新 ${newCards.length}`);
    } else {
      let same = true;
      oldCards.forEach((o, i) => {
        if (o !== newCards[i]) {
          same = false;
          bad(`第 ${i + 1} 张卡与改造前不一致：\n      旧: ${o.slice(0, 170)}\n      新: ${newCards[i].slice(0, 170)}`);
        }
      });
      if (same) ok('卡片 DOM 与改造前逐字符一致（忽略 data-*、href 归一后）');
      if (newCards.length > oldCards.length) {
        meh(`比旧版多 ${newCards.length - oldCards.length} 张（新加的条目，不算回归）`);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════
   3. 811 页：清单变化的行为
   ═══════════════════════════════════════════════════ */
console.log('\n── 3. 改清单就生效（/class/index.html） ──');

const base811 = JSON.parse(fs.readFileSync(path.join(siteRoot, 'class/tools.json'), 'utf8'));

async function render811(payload) {
  const { doc } = boot({
    html: newHtml811,
    pageUrl: 'http://x/class/index.html',
    root: siteRoot,
    overlay: { '/class/tools.json': typeof payload === 'string' ? payload : JSON.stringify(payload) },
  });
  await sleep(60);
  return doc;
}

{
  const added = JSON.parse(JSON.stringify(base811));
  const addedItem = { id: 'new', title: '新工具', desc: 'd', href: '/class/new.html', icon: 'calendar', order: 5 };
  added.items.push(addedItem);
  const d1 = await render811(added);
  const addedTitles = cards(d1).map((c) => (c.querySelector('h2, .card-title') || {}).textContent || '');
  if (addedTitles[0] === addedItem.title && addedTitles.length === base811.items.length + 1) {
    ok('加一条 + order 生效：' + addedTitles.join(' → '));
  } else {
    bad('加条目/排序不对：' + addedTitles.join(','));
  }

  const hidden = JSON.parse(JSON.stringify(base811));
  hidden.items[0].hidden = true;
  const hiddenTitles = base811.items.slice(1).map((i) => i.title).join(',');
  const d2 = await render811(hidden);
  if (titles(d2).join(',') === hiddenTitles && d2.querySelectorAll('.grid-empty').length === 0) ok('hidden:true 不渲染');
  else bad('hidden 处理不对：' + titles(d2).join(','));

  const allHidden = JSON.parse(JSON.stringify(base811));
  allHidden.items.forEach((i) => { i.hidden = true; });
  const d3 = await render811(allHidden);
  const e3 = d3.querySelector('.grid-empty');
  if (e3 && e3.textContent === '暂无工具') ok('全部隐藏 → 「暂无工具」');
  else bad('空态文案：' + (e3 && e3.textContent));

  const d4 = await render811('[]');
  const e4 = d4.querySelector('.grid-empty');
  if (e4 && e4.textContent === '暂无工具') ok('空数组 → 「暂无工具」');
  else bad('空数组文案：' + (e4 && e4.textContent));

  const d5 = await render811('{ 坏 json');
  const e5 = d5.querySelector('.grid-empty');
  if (e5 && /清单没加载出来/.test(e5.textContent)) ok('坏 JSON → 兜底文案');
  else bad('坏 JSON 文案：' + (e5 && e5.textContent));

  const d6 = await render811(JSON.stringify({ collection: 'class', items: null }));
  const e6 = d6.querySelector('.grid-empty');
  if (e6 && /清单没加载出来/.test(e6.textContent)) ok('顶层结构不对 → 兜底文案');
  else bad('顶层结构兜底不对');
}

/* ═══════════════════════════════════════════════════
   4. /Skills/index.html（工具站目录页）
   ═══════════════════════════════════════════════════ */
console.log('\n── 4. /Skills/index.html ──');

{
  const html = fs.readFileSync(path.join(siteRoot, 'Skills/index.html'), 'utf8');
  const { doc, window, errs, reqLog, logs } = boot({ html, pageUrl: 'http://x/Skills/index.html', root: siteRoot });
  await sleep(120);

  if (errs.length) bad('页面报错：' + errs.join(' | ')); else ok('页面无 JS 报错');

  const rows = [...doc.querySelectorAll('#list .row')];
  if (rows.length > 0) ok(`渲染 ${rows.length} 行`);
  else {
    bad('一行都没渲染');
    console.log('     请求：' + reqLog.join(', '));
    console.log('     控制台：' + (logs.join(' | ') || '（无）'));
    console.log('     列表 HTML：' + (doc.querySelector('#list') ? doc.querySelector('#list').innerHTML.slice(0, 160) : '（没有 #list）'));
  }

  const first = rows[0];
  if (first && first.getAttribute('href') === '/p/') ok('href 用清单里的绝对路径：' + first.getAttribute('href'));
  else bad('href 不对：' + (first && first.getAttribute('href')));

  /* 博客首页不在集合根（/Skills/）下，显示路径要退回站点绝对路径 */
  const name = first && first.querySelector('.name').textContent;
  if (name === '/p/') ok('集合根之外的显示路径是站点绝对路径：' + name);
  else bad('显示路径：' + name);

  const ico = first && first.querySelector('.ico svg');
  if (ico && ico.getAttribute('stroke-width') === '1.8' && ico.children.length > 0) ok('图标来自注册表且描边保持 1.8');
  else bad('图标不对：' + (ico && ico.outerHTML.slice(0, 90)));

  if (first.querySelector('.kind').textContent === 'doc') ok('kind 标签来自清单');
  else bad('kind 标签：' + first.querySelector('.kind').textContent);

  /* 搜索：按标题过滤 */
  const q = doc.getElementById('q');
  q.value = '月相';
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(160);
  const searched = [...doc.querySelectorAll('#list .row')];
  if (searched.length === 1 && searched[0].textContent.includes('月相')) ok('搜索按标题过滤生效');
  else bad('搜索结果：' + searched.length + ' 行');

  /* 右键菜单：用 data-href 取路径，不再靠 href 猜文件名 */
  q.value = '';
  q.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(160);
  const freshFirst = doc.querySelector('#list .row');   /* 重新渲染后要重新取节点 */
  freshFirst.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  await sleep(30);
  const ctxHead = doc.querySelector('#ctx .ctx-head');
  if (ctxHead && ctxHead.textContent === '/p/') ok('右键菜单标题用显示路径：' + ctxHead.textContent);
  else bad('右键菜单标题：' + (ctxHead && ctxHead.textContent));
}

/* ═══════════════════════════════════════════════════
   5. /index.html（首页：多 collection 分组）
   ═══════════════════════════════════════════════════ */
console.log('\n── 5. /index.html ──');

const PAGE_HOME = 'index.html';
const homeHtml = fs.readFileSync(path.join(siteRoot, PAGE_HOME), 'utf8');

/* 首页的分组数 / 卡片数不写死：现场从 /site.json 的 collections 数出来。
   口径必须和首页一致 —— 归一化丢掉 hidden、按 order 升序、id 去重，
   再按 collection 的 root 合并同源分组（跨集合重复 href 只留第一条），
   所以「分组数 = 合并后的分组数」「卡片数 = 各组可见条目之和」。 */
const homeExpect = (() => {
  const site = JSON.parse(fs.readFileSync(path.join(siteRoot, 'site.json'), 'utf8'));
  const collections = (site.collections || []).map((rel) => readCollection(rel, { strict: true }));
  const merged = M.mergeCollections(collections);
  return {
    files: collections.length,
    groups: merged.groups.length,
    cards: merged.total,
    detail: merged.groups.map((g) => `${g.title || g.collection} ${g.items.length}`).join(' + '),
  };
})();

for (const rel of [PAGE_HOME, 'web/index.html']) {
  console.log(`  · ${rel}`);
  const { doc, window, errs, reqLog, logs } = boot({
    html: fs.readFileSync(path.join(siteRoot, rel), 'utf8'),
    pageUrl: 'http://x/' + rel,
    root: siteRoot,
  });
  await sleep(150);

  if (errs.length) bad(`${rel} 页面报错：` + errs.join(' | ')); else ok('  页面无 JS 报错');
  if (reqLog.some((u) => u.includes('/site.json'))) ok('  读了 /site.json');
  else bad('  没读 /site.json：' + reqLog.join(', '));
  if (reqLog.some((u) => u.includes('tools.json')) && reqLog.some((u) => u.includes('skills.json'))) {
    ok('  两个 collection 都读了');
  } else bad('  collection 没读全：' + reqLog.join(', '));

  const heads = [...doc.querySelectorAll('#grid > .group-head')];
  if (heads.length === homeExpect.groups) {
    ok(`  ${homeExpect.groups} 个分组标题（/site.json 里 ${homeExpect.files} 个 collection）：` +
      heads.map((h) => h.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  } else {
    bad(`  分组标题数：${heads.length}，按 /site.json 应该是 ${homeExpect.groups}`);
  }

  const cs = cards(doc);
  if (cs.length === homeExpect.cards) {
    ok(`  ${homeExpect.cards} 张卡片（${homeExpect.detail}），与清单一致`);
  } else {
    bad(`  卡片数：${cs.length}，按清单应该是 ${homeExpect.cards}（${homeExpect.detail}）`);
  }

  if (heads[0] && heads[0].querySelector('a') && heads[0].querySelector('a').getAttribute('href') === '/class/') {
    ok('  分组标题链到集合落地页 /class/');
  } else bad('  分组标题链接不对');

  if (cs[0] && cs[0].classList.contains('card-lead')) ok('  第一张卡带 card-lead（跨两列）');
  else bad('  第一张卡没有 card-lead');

  /* 搜索：命中标题，且不显示分组标题 */
  const qEl = doc.getElementById('q');
  qEl.value = '月相';
  qEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(160);
  if (cards(doc).length === 1 && doc.querySelectorAll('#grid > .group-head').length === 0) ok('  搜索时只留命中卡片、收起分组标题');
  else bad('  搜索行为不对：' + cards(doc).length + ' 卡 / ' + doc.querySelectorAll('#grid > .group-head').length + ' 分组');

  qEl.value = '';
  qEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(160);

  /* 右键菜单 */
  const fresh = cards(doc)[0];
  fresh.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  await sleep(30);
  const ctxHead = doc.querySelector('#ctx .ctx-head');
  if (ctxHead && ctxHead.textContent === 'class/homework.html') ok('  右键菜单标题：' + ctxHead.textContent);
  else bad('  右键菜单标题：' + (ctxHead && ctxHead.textContent));

  if (logs.some((l) => /error/.test(l))) meh('  控制台有 error：' + logs.filter((l) => /error/.test(l)).join(' | '));
}

/* 与 dist 里的旧首页对照：卡片外观必须一致，只有「分组 + 少了 811 工具箱那张卡」是有意的变化 */
console.log('\n── 6. 首页与改造前对照 ──');
{
  const oldFile = path.join(distRoot, PAGE_HOME);
  if (!fs.existsSync(oldFile)) {
    meh('dist/index.html 不存在，跳过首页对照');
  } else {
    const old = boot({ html: fs.readFileSync(oldFile, 'utf8'), pageUrl: 'http://x/index.html', root: distRoot });
    const neu = boot({ html: homeHtml, pageUrl: 'http://x/index.html', root: siteRoot });
    await sleep(200);
    await sleep(200);

    const mapOf = (doc, url, opts) => {
      const m = new Map();
      for (const c of cards(doc)) {
        const href = new URL(c.getAttribute('href'), url).pathname;
        m.set(href, canonCard(c, url, opts));
      }
      return m;
    };
    const oldMap = mapOf(old.doc, 'http://x/index.html', { ignoreIcon: true, ignoreDesc: true });
    const newMap = mapOf(neu.doc, 'http://x/index.html', { ignoreIcon: true, ignoreDesc: true });
    const oldIcons = mapOf(old.doc, 'http://x/index.html', {});
    const newIcons = mapOf(neu.doc, 'http://x/index.html', {});
    const oldPlain = mapOf(old.doc, 'http://x/index.html', { ignoreIcon: true });
    const newPlain = mapOf(neu.doc, 'http://x/index.html', { ignoreIcon: true });

    const changed = [];
    /* 有意改掉的文案不算回归。原先这里豁免过两张旧卡（文档站 / BLOG）；
       现在它们直接换了地址（→ /p/ 与 /p/post/blog.html），会走下面的
       removed / added 提示，所以这份豁免名单已经空了。 */
    const intended = new Set();
    for (const [href, canon] of newMap) {
      if (!oldMap.has(href)) continue;                 /* 新加的条目不算回归 */
      if (intended.has(href)) continue;
      if (oldMap.get(href) !== canon) changed.push(href);
    }
    const removed = [...oldMap.keys()].filter((h) => !newMap.has(h));
    const added = [...newMap.keys()].filter((h) => !oldMap.has(h));
    /* 图标变化单独看：旧版按文件名猜图标（所有 .html 都命中 html → 画成了函数曲线），
       新版用清单里写的图标，所以这些「不一致」正是修好的 bug。 */
    const iconChanged = [...newMap.keys()].filter((h) =>
      oldIcons.has(h) && oldIcons.get(h) !== newIcons.get(h));
    /* 简介变化：811 两张卡改成了 class/tools.json 里定的文案（与 811 中枢页一致） */
    const descChanged = [...newMap.keys()].filter((h) =>
      oldPlain.has(h) && oldPlain.get(h) !== newPlain.get(h));

    if (changed.length) {
      bad(`${changed.length} 张卡片结构 / 文案与改造前不一致：` + changed.join(', '));
      const first = changed[0];
      const a = oldMap.get(first), b = newMap.get(first);
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      console.log('      首个差异在第 ' + i + ' 个字符：');
      console.log('        旧 …' + a.slice(Math.max(0, i - 70), i + 90));
      console.log('        新 …' + b.slice(Math.max(0, i - 70), i + 90));
    } else if (oldMap.size) {
      ok(`${newMap.size} 张卡片的结构 / 类名 / 文案与改造前逐字符一致（忽略图标）`);
    }
    if (iconChanged.length) meh(`这 ${iconChanged.length} 张卡的图标变了（旧版按文件名猜，现在照清单写）：` + iconChanged.join(', '));
    if (descChanged.length) meh(`这 ${descChanged.length} 张卡的简介变了（现在统一用清单里的文案）：` + descChanged.join(', '));
    if (removed.length) meh('比旧版少了这些卡片（811 分组标题取代了 811 工具箱那张）：' + removed.join(', '));
    if (added.length) meh('比旧版多了这些卡片：' + added.join(', '));
  }
}

console.log(`\n${fail ? `✗ ${fail} 项失败` : '✓ 全部通过'}${warn ? `，${warn} 项提示` : ''}\n`);
process.exit(fail ? 1 : 0);
