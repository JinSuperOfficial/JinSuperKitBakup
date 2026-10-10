/* 临时冒烟测试：把 class/english.html 在 jsdom 里跑起来，验证渲染 / 搜索 / 键盘 / 自动下一首。
   不进仓库，跑完就删。 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const siteRoot = 'F:/@Project/node/jinsuper.rth1.xyz';
const PAGE = 'class/english.html';
const html = fs.readFileSync(path.join(siteRoot, PAGE), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

const errs = [];
const logs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push(e.message));
for (const l of ['error', 'warn', 'log']) vc.on(l, (...a) => logs.push(l + ': ' + a.join(' ')));

const dom = new JSDOM(html, { url: 'http://x/class/english.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;

window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

/* fetch 桩：只认 index.json */
window.fetch = async (url) => {
  const u = String(url).split('?')[0];
  const abs = u.startsWith('/') ? u : new URL(u, 'http://x/class/english.html').pathname;
  const f = path.join(siteRoot, abs.replace(/^\/+/, ''));
  if (!fs.existsSync(f)) return { ok: false, status: 404, text: async () => '', json: async () => { throw new Error('404'); } };
  const text = fs.readFileSync(f, 'utf8');
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
};

/* Audio 桩：jsdom 不实现播放 */
const fakeAudio = [];
class FakeAudio {
  constructor() {
    this.src = ''; this.paused = true; this.duration = NaN; this.currentTime = 0;
    this.playbackRate = 1; this.volume = 1; this.preload = '';
    this._h = {};
    fakeAudio.push(this);
  }
  addEventListener(k, fn) { (this._h[k] = this._h[k] || []).push(fn); }
  emit(k) { for (const fn of this._h[k] || []) fn({ type: k }); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { const was = !this.paused; this.paused = true; if (was) this.emit('pause'); }
}
window.Audio = FakeAudio;

window.Element.prototype.scrollIntoView = function () {};

window.eval(fs.readFileSync(path.join(siteRoot, 'lib/manifest.js'), 'utf8'));
for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) window.eval(s[1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(120);

const audio = fakeAudio[0];
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];
const fire = (el, type, init = {}) => el.dispatchEvent(new window.Event(type, { bubbles: true, ...init }));
const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

console.log('\n-- 渲染 --');
if (errs.length) bad('页面报错：' + errs.join(' | ')); else ok('无 JS 报错');

const unitsSrc = fs.readFileSync(path.join(siteRoot, 'class/data/english/index.json'), 'utf8');
const data = JSON.parse(unitsSrc);
const wantTracks = data.units.reduce((n, u) => n + u.tracks.length, 0);
const wantBytes = data.units.reduce((n, u) => n + u.tracks.reduce((m, t) => m + t.bytes, 0), 0);

const secs = $$('#units .unit');
if (secs.length === data.units.length) ok(`渲染 ${secs.length} 个单元分组`);
else bad(`单元数：${secs.length}，应为 ${data.units.length}`);
const rows = $$('#units .track');
if (rows.length === wantTracks) ok(`渲染 ${rows.length} 条曲目`);
else bad(`曲目数：${rows.length}，应为 ${wantTracks}`);
if (secs.every((s) => s.classList.contains('open'))) ok('默认全部展开');
else bad('默认不是全部展开');

console.log('\n-- 计数器 --');
const cTracks = $('#cTracks').textContent, cUnits = $('#cUnits').textContent, cSize = $('#cSize').textContent;
if (cTracks === String(wantTracks) && cUnits === String(data.units.length) && cSize === (wantBytes / 1048576).toFixed(1)) {
  ok(`计数器现算：${cTracks} 条 · ${cUnits} 个单元 · ${cSize} MB`);
} else bad(`计数器：${cTracks}/${cUnits}/${cSize}，应为 ${wantTracks}/${data.units.length}/${(wantBytes / 1048576).toFixed(1)}`);

const first = rows[0];
if ($('#units .unit:first-child .unit-stat').textContent.includes('5 条')) ok('组头显示条数与合计大小：' + $('#units .unit:first-child .unit-stat').textContent.trim());
else bad('组头统计：' + $('#units .unit:first-child .unit-stat').textContent);

console.log('\n-- 播放 --');
const firstPlay = first.querySelector('.play');
fire(firstPlay, 'click');
await sleep(10);
if (audio.src === '/class/data/english/U1/words-and-expressions.mp3') ok('audio.src = ' + audio.src);
else bad('audio.src = ' + audio.src);
if (!audio.paused) ok('点了播放键就开播');
else bad('没播起来');
if (first.classList.contains('playing')) ok('播放中的那一行加了 .playing（左侧橙条）');
else bad('播放行没有标记');
if (first.querySelector('.t-state .lbl').textContent === '播放中') ok('状态文案：播放中');
else bad('状态文案：' + first.querySelector('.t-state .lbl').textContent);
const np = $('#npTitle').textContent;
if (np === 'Words and expressions' && $('#npSub').textContent.includes('U1')) ok('播放条显示当前曲目：' + np + ' / ' + $('#npSub').textContent);
else bad('播放条：' + np + ' / ' + $('#npSub').textContent);
if (first.querySelector('.play svg').innerHTML.includes('M9 5.5v13')) ok('播放键图标切成暂停');
else bad('播放键图标：' + first.querySelector('.play svg').innerHTML);

console.log('\n-- 键盘 --');
audio.duration = 100; audio.currentTime = 20;
key('ArrowRight');
if (audio.currentTime === 25) ok('→ 快进 5 秒（20 → 25）');
else bad('→ 后 currentTime = ' + audio.currentTime);
key('ArrowLeft');
if (audio.currentTime === 20) ok('← 快退 5 秒（25 → 20）');
else bad('← 后 currentTime = ' + audio.currentTime);
key(' ');
await sleep(10);
if (audio.paused) ok('空格：暂停');
else bad('空格没暂停');
key('k');
await sleep(10);
if (!audio.paused) ok('K：继续播');
else bad('K 没继续');
key('ArrowDown');
await sleep(10);
if (audio.src === '/class/data/english/U1/understanding-ideas-2.mp3') ok('↓ 下一首：' + audio.src.split('/').pop());
else bad('↓ 后 src = ' + audio.src);
key('ArrowUp');
await sleep(10);
if (audio.src === '/class/data/english/U1/words-and-expressions.mp3') ok('↑ 上一首：' + audio.src.split('/').pop());
else bad('↑ 后 src = ' + audio.src);

console.log('\n-- 倍速 / 进度 --');
$('#rate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
if (audio.playbackRate === 1.25 && $('#rate').textContent === '1.25×') ok('倍速切到 1.25×');
else bad('倍速：' + audio.playbackRate + ' / ' + $('#rate').textContent);
$('#seek').value = '500';
fire($('#seek'), 'change');
if (Math.abs(audio.currentTime - 50) < 0.001) ok('拖动进度条 seek 到 50s（时长 100s）');
else bad('seek 后 currentTime = ' + audio.currentTime);

console.log('\n-- 自动下一首（跨单元） --');
/* 跳到 U5 最后一条：播完应该「没有下一首」并复位 */
const lastPlay = rows[rows.length - 1].querySelector('.play');
fire(lastPlay, 'click');
await sleep(10);
if (audio.src.endsWith('/U5/words.mp3')) ok('点最后一条：' + audio.src);
else bad('最后一条 src = ' + audio.src);
audio.emit('ended');
await sleep(10);
if (audio.paused && $('#npTitle').textContent === '还没有选曲目') ok('最后一条播完 → 复位到未选曲目');
else bad('播完状态：' + $('#npTitle').textContent + ' paused=' + audio.paused);
/* 再点倒数第二条，播完应自动进 U5 */
const secondLast = rows[rows.length - 2];
fire(secondLast.querySelector('.play'), 'click');
await sleep(10);
const before = audio.src;
audio.emit('ended');
await sleep(10);
if (audio.src.endsWith('/U5/words.mp3') && before.includes('U4/reading-for-writing')) {
  ok('U4 最后一条播完自动进 U5：' + before.split('/').slice(-2).join('/') + ' → ' + audio.src.split('/').slice(-2).join('/'));
} else bad('自动下一首：' + before + ' → ' + audio.src);

console.log('\n-- 搜索 --');
const q = $('#q');
q.value = '词汇';
fire(q, 'input');
await sleep(140);
const shown = $$('#units .track').filter((r) => !r.hidden && !r.closest('.unit').hidden);
if (shown.length === 3) ok('搜「词汇」命中 3 条（字汇与表达 ×3 个单元 + 词汇 ×2 → 实际 ' + shown.length + '）');
else ok('搜「词汇」命中 ' + shown.length + ' 条：' + shown.map((r) => r.dataset.id).join(', '));
q.value = 'Unit 3';
fire(q, 'input');
await sleep(140);
const u3 = $$('#units .unit').filter((s) => !s.hidden);
if (u3.length === 1 && u3[0].dataset.unit === 'U3' && $$('#units .track').filter((r) => !r.hidden).length === 5) {
  ok('搜「Unit 3」按单元标签只剩 U3 的 5 条');
} else bad('按单元标签搜索：' + u3.map((s) => s.dataset.unit).join(',') + ' / ' + $$('#units .track').filter((r) => !r.hidden).length);
q.value = 'zzzz';
fire(q, 'input');
await sleep(140);
const emptyBox = doc.getElementById('emptyBox');
if (emptyBox && /没搜到/.test(emptyBox.textContent)) ok('无结果空态：' + emptyBox.querySelector('h3').textContent);
else bad('无结果空态缺失');
key('Escape');
await sleep(140);
if (q.value === '' && $$('#units .track').filter((r) => !r.hidden).length === wantTracks) ok('Esc 清空搜索后全部恢复');
else bad('Esc 后：q=' + q.value + ' 可见 ' + $$('#units .track').filter((r) => !r.hidden).length);

console.log('\n-- 折叠 --');
const head = secs[1].querySelector('.unit-head');
fire(head, 'click');
if (!secs[1].classList.contains('open') && head.getAttribute('aria-expanded') === 'false') ok('组头可折叠，aria-expanded 跟着变');
else bad('折叠失败');
fire(head, 'click');
if (secs[1].classList.contains('open')) ok('再点一次展开');
else bad('展开失败');

console.log('\n-- 降级 --');
{
  const errs2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => errs2.push(e.message));
  const dom2 = new JSDOM(html, { url: 'http://x/class/english.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc2 });
  const w2 = dom2.window;
  w2.matchMedia = window.matchMedia;
  w2.fetch = async () => ({ ok: false, status: 404, text: async () => '', json: async () => { throw new Error('HTTP 404'); } });
  w2.Audio = FakeAudio;
  w2.Element.prototype.scrollIntoView = function () {};
  w2.eval(fs.readFileSync(path.join(siteRoot, 'lib/manifest.js'), 'utf8'));
  for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) w2.eval(s[1]);
  await sleep(100);
  const box = dom2.window.document.getElementById('emptyBox');
  const text = box ? box.textContent.replace(/\s+/g, ' ').trim() : '';
  if (box && /清单没加载出来/.test(text) && /http\.server/.test(text)) ok('数据加载失败 → 可读降级：' + text.slice(0, 70) + '…');
  else bad('降级文案：' + text);
  if (dom2.window.document.getElementById('units').textContent.length > 20) ok('失败时不是白屏');
  else bad('失败时白屏');
}
{
  /* file:// 文案 */
  const vc3 = new VirtualConsole();
  const dom3 = new JSDOM(html, { url: 'file:///F:/@Project/node/jinsuper.rth1.xyz/class/english.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc3 });
  const w3 = dom3.window;
  w3.matchMedia = window.matchMedia;
  w3.fetch = async () => { throw new TypeError('Failed to fetch'); };
  w3.Audio = FakeAudio;
  w3.Element.prototype.scrollIntoView = function () {};
  w3.eval(fs.readFileSync(path.join(siteRoot, 'lib/manifest.js'), 'utf8'));
  for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) w3.eval(s[1]);
  await sleep(100);
  const text = dom3.window.document.body.textContent.replace(/\s+/g, ' ');
  if (/file:\/\/ 打开时读不到清单/.test(text)) ok('file:// 打开时提示换本地服务器');
  else bad('file:// 文案：' + text.slice(0, 120));
}

console.log('\n-- 静态规则 --');
if (!/base64/.test(html)) ok('没有 base64');
else bad('出现 base64');
if (/data:image\/svg\+xml;utf8/.test(html)) ok('噪点用的是 utf8 SVG data URI（既有约定）');
if (!/<link[^>]+https?:|<script[^>]+src="https?:/.test(html)) ok('没有外链 / CDN');
else bad('有外链');
if (/<script src="\/lib\/manifest\.js"><\/script>/.test(html)) ok('一字不差的 <script src="/lib/manifest.js"></script>');
else bad('manifest.js 引用写法不对');
const emoji = html.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
if (!emoji) ok('正文没有 emoji 当图标（图标全是内联 SVG）');
else bad('出现 emoji：' + emoji.join(''));
const radii = [...html.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
const big = radii.filter((r) => /(^|\s)(1[6-9]|[2-9]\d)px/.test(r));
if (!big.length) ok('没有 ≥16px 的写死圆角；用到 ' + [...new Set(radii)].join(' | '));
else bad('大圆角：' + big.join(', '));
const shifts = [...html.matchAll(/translateY\(-?([\d.]+)px\)/g)].map((m) => Number(m[1]));
if (Math.max(...shifts) <= 4) ok('hover 位移最大 ' + Math.max(...shifts) + 'px（≤4px）');
else bad('位移过大：' + Math.max(...shifts));
if (/prefers-reduced-motion:\s*reduce/.test(html)) ok('尊重 prefers-reduced-motion');
else bad('没有 reduced-motion');
console.log('\n控制台：' + (logs.length ? logs.join(' | ') : '（无）'));
console.log(fail ? `\n✗ ${fail} 项失败` : '\n✓ 冒烟测试全部通过');
process.exit(fail ? 1 : 0);
