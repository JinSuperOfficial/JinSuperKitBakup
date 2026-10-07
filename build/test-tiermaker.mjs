/**
 * 从夯到拉生成器（Skills/tools/tiermaker.html）的行为测试。
 *
 * 为什么要写它：这个页面自己扛着很重的几何与状态逻辑 —— 网格吸附、落点下标、
 * 长按判定、延迟写入、三套预设、标签风格。这些光看代码不放心。
 *
 * jsdom 的三个坑，这里都绕开了：
 *   1. 没有排版引擎，getBoundingClientRect 一律返回 0
 *      → 自己造版面：给每栏素材区钉一个矩形，素材按 84px + 8px 间隔排开
 *   2. 不会去加载 <img>
 *      → 把 window.Image 换成按 SVG 上的 width / viewBox 报尺寸的替身
 *   3. 写入是合并延迟的
 *      → 断言 localStorage 之前先 await settle()（比最长合并窗口还长）
 *
 * 跑法：node build/test-tiermaker.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { siteRoot } from './paths.mjs';

const pagePath = path.join(siteRoot, 'Skills', 'tools', 'tiermaker.html');
const html = fs.readFileSync(pagePath, 'utf8');

let fail = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); fail++; };
const is = (got, want, m) => {
  if (got === want) ok(`${m}（${JSON.stringify(got)}）`);
  else bad(`${m}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
};
const like = (re, s, m) => {
  if (re.test(String(s))) ok(`${m}（${String(s).slice(0, 60)}）`);
  else bad(`${m}：${JSON.stringify(String(s).slice(0, 120))} 不匹配 ${re}`);
};

/* ═══ 装载 ═══ */
console.log('\n── 1. 装载页面 ──');

const sameUrl = 'http://127.0.0.1:8799/Skills/tools/tiermaker.html';
try {
  const pre = new JSDOM('', { url: sameUrl });
  pre.window.localStorage.clear();
  pre.window.close();
} catch (e) { /* localStorage 不可用就算了 */ }

const pageErrors = [];
const vc = new VirtualConsole();
vc.on('error', (m) => pageErrors.push(String(m)));
vc.on('jsdomError', (e) => pageErrors.push('jsdomError: ' + e.message));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: sameUrl,
  virtualConsole: vc,
  beforeParse(win) {
    /* 替身 Image：不联网，按 SVG 上写的 width / viewBox 报尺寸 */
    win.Image = class FakeImage {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null; }
      set src(v) {
        /* 页面把它编码成 data URL 了，得像浏览器一样先解回来再量 */
        let str = String(v);
        const comma = str.indexOf(',');
        if (str.indexOf('data:image/svg') === 0 && comma > 0) {
          try { str = decodeURIComponent(str.slice(comma + 1)); } catch (e) { /* 解不开就用原文 */ }
        }
        const vb = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(str);
        const wa = /<svg[^>]*\swidth="([\d.]+)"/.exec(str);
        const ha = /<svg[^>]*\sheight="([\d.]+)"/.exec(str);
        this.naturalWidth = vb ? parseFloat(vb[1]) : wa ? parseFloat(wa[1]) : 40;
        this.naturalHeight = vb ? parseFloat(vb[2]) : ha ? parseFloat(ha[1]) : 40;
        this._src = str;
        win.setTimeout(() => { if (this.onload) this.onload(); }, 0);
      }
      get src() { return this._src; }
    };
  },
});
const { window } = dom;
const doc = window.document;
const tick = () => new Promise((r) => window.setTimeout(r, 10));
/* 页面把写入合并成延迟任务（最长 350ms），断言 localStorage 之前要等它落盘 */
const settle = () => new Promise((r) => window.setTimeout(r, 430));

/* ═══ 假版面 ═══ */
const PITCH = 92;          // 84 宽 + 8 间隔
const LANE_H = 92;
const CHIPS_TOP0 = 120;
const CHIPS_LEFT = 140;
const CHIPS_W = 900;

const rect = (x, y, w, h) => ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() { return this; } });
function layout() {
  Array.from(doc.querySelectorAll('#board .lane')).forEach((lane, li) => {
    const top = CHIPS_TOP0 + li * (LANE_H + 8);
    const box = lane.querySelector('.chips');
    if (!box) return;
    box.getBoundingClientRect = () => rect(CHIPS_LEFT, top, CHIPS_W, LANE_H);
    let x = CHIPS_LEFT + 8;
    Array.from(box.children).forEach((kid) => {
      const tile = kid.classList.contains('slot') || kid.classList.contains('chip');
      const w = tile ? 84 : 120, h = tile ? 84 : 20;
      const left = x;                     // 必须快照：闭包抓 x 的话，全部块会钉到同一个左坐标
      kid.getBoundingClientRect = () => rect(left, top + 4, w, h);
      x += w + 8;
    });
  });
}
const t3Top = () => CHIPS_TOP0 + 2 * (LANE_H + 8);
const reserveTop = () => CHIPS_TOP0 + 5 * (LANE_H + 8);

/* ═══ 事件工具 ═══ */
function pev(type, x, y) {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
const lane = (k) => doc.querySelector(`[data-lane="${k}"]`);
const chips = (k) => doc.querySelector(`[data-drop="${k}"]`);
const idsIn = (k) => Array.from(chips(k).querySelectorAll('.chip')).map((c) => c.getAttribute('data-id'));
const liveIds = () => Array.from(doc.querySelectorAll('#board .chip')).filter((c) => c.isConnected).map((c) => c.getAttribute('data-id'));
const storage = () => JSON.parse(window.localStorage.getItem('tiermaker.v1') || 'null');
const titleOf = (k) => lane(k).querySelector('.lane-title').textContent;
const TIERS_KEYS = ['t1', 't2', 't3', 't4', 't5'];
/* jsdom 把内联色值归一成 rgb()，转回 #rrggbb 好算对比度 */
function rgbToHex(v) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(v));
  if (!m) return String(v);
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
const fillOf = (id) => Array.from(doc.querySelectorAll(`#presetBar [data-preset="${id}"] .chip5 i`))
  .map((i) => String(i.getAttribute('style')).replace(/^background:\s*/, '').replace(/;?\s*$/, '').trim());

async function pushSvg(color, size) {
  const s = size || 40;
  const box = doc.querySelector('#svgCode');
  box.value = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" fill="${color}"/></svg>`;
  click(doc.querySelector('#svgGo'));
  await tick();
}

/**
 * 拖拽：pointerdown → 先走一大步把拖拽启动（跨过 5px 阈值）→ 再走回落点 → 抬手。
 * 早先只走 1px：那一步既触发 beginDrag、又立刻按当时的占位块算落点，
 * 量到的是「还没被拖起来」的下标 —— 那是模拟自己的毛病，不是页面的。
 */
function drag(id, px, py) {
  const el = doc.querySelector(`.chip[data-id="${id}"]`);
  if (!el) { bad(`拖拽失败：找不到素材 ${id}`); return; }
  /* 关键：每次派发事件「之前」都重钉一遍版面。
     真浏览器里 getBoundingClientRect 永远反映当前 DOM；如果只在事件之后钉，
     页面处理下一个事件时就会读到过期的矩形（旧块和新占位块的位置混在一起），
     量出来的落点下标是错的 —— 那是模拟的问题，不是页面的。 */
  layout();
  el.dispatchEvent(pev('pointerdown', px, py));
  layout();
  doc.dispatchEvent(pev('pointermove', px + 40, py + 40));
  layout();
  doc.dispatchEvent(pev('pointermove', px, py));
  layout();
  doc.dispatchEvent(pev('pointerup', px, py));
  layout();
}

(async () => {

  if (pageErrors.length) bad('页面有 JS 报错：' + pageErrors.join(' / '));
  else ok('页面装载无 JS 报错');

  is(doc.querySelectorAll('#board .lane').length, 6, '五个等级 + 备选栏 = 6 栏');
  is(titleOf('t1'), '夯', '第 1 栏标签是「夯」');
  is(titleOf('t2'), '顶级', '第 2 栏标签是「顶级」');
  is(titleOf('t3'), '人上人', '第 3 栏标签是「人上人」');
  is(titleOf('t4'), 'NPC', '第 4 栏标签是 NPC');
  is(titleOf('t5'), '拉完了', '第 5 栏标签是「拉完了」');
  is(titleOf('reserve').replace(/\s/g, ''), '备选', '底部是「备选」栏');
  like(/color-mix\(in srgb, var\(--theme/, doc.querySelector('style').textContent,
    '备选栏底色由主题色 color-mix 算深，不是写死的色值');
  is(lane('reserve').querySelector('.lane-title').style.background, '',
    '备选栏标签底色走 CSS 变量（没在内联样式里写死）');

  /* ═══ 2. 三套预设 ═══ */
  console.log('\n── 2. 三套预设 A / B / C ──');
  const presets = Array.from(doc.querySelectorAll('#presetBar [data-preset]'));
  is(presets.map((b) => b.getAttribute('data-preset')).join(','), 'A,B,C', '顶栏有三个预设按钮 A/B/C');
  is(presets.filter((b) => b.classList.contains('on')).length, 1, '同一时刻只有一套预设是选中态');
  is(presets[0].classList.contains('on'), true, '默认选中的是 A 经典');
  is(fillOf('A').join(','), '#E53935,#FFC107,#FFEB3B,#F5F5DC,#FFFFFF',
    '预设 A 的色号与参考图逐个一致（红 / 金黄 / 亮黄 / 米白 / 纯白）');
  is(fillOf('B').length, 5, '预设 B 也是五档');
  is(fillOf('C').length, 5, '预设 C 也是五档');
  is(new Set(fillOf('B').concat(fillOf('C'))).size, 10, 'B、C 两套配色互不相同，也和 A 不同');

  click(doc.querySelector('#presetBar [data-preset="B"]'));
  is(window.getComputedStyle(lane('t1').querySelector('.lane-title')).backgroundColor, 'rgb(18, 32, 35)',
    '切到预设 B 后第 1 栏背景变成 B 的第一档（#122023）');
  is(titleOf('t1'), '夯', '切预设只换配色，标签文字（夯）不动');
  is(doc.querySelector('#presetBar [data-preset="B"]').classList.contains('on'), true, '预设 B 成为选中态');
  is(doc.querySelector('#presetBar [data-preset="A"]').classList.contains('on'), false, '预设 A 取消选中');
  /* 设置面板左侧的预览小方块也得跟着换字色（曾经漏了它，深色块上还是黑字） */
  const tagB1 = doc.querySelector('#tierRows [data-tag="t1"]');
  is(rgbToHex(window.getComputedStyle(tagB1).color), '#ffffff', '设置面板预览方块在深色底上自动用白字');
  await settle();
  is(storage().cfg.preset, 'B', '预设选择落盘了');
  click(doc.querySelector('#presetBar [data-preset="C"]'));
  is(window.getComputedStyle(lane('t3').querySelector('.lane-title')).backgroundColor, 'rgb(232, 80, 158)',
    '切到预设 C 后第 3 栏是 C 的第三档（#E8509E）');

  /* ═══ 3. 标签风格 ═══ */
  console.log('\n── 3. 标签风格：中文 ↔ T0–T4 ──');
  click(doc.querySelector('#labelStyle [data-style="t"]'));
  is(titleOf('t1'), 'T0', '切编号风格后第 1 栏是 T0');
  is(titleOf('t5'), 'T4', '第 5 栏是 T4');
  is(window.getComputedStyle(lane('t3').querySelector('.lane-title')).backgroundColor, 'rgb(232, 80, 158)',
    '换标签风格不影响配色');
  click(doc.querySelector('#labelStyle [data-style="cn"]'));
  is(titleOf('t1'), '夯', '切回中文风格后又是「夯」');
  is(titleOf('t3'), '人上人', '第 3 栏是「人上人」');

  const labelInput = doc.querySelector('#tierRows [data-label-input="t1"]');
  labelInput.value = '神';
  labelInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  is(titleOf('t1'), '神', '改设置里的文字后栏目实时更新');
  await settle();
  is(storage().cfg.preset, 'custom', '手动改过之后标记为「自定义」');
  is(storage().cfg.labels.t1, '神', '自定义的标签文字也落盘了');

  /* ═══ 4. SVG 代码 ═══ */
  console.log('\n── 4. 粘贴 SVG 代码 → 备选栏 ──');
  await settle();
  /* 首次访问页面会塞一个示例素材（有意的引导），所以这里记基线，
     只比「多了几个」，不假设备选栏一开始是空的。 */
  const base = idsIn('reserve').length;
  const baseItems = storage().items.length;
  is(base, 1, '首次访问的示例素材在备选栏里（有且只有一个）');
  is(baseItems, base, '存档里的素材数与页面一致（示例已落盘）');

  await pushSvg('#4EA8DE');
  await settle();
  is(idsIn('reserve').length, base + 1, '粘贴 SVG 后备选栏多了一个素材');
  is(doc.querySelector('#svgMsg').textContent, '已加入备选栏', '给了「已加入备选栏」的反馈');
  is(doc.querySelector('#svgCode').value, '', '加入后清空了代码框');

  const newItem = storage().items.filter((i) => i.name === 'SVG 素材').pop();
  is(newItem.kind, 'svg', '登记成 svg 类型（右键能复制源码）');
  like(/^<svg /, newItem.svgText, 'SVG 源码被原样留下来了');
  is(newItem.w, 40, '量到了 SVG 的原始宽 40');
  is(newItem.scale, 1, '40px 落在 32～84 区间内，不放大也不缩小');
  is(newItem.src.indexOf('data:image/svg+xml') === 0, true, '用 data: 地址存着（没有外链）');

  await pushSvg('#00FF00', 600);
  await settle();
  const bigItem = storage().items.filter((i) => i.name === 'SVG 素材').pop();
  is(bigItem.w, 600, '600px 的图登记了真实宽 600');
  is(bigItem.scale < 1, true, '600px 的图被等比缩小到合适大小（scale 小于 1）');

  const box2 = doc.querySelector('#svgCode');
  box2.value = '这不是 SVG';
  click(doc.querySelector('#svgGo'));
  is(idsIn('reserve').length, base + 2, '非 SVG 文本不会加进去');
  like(/不像一整段 SVG/, doc.querySelector('#svgMsg').textContent, '并且提示了原因');

  /* ═══ 5. 拖拽落点 ═══ */
  console.log('\n── 5. 拖拽落点：插入下标 ──');
  await pushSvg('#E8509E');
  await pushSvg('#F7A6D0');
  await pushSvg('#A8D3DE');
  const [a, b, c] = idsIn('reserve').slice(-3);
  is(idsIn('t3').length, 0, '这时候 t3 还是空的');

  drag(a, CHIPS_LEFT + 20, t3Top() + 40);                 // 空白处 → 下标 0
  is(idsIn('t3').join(','), a, '拖到最左边 → 落在下标 0');

  drag(b, CHIPS_LEFT + 8 + 2 * PITCH, t3Top() + 40);      // 第一个块右半边 → 下标 1
  is(idsIn('t3').indexOf(b), 1, '拖到第 1 个块右侧 → 落在下标 1');
  is(idsIn('t3').length, 2, 't3 里现在有两个');

  drag(c, CHIPS_LEFT + 8 + 2 * PITCH, t3Top() + 40);
  is(idsIn('t3').length, 3, '三个素材都搬进 t3 了');
  is(idsIn('t3').join(','), [a, b, c].join(','), '顺序与拖放次序一致');

  /* 关键回归：搬走的素材不能留在原栏。
     页面曾经只重画目标栏、不重画来源栏，于是同一条素材在界面上同时挂在两栏。 */
  is(idsIn('reserve').includes(a), false, '搬走后来源栏（备选）里没有残留');
  is(idsIn('reserve').includes(b), false, '第二个也一样没有残留');
  const all = ['t1', 't2', 't3', 't4', 't5', 'reserve'].flatMap(idsIn);
  is(new Set(all).size, all.length, '没有任何素材同时挂在两栏');
  is(liveIds().length, all.length, '页面上的块数与各栏合计一致（没有游离的孤儿块）');

  drag(c, CHIPS_LEFT + 20, reserveTop() + 40);
  is(idsIn('reserve').includes(c), true, '能再拖回备选栏');
  is(idsIn('t3').includes(c), false, '拖回后 t3 里没有了');

  /* 甩一下就抬手：只报一次 pointermove 也要能落位，不能悄悄弹回 */
  const before = idsIn('t2').length;
  const quick = doc.querySelector(`.chip[data-id="${a}"]`);
  layout();
  quick.dispatchEvent(pev('pointerdown', 200, CHIPS_TOP0 + (LANE_H + 8) + 45));
  layout();
  doc.dispatchEvent(pev('pointermove', 210, CHIPS_TOP0 + (LANE_H + 8) + 50));  // 只动 10px
  layout();
  doc.dispatchEvent(pev('pointerup', 210, CHIPS_TOP0 + (LANE_H + 8) + 50));
  layout();
  is(idsIn('t3').includes(a), false, '甩过去之后原栏也清干净了');

  /* ═══ 6. 网格吸附 ═══ */
  console.log('\n── 6. 网格吸附 ──');
  const snapSlider = doc.querySelector('#snapSize');
  is(String(snapSlider.max), '50', '吸附强度滑块上限 50px');
  snapSlider.value = '30';
  snapSlider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  is(storage().cfg.snapSize, 30, '吸附强度落盘');
  is(storage().cfg.snap, true, '拉滑块会顺带把吸附开关打开');

  drag(c, 163, t3Top() + 43);                       // x=163 → 吸到 150 → 第 1 格
  is(idsIn('t3')[0], c, '吸附 30px 时 x=163 吸到 150，落在最前面');
  drag(c, 333, t3Top() + 43);                       // x=333 → 吸到 330 → 末尾
  is(idsIn('t3').indexOf(c), idsIn('t3').length - 1, '吸附 30px 时 x=333 吸到 330，落在末尾');

  snapSlider.value = '0';
  snapSlider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  is(storage().cfg.snapSize, 0, '调到 0 = 不吸附');
  drag(c, 200, CHIPS_TOP0 + 3 * (LANE_H + 8) + 45);
  is(idsIn('t4').includes(c), true, '不吸附时照样能拖到别的栏');

  const snapOn = doc.querySelector('#snapOn');
  snapOn.checked = false;
  snapOn.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  is(storage().cfg.snap, false, '关掉吸附开关会落盘');

  /* ═══ 7. 右键菜单 ═══ */
  console.log('\n── 7. 右键菜单：调大小 / 移除 ──');
  const target = doc.querySelector('.chip[data-id]');
  const tid = target.getAttribute('data-id');
  const beforeW = target.style.width;
  target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: 200, clientY: 300 }));
  const menu = doc.querySelector('.menu');
  is(!!menu, true, '右键弹出自定义菜单（阻止了浏览器默认菜单）');
  is(!!menu.querySelector('#mScale'), true, '菜单里有大小滑块');
  const acts = Array.from(menu.querySelectorAll('[data-act]')).map((b) => b.getAttribute('data-act'));
  ['fit', 'min', 'del'].forEach((k) => is(acts.includes(k), true, `菜单里有「${k}」项`));
  is(acts.includes('copy'), true, '这个素材是 SVG，所以有「复制 SVG 代码」');

  const slider = menu.querySelector('#mScale');
  slider.value = '180';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => window.requestAnimationFrame(() => r()));
  is(doc.querySelector(`.chip[data-id="${tid}"]`).style.width !== beforeW, true, '拉滑块之后素材尺寸立刻变了');

  click(menu.querySelector('[data-act="fit"]'));
  is(!doc.querySelector('.menu'), true, '点过菜单项后菜单自己关掉');

  const victim = doc.querySelector('.chip[data-id]').getAttribute('data-id');
  layout();
  doc.querySelector(`.chip[data-id="${victim}"]`).dispatchEvent(
    new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: 200, clientY: 300 }));
  click(doc.querySelector('.menu [data-act="del"]'));
  is(!(doc.querySelector(`.chip[data-id="${victim}"]`) || {}).isConnected, true, '菜单里的「移除」把素材从页面上拿掉了');
  await settle();
  is(storage().items.some((i) => i.id === victim), false, '存档里也删了（不会刷新后又冒出来）');

  /* ═══ 8. 键盘 ═══ */
  console.log('\n── 8. 键盘操作 ──');
  /* 这一节自己铺料：前面几节会删素材，别指望 t3 里还剩几个 */
  await pushSvg('#123456');
  await pushSvg('#654321');
  await settle();
  const fresh = idsIn('reserve').slice(-2);
  fresh.forEach((id) => drag(id, CHIPS_LEFT + 20, t3Top() + 40));
  const kids = idsIn('t3');
  if (kids.length >= 2) {
    const id = kids[0];
    doc.querySelector(`.chip[data-id="${id}"]`).dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    layout();
    is(idsIn('t3').indexOf(id), 1, '按 → 在栏内往后挪一格');
    doc.querySelector(`.chip[data-id="${id}"]`).dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    layout();
    is(idsIn('t4').includes(id), true, '按 ↓ 换到下一栏');
    doc.querySelector(`.chip[data-id="${id}"]`).dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    is(!(doc.querySelector(`.chip[data-id="${id}"]`) || {}).isConnected, true, '按 Delete 删掉素材');
  } else bad('t3 里的素材不够，测不了键盘换位');

  /* ═══ 9. 存档 ═══ */
  console.log('\n── 9. 本地存档 ──');
  await settle();
  const saved = storage();
  is(!!saved && !!saved.cfg && !!saved.order, true, 'localStorage 里有 cfg 和 order');
  is(Array.isArray(saved.items), true, '素材以数组形式存着');
  is(saved.items.every((i) => typeof i.src === 'string' && i.src.indexOf('data:') === 0), true,
    '素材都用 data: 地址存着');
  is(saved.cfg.preset, 'custom', '自定义状态也存下来了');
  is(['cdn.', 'unpkg', 'jsdelivr'].filter((w) => html.includes(w)).length, 0, '页面里没有任何 CDN 字样');
  is(/base64/.test(html), false, '页面里没有出现 base64（平台硬规则）');
  is(/<script[^>]+src="https?:/.test(html), false, '没有外链脚本');

  /* ═══ 10. 延迟写入不能吃掉新素材 ═══ */
  console.log('\n── 10. 延迟写入 + 继续加素材 ──');
  /* 回归用例：曾经 save() 里缓存了一份素材列表快照，而 saveSoon 是延迟写入 ——
     先点一下预设（排一次延迟写）、在它落盘之前又贴张图，到点写出去的就是旧快照，
     刷新后这张图就没了。现在 save() 每次现取，且「更早的写入」不会被推迟。 */
  click(doc.querySelector('#presetBar [data-preset="A"]'));
  await pushSvg('#FFC107');
  const expectedOrder = idsIn('reserve').length;
  const expectedChips = liveIds().length;
  await settle();
  is(storage().items.length, expectedChips, '落盘后的素材数与页面上的块数一致（没被旧快照覆盖）');
  is(((storage().order || {}).reserve || []).length, expectedOrder, '备选栏顺序也一起落盘了');
  is(doc.querySelector('#presetBar [data-preset="A"]').classList.contains('on'), true, '延迟写入之后预设选择仍然正确');
  is(window.localStorage.getItem('tiermaker.v1.seen'), '1', '首次访问标记还在');

  /* ═══ 11. 等级色块上的字必须读得清 ═══ */
  console.log('\n── 11. 标签对比度（WCAG AA）──');
  /* 曾经把字色写死成深色，B 冷调第一档 #122023 上的「夯」几乎看不见。
     现在按对比度自动选黑/白字，这里守住 4.5:1 这条线。 */
  const relLum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const wcag = (a, b) => {
    const la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  let worst = 99;
  ['A', 'B', 'C'].forEach((id) => {
    click(doc.querySelector(`#presetBar [data-preset="${id}"]`));
    fillOf(id).forEach((c, i) => {
      const style = lane(TIERS_KEYS[i]).querySelector('.lane-title').style;
      const ink = style.color;
      const bg = style.background;
      const r = wcag(rgbToHex(ink), rgbToHex(bg));
      if (r < worst) worst = r;
      if (r < 4.5) bad(`预设 ${id} 第 ${i + 1} 档 ${bg} 上的字只有 ${r.toFixed(2)}:1（要 ≥ 4.5）`);
    });
  });
  if (worst >= 4.5) ok(`三套预设共 15 个色号，最差对比度 ${worst.toFixed(2)}:1，全部达到 AA`);

  console.log('');
  if (pageErrors.length) bad('期间页面又报错了：' + pageErrors.join(' / '));
  if (fail) { console.log(`✗ ${fail} 项失败\n`); process.exit(1); }
  console.log('✓ 全部通过\n');
})();
