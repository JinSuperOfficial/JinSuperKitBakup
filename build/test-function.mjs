/* 811/function.html（Plot 图像计算器）回归测试
   主题 / GeoGebra 语法 / 公式计算器 / 工具栏 / 表格区 / 对象模型 / 几何构造 逐项断言。
   跑：node build/test-function.mjs   （挂在 部署.cmd check 的快速自检里） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const FILE = fileURLToPath(new URL('../jinsuper.rth1.xyz/811/function.html', import.meta.url));
const html = readFileSync(FILE, 'utf8');

const errors = [];
/* ctx 桩：除了顶住所有调用，还把「画了什么」记进 win.__ops —— 导出选项就靠它断言。
   __id 给每个 ctx 编号，用来验证导出后 ctx 换回了原来那个。 */
function makeCtx(win){
  const grad = { addColorStop(){} };
  const rec = (name) => () => { if (win && win.__ops) win.__ops.push(name); };
  const t = {
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    createPattern: () => ({}),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: rec('putImageData'), measureText: () => ({ width: 10 }),
    fillRect: rec('fillRect'), stroke: rec('stroke'), fill: rec('fill'),
    fillText: rec('fillText'), setLineDash: rec('setLineDash'), arc: rec('arc'),
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
  };
  if (win){ win.__ctxSeq = (win.__ctxSeq || 0) + 1; t.__id = win.__ctxSeq; }
  return new Proxy(t, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/811/function.html',
  beforeParse(win){
    win.__ops = [];
    win.__ctxSeq = 0;
    win.matchMedia = (q) => ({ matches:false, media:q, onchange:null, addEventListener(){},
      removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent: () => false });
    win.HTMLCanvasElement.prototype.getContext = () => makeCtx(win);
    /* 图片导出要用到的三件套：jsdom 原生要么没实现要么会往 stderr 刷提示，这里替掉 */
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    win.HTMLCanvasElement.prototype.toBlob = function(cb, mime, q){
      win.__lastToBlob = { mime, quality: q };
      cb(new win.Blob(['x'], { type: win.__forceMime || mime || 'image/png' }));
    };
    win.URL.createObjectURL = () => 'blob:fake';
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function(){ win.__lastDownload = this.download; };
    win.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
    win.Element.prototype.setPointerCapture = () => {};
    win.Element.prototype.releasePointerCapture = () => {};
    win.Element.prototype.getBoundingClientRect = () =>
      ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0 });
    win.addEventListener('error', e => errors.push('window.error: ' + (e.message || e.error)));
    const ce = win.console.error;
    win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); ce.apply(win.console, a); };
  },
});
const win = dom.window, doc = win.document, ev = (c) => win.eval(c);

const fails = [];
const check = (n, f) => { try { f(); console.log('  ok   ' + n); }
  catch (e){ fails.push(n + ' → ' + e.message); console.log('  FAIL ' + n + ' → ' + e.message); } };

console.log('\n[A] 加载与改名');
check('页面脚本没报错', () => assert.equal(errors.length, 0, errors.join(' | ')));
check('标题 / h1 都叫 Plot 图像计算器', () => {
  assert.match(doc.title, /Plot 图像计算器/);
  assert.equal(doc.querySelector('h1').textContent.trim(), 'Plot 图像计算器');
});
check('html 默认 data-theme=swiss-light', () => {
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'swiss-light');
});
check('三套主题的令牌块都在 <style> 里', () => {
  const css = doc.querySelector('style').textContent;
  for (const t of ['swiss-light','swiss-dark','swiss-green']) assert.ok(css.includes('data-theme="' + t + '"'), t);
  for (const v of ['--paper','--accent-rgb','--plot-bg-1','--plot-grid-1','--plot-tick']) assert.ok(css.includes(v), v);
  assert.ok(!/--line:var\(--line\)/.test(css), '不能有自引用令牌');
});
check('CSS 里没有旧主题的橙色残留', () => {
  const css = doc.querySelector('style').textContent;
  assert.ok(!/215,\s*119,\s*87/.test(css), '旧强调色 rgba 还在');
  assert.ok(!/#D97757/i.test(css), '旧橙色还在');
});

console.log('\n[B] 主题切换');
check('默认亮色 + 曲线配色是克莱因蓝', () => {
  assert.equal(ev('currentTheme()'), 'swiss-light');
  assert.equal(ev('PALETTE[0]'), '#002FA7');
  assert.equal(ev('state.funcs[0].color'), '#002FA7');
});
check('切暗色：令牌/曲线色/画笔色一起换', () => {
  ev('setTheme("swiss-dark", true)');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'swiss-dark');
  assert.equal(ev('currentTheme()'), 'swiss-dark');
  assert.equal(ev('PALETTE[0]'), '#F97316');
  assert.equal(ev('state.funcs[0].color'), '#F97316', '已有曲线要跟着换');
  assert.ok(ev('PALETTE').includes(ev('pen.color')), '画笔色要落在当前主题的配色里');
  assert.ok(ev('PALETTE').includes(ev('state.pointTable.color')), '点色要落在当前主题的配色里');
  assert.equal(win.localStorage.getItem('plot-theme'), 'swiss-dark');
});
check('切绿色', () => {
  ev('setTheme("swiss-green", true)');
  assert.equal(ev('PALETTE[0]'), '#2D6A4F');
  assert.equal(ev('state.funcs[0].color'), '#2D6A4F');
});
check('分段控件状态同步', () => {
  const on = [...doc.querySelectorAll('#themeSeg .seg-btn')].filter(b => b.getAttribute('aria-checked') === 'true');
  assert.equal(on.length, 1);
  assert.equal(on[0].dataset.theme, 'swiss-green');
});
check('点按钮也能切（并写 localStorage）', () => {
  doc.querySelector('#themeSeg .seg-btn[data-theme="swiss-light"]').dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('currentTheme()'), 'swiss-light');
  assert.equal(win.localStorage.getItem('plot-theme'), 'swiss-light');
});
check('未知主题名回落到亮色', () => {
  ev('setTheme("什么鬼", true)');
  assert.equal(ev('currentTheme()'), 'swiss-light');
});
check('画布主题读得到值（jsdom 用兜底）', () => {
  const cv = ev('CV');
  for (const k of ['bg1','bg2','bg3','grid1','grid2','axis','cross','tick','ink','chip'])
    assert.ok(cv[k] && String(cv[k]).length > 2, k + ' = ' + cv[k]);
});
check('切主题后 draw() 不炸', () => { ev('draw()'); ev('setTheme("swiss-dark", true)'); ev('draw()'); });

console.log('\n[C] 原有功能没退化');
check('一支空表达式 + 空点表格', () => {
  assert.equal(ev('state.funcs.length'), 1);
  assert.equal(ev('state.pointTable.points.length'), 0);
});
check('单字母自变量仍好用', () => {
  const f = ev('(function(){ const i=document.querySelector(".fn-input"); i.value="a=54b+cos(b)"; i.dispatchEvent(new Event("input",{bubbles:true})); return state.funcs[0]; })()');
  assert.equal(f.error, null, String(f.error));
  assert.equal(f.vars.join(','), 'b');
});
check('坐标轴标签仍是字符串可改', () => {
  ev('state.settings.axisX = "时间 t"');
  ev('draw()');
  assert.equal(ev('state.settings.axisX'), '时间 t');
});

console.log('\n[D] 新外壳：顶栏 / 工具栏 / 表格区');
const canvas = doc.getElementById('cv');
function press(id, x, y){
  const e = new win.Event('pointerdown', { bubbles: true, cancelable: true });
  e.pointerId = id; e.pointerType = 'mouse'; e.clientX = x; e.clientY = y;
  canvas.dispatchEvent(e);
  const u = new win.Event('pointerup', { bubbles: true, cancelable: true });
  u.pointerId = id; u.pointerType = 'mouse'; u.clientX = x; u.clientY = y;
  canvas.dispatchEvent(u);
}
check('顶栏按钮齐了', () => {
  for (const id of ['menuBtn','undoBtn','redoBtn','more811Btn','themeBtn','settingsBtn'])
    assert.ok(doc.getElementById(id), id);
});
check('工具栏三组工具 + 缩放 + 网格/坐标轴', () => {
  assert.equal(doc.querySelectorAll('.tool[data-tool]').length, 4);
  assert.ok(doc.querySelector('.tool[data-tool="text"]'), '要有注释工具');
  assert.equal(doc.querySelectorAll('.tool[data-zoom]').length, 3);
  assert.ok(doc.getElementById('toolGrid') && doc.getElementById('toolTicks'));
});
check('工作区把代数区和绘图区并排', () => {
  assert.ok(doc.querySelector('.workspace .panel'));
  assert.ok(doc.querySelector('.workspace .stage'));
});
check('表格区两个页签都在', () => {
  assert.equal(doc.querySelectorAll('.tv-tab').length, 2);
  assert.ok(doc.getElementById('ptBody'));
  assert.ok(doc.getElementById('vtBody'));
});
check('切工具：点', () => {
  doc.querySelector('.tool[data-tool="point"]').dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('tool'), 'point');
  assert.equal(ev('pen.active'), false);
  assert.equal(ev('state.settings.snap'), true, '点工具自动开吸附');
});
check('点工具：画布上单击落一个点对象', () => {
  const n0 = ev('state.funcs.length');
  press(21, 300, 300);
  assert.equal(ev('state.funcs.length'), n0 + 1);
  const last = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(last.type, 'point');
  assert.equal(last.error, null, String(last.error));
  assert.equal(last.source, 'manual');
});
check('切工具：线段（就是画笔）', () => {
  doc.querySelector('.tool[data-tool="segment"]').dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('tool'), 'segment');
  assert.equal(ev('pen.active'), true);
});
check('切回移动', () => {
  doc.querySelector('.tool[data-tool="move"]').dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('tool'), 'move');
  assert.equal(ev('pen.active'), false);
  assert.equal(doc.querySelectorAll('.tool.on[data-tool]').length, 1);
});
check('网格/坐标轴按钮管着设置', () => {
  const g = doc.getElementById('toolGrid');
  const before = ev('state.settings.showGrid');
  g.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('state.settings.showGrid'), !before);
  assert.equal(g.getAttribute('aria-pressed'), String(!before));
  g.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('state.settings.showGrid'), before);
});
check('数值表：9 行 + 每个可见函数一列', () => {
  ev('setTool("move", true)');
  ev('state.funcs = []; addFunc("y", "x^2", "manual")');
  ev('renderList()');
  ev('setTvTab("values")');
  const rows = doc.querySelectorAll('#vtBody tr');
  assert.equal(rows.length, 9);
  assert.equal(doc.querySelectorAll('#vtHead th').length, 3, '序号 + x + 一列函数');
  const th = doc.querySelector('#vtHead th:nth-child(3)');
  assert.match(th.textContent, /^[a-z]$/, '表头用对象名：' + th.textContent);
  assert.match(th.getAttribute('title'), /x\^2/, '表达式进 title');
});
check('数值表点一行 → 图上标记 + 高亮', () => {
  const tr = doc.querySelectorAll('#vtBody tr')[2];
  tr.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.ok(ev('vtHighlight') && isFinite(ev('vtHighlight.x')));
  assert.ok(tr.classList.contains('on'));
  ev('draw()');
  tr.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('vtHighlight'), null, '再点一下取消');
});
check('适应视图把曲线框进来', () => {
  ev('state.funcs = []; addFunc("y", "x^2", "manual")');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  ev('fitView()');
  assert.ok(ev('state.view.scale') < 20, 'scale = ' + ev('state.view.scale'));
  assert.ok(Math.abs(ev('state.view.cx')) < 2, 'cx = ' + ev('state.view.cx'));
  assert.ok(ev('state.view.cy') > 5, 'cy = ' + ev('state.view.cy'));
  ev('draw()');
});
check('表格区能收起 / 展开', () => {
  const tv = doc.getElementById('tableView'), tg = doc.getElementById('tvToggle');
  tg.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.ok(tv.classList.contains('collapsed'));
  assert.equal(tg.getAttribute('aria-expanded'), 'false');
  tg.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.ok(!tv.classList.contains('collapsed'));
});
check('顶栏主题按钮循环三套主题', () => {
  ev('setTheme("swiss-light", true)');
  const btn = doc.getElementById('themeBtn');
  btn.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('currentTheme()'), 'swiss-dark');
  btn.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('currentTheme()'), 'swiss-green');
  btn.dispatchEvent(new win.Event('click', { bubbles:true }));
  assert.equal(ev('currentTheme()'), 'swiss-light');
});
check('切回点列表页签不炸', () => { ev('setTvTab("points")'); assert.equal(ev('tvTab'), 'points'); });

console.log('\n[E] ☰ 菜单 / 导出 / 更多811工具');
check('菜单能开能关', () => {
  const mb = doc.getElementById('menuBtn'), mp = doc.getElementById('menuPop');
  mb.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(mp.classList.contains('show'));
  assert.equal(mb.getAttribute('aria-expanded'), 'true');
  mb.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(!mp.classList.contains('show'));
});
check('菜单：新建清空一切', () => {
  ev('state.funcs = []; addFunc("y","x","manual"); state.pointTable.points=[{x:1,y:2}]; state.view.cx=42');
  ev('renderList(); renderPointTable()');
  doc.querySelector('.menu-item[data-act="new"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.funcs.length'), 1);
  assert.equal(ev('state.funcs[0].expr'), '');
  assert.equal(ev('state.pointTable.points.length'), 0);
  assert.equal(ev('state.view.cx'), 0);
});
check('导出对象清单：函数 + 点', () => {
  ev('state.funcs = []; addFunc("y","x^2","manual")');
  ev('state.pointTable.points = [{x:1,y:2}]');
  const rows = ev('objectsForExport()');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'y');
  assert.equal(rows[1].kind, 'point');
});
check('LaTeX 转写', () => {
  const t = ev('texify("sin(x)*2 + x^2")');
  assert.match(t, /\\sin/);
  assert.match(t, /\\cdot/);
  assert.match(t, /x\^\{2\}/);
  assert.match(ev('texify("sqrt(x)+pi")'), /\\sqrt\{|\\pi/);
});
check('更多811工具面板能打开（没 manifest 时给兜底文案）', () => {
  doc.getElementById('more811Btn').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(doc.getElementById('toolsModal').classList.contains('show'));
  assert.ok(!doc.getElementById('toolsEmpty').classList.contains('hidden'));
  doc.getElementById('toolsClose').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(!doc.getElementById('toolsModal').classList.contains('show'));
});
check('导入按钮指向文件选择框', () => {
  assert.ok(doc.getElementById('fileInput'));
  assert.ok(doc.getElementById('impBtn'));
});
check('复制链接不会抛错', () => { ev('copyShareLink()'); ev('showHelp()'); });

console.log('\n[F] 输入栏 / f(x)= / If() / Curve() / 对象名');
check('输入栏在代数区里', () => {
  assert.ok(doc.getElementById('inputBar'));
  assert.ok(doc.getElementById('ibInput'));
  assert.ok(doc.querySelector('.panel #inputBar'), '要在代数区内');
});
check('输入 sin(x) → y 型，行首显示对象名 f', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "sin(x)"; submitInput()');
  assert.equal(ev('state.funcs.length'), 1);
  assert.equal(ev('state.funcs[0].type'), 'y');
  assert.equal(ev('state.funcs[0].expr'), 'sin(x)');
  assert.equal(doc.querySelector('.fn-input').value, 'sin(x)');
  assert.match(doc.querySelector('.fn-label').textContent, /^[a-z]\(x\) =/);
});
check('f(x)=x^2 用指定的名字 f', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "f(x)=x^2"; submitInput()');
  const f = ev('state.funcs[0]');
  assert.equal(f.label, 'f');
  assert.equal(f.expr, 'x^2', '左边要被摘掉');
  assert.equal(f.error, null, String(f.error));
  assert.ok(Math.abs(f.fn(3) - 9) < 1e-12);
  assert.equal(doc.querySelector('.fn-label').textContent.trim(), 'f(x) =', '行首是 f(x) =');
});
check('A=(1,2) 建一个点名 A', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "A=(3,4)"; submitInput()');
  const f = ev('state.funcs[0]');
  assert.equal(f.type, 'point');
  assert.equal(f.label, 'A');
  assert.equal(f.expr, '3,4');
});
check('If(x<0,-x,x) 是分段函数', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "If(x<0,-x,x)"; submitInput()');
  const f = ev('state.funcs[0]');
  assert.equal(f.error, null, String(f.error));
  assert.equal(f.fn(-3), 3);
  assert.equal(f.fn(3), 3);
});
check('If 参数个数写错会报错', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "If(x<0)"; submitInput()');
  assert.match(String(ev('state.funcs[0].error')), /If 要写成/);
});
check('Curve(...) 带范围', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "Curve(cos(t),sin(t),t,0,pi)"; submitInput()');
  const f = ev('state.funcs[0]');
  assert.equal(f.type, 'parametric');
  assert.equal(f.error, null, String(f.error));
  assert.equal(f.vars.join(','), 't');
  assert.ok(Math.abs(f.t0 - 0) < 1e-9 && Math.abs(f.t1 - Math.PI) < 1e-9, 't0/t1 = ' + f.t0 + '/' + f.t1);
  ev('draw()');
});
check('Curve 不带范围 → 默认 0…2π', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "Curve(cos(t),sin(t),t)"; submitInput()');
  const f = ev('state.funcs[0]');
  assert.equal(f.error, null, String(f.error));
  assert.ok(Math.abs(f.t1 - Math.PI * 2) < 1e-9);
});
check('自动判类型：x^2+y^2-4 → 隐式', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "x^2+y^2-4"; submitInput()');
  assert.equal(ev('state.funcs[0].type'), 'implicit');
});
check('自动判类型：x=2 还是竖直线', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "x=2"; submitInput()');
  assert.equal(ev('state.funcs[0].vertical'), true);
});
check('输入会占掉那行空表达式，不会多出一行', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('ibInput.value = "e^(-x^2)"; submitInput()');
  ev('ibInput.value = "x^3"; submitInput()');
  assert.equal(ev('state.funcs.length'), 2, '第二句才新开一行');
});
check('导出的 JSON 带上对象名', () => {
  const src = win.exportJSON.toString();
  assert.match(src, /label: f\.label/);
});

console.log('\n[G] 公式计算器：取点 / 标线段 / 点一下认对象');
const cell = (wx, wy) => [wx * ev('state.view.scale') + 400, 300 - wy * ev('state.view.scale')];
check('现成的点：点对象 + 点表格都能选', () => {
  ev('state.funcs = []; addFunc("point","2,3","manual"); addFunc("y","x^2","manual")');
  ev('state.pointTable.points = [{x:-1,y:5}]');
  const html = ev('pointChoices()');
  assert.match(html, /2,3/, '点对象进列表');
  assert.match(html, /-1,5/, '点表格进列表');
});
check('displayExpr 写法', () => {
  assert.match(ev('displayExpr(state.funcs[0])'), /^A = \(2,3\)$/);
  assert.match(ev('displayExpr(state.funcs[1])'), /\(x\) = x\^2/);
});
check('公式面板出现取点区 + 三个标出按钮', () => {
  ev('activeFormula = "distance"');
  ev('openFormula()');
  assert.ok(doc.querySelector('.pick-box'));
  assert.equal(doc.querySelectorAll('.pp-sel[data-pair]').length, 2, 'A/B 两组');
  assert.equal(doc.querySelectorAll('.mark-btn[data-mark]').length, 3, '点 / 线段 / 直线');
  assert.ok(doc.getElementById('curvePick'), '能从曲线上取两点');
});
check('下拉选现成的点 → 填进 x1/y1', () => {
  const sel = doc.querySelector('.pp-sel[data-pair="0"]');
  sel.value = '2,3';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  const v = ev('getVals(FORMULAS.find(f => f.id === "distance"))');
  assert.equal(v.x1, '2');
  assert.equal(v.y1, '3');
});
check('从曲线取两点（选中的表达式）', () => {
  const cp = doc.getElementById('curvePick');
  cp.value = String(ev('state.funcs[1].id'));
  cp.dispatchEvent(new win.Event('change', { bubbles: true }));
  const v = ev('getVals(FORMULAS.find(f => f.id === "distance"))');
  assert.ok(isFinite(parseFloat(v.x1)) && isFinite(parseFloat(v.y1)), 'x1/y1 = ' + v.x1 + '/' + v.y1);
  assert.ok(isFinite(parseFloat(v.x2)) && isFinite(parseFloat(v.y2)));
  assert.ok(Math.abs(parseFloat(v.y1) - Math.pow(parseFloat(v.x1), 2)) < 1e-3, '取的点在 y=x^2 上');
});
check('图上点一下取点（自动开回公式面板）', () => {
  ev('activeFormula = "distance"; openFormula()');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  doc.querySelector('.pp-btn[data-pick="0"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(ev('pickState'), '进入取点状态');
  assert.ok(!doc.getElementById('formulaModal').classList.contains('show'), '取点时先让开');
  assert.ok(doc.getElementById('pickBadge').classList.contains('show'));
  ev(`(() => { const c = document.getElementById('cv'); const e = new Event('pointerdown', { bubbles:true, cancelable:true }); e.pointerId = 31; e.pointerType = 'mouse'; e.clientX = ${cell(1, 1)[0]}; e.clientY = ${cell(1, 1)[1]}; c.dispatchEvent(e); })()`);
  assert.equal(ev('pickState'), null, '取完就退出');
  const v = ev('getVals(FORMULAS.find(f => f.id === "distance"))');
  assert.equal(v.x1, '1');
  assert.equal(v.y1, '1');
  assert.ok(doc.getElementById('formulaModal').classList.contains('show'), '取完弹回来');
  ev('closeFormula()');
});
check('Esc 取消取点', () => {
  ev('startPick("A 点", () => {})');
  assert.ok(ev('pickState'));
  doc.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  assert.equal(ev('pickState'), null);
  assert.ok(!doc.getElementById('pickBadge').classList.contains('show'));
});
check('标出线段 → 两点 + 一条带范围的线', () => {
  ev('state.funcs = []; addFunc("y","","manual",0)');
  ev('activeFormula = "distance"; openFormula()');
  doc.querySelector('.mark-btn[data-mark="1"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const n = ev('state.funcs.length');
  assert.equal(n, 4, '原空行 + 两个点 + 一条线段，实际 ' + n);
  const line = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(line.type, 'y');
  assert.match(line.expr, /\{/, '线段要带范围：' + line.expr);
  assert.equal(line.error, null, String(line.error));
});
check('标出直线 → 不带范围的无限直线', () => {
  ev('state.funcs = []; addFunc("y","","manual",0)');
  ev('activeFormula = "distance"; openFormula()');
  doc.querySelector('.mark-btn[data-mark="2"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const line = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(line.type, 'y');
  assert.ok(!/\{/.test(line.expr), '直线不该带范围：' + line.expr);
  assert.equal(line.error, null, String(line.error));
});
check('标出两点的颜色来自当前主题调色板', () => {
  ev('state.funcs = []; addFunc("y","","manual",0)');
  ev('activeFormula = "distance"; openFormula()');
  doc.querySelector('.mark-btn[data-mark="0"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  const pts = ev('state.funcs.filter(f => f.type === "point").map(f => f.color)');
  const pal = ev('PALETTE');
  points: for (const c of pts) assert.ok(pal.includes(c), c + ' 不在 PALETTE 里');
});
check('点一下图上的曲线 → 高亮代数区那一行', () => {
  ev('state.funcs = []; addFunc("y","x^2","manual")');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56; renderList()');
  const [sx, sy] = cell(2, 4);
  ev(`identifyAt(${sx}, ${sy})`);
  const row = doc.querySelector('.fn-row.flash');
  assert.ok(row, '应该有一行在闪');
  assert.equal(row.dataset.id, String(ev('state.funcs[0].id')));
});
check('点一下点对象 → 报坐标', () => {
  ev('state.funcs = []; addFunc("point","1,1","manual")');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56; renderList()');
  const [sx, sy] = cell(1, 1);
  const before = doc.getElementById('toast').textContent;
  ev(`identifyAt(${sx}, ${sy})`);
  assert.match(doc.getElementById('toast').textContent, /A = \(1,1\)/);
  assert.notEqual(doc.getElementById('toast').textContent, before);
});
check('空白处点一下不炸', () => { ev('identifyAt(5, 595)'); ev('draw()'); });

console.log('\n[H] 绘图区右键菜单');
check('右键弹出菜单，勾选状态跟着设置走', () => {
  const m = doc.getElementById('ctxMenu');
  const e = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  e.clientX = 500; e.clientY = 300;
  canvas.dispatchEvent(e);
  assert.ok(m.classList.contains('show'));
  const g = m.querySelector('[data-act="grid"]');
  assert.equal(g.getAttribute('aria-checked'), String(!!ev('state.settings.showGrid')));
});
check('点「显示网格」切换设置并保持菜单开着', () => {
  const m = doc.getElementById('ctxMenu');
  const before = ev('state.settings.showGrid');
  m.querySelector('[data-act="grid"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.settings.showGrid'), !before);
  assert.equal(ev('document.getElementById("toolGrid").getAttribute("aria-pressed")'), String(!before), '工具栏同步');
  assert.ok(m.classList.contains('show'), '菜单留着继续点');
  m.querySelector('[data-act="grid"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.settings.showGrid'), before);
});
check('适应视图 / 回到原点 / 坐标轴标签…', () => {
  const m = doc.getElementById('ctxMenu');
  ev('state.funcs = []; addFunc("y","x^2","manual")');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  m.querySelector('[data-act="fit"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(ev('state.view.scale') < 20, 'fit 生效');
  assert.ok(!m.classList.contains('show'));
  const e = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  e.clientX = 400; e.clientY = 300;
  canvas.dispatchEvent(e);
  m.querySelector('[data-act="reset"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.view.scale'), 56);
  const e2 = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  e2.clientX = 400; e2.clientY = 300;
  canvas.dispatchEvent(e2);
  m.querySelector('[data-act="axes"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(doc.getElementById('settingsModal').classList.contains('show'), '打开设置看轴标签');
  ev('closeSettings()');
});
check('右键菜单不会弹出浏览器默认菜单', () => {
  const e = new win.Event('contextmenu', { bubbles: true, cancelable: true });
  e.clientX = 400; e.clientY = 300;
  canvas.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
});

console.log('\n[I] 对象：选中 / 属性 / 拖点 / 撤销重做');
check('点代数区一行 → 选中 + 浮出属性面板', () => {
  ev('state.funcs = []; addFunc("y","x^2","manual"); renderList()');
  const row = doc.querySelector('.fn-row');
  row.dispatchEvent(Object.assign(new win.Event('click', { bubbles: true }), {}));
  assert.equal(ev('selectedId'), ev('state.funcs[0].id'));
  assert.ok(row.classList.contains('sel'));
  const panel = doc.getElementById('propsPanel');
  assert.ok(!panel.classList.contains('hidden'), '属性面板要出来');
  assert.match(doc.getElementById('propsName').textContent, /x\^2/);
  assert.equal(doc.querySelectorAll('#propsColors button').length, 6);
});
check('点行里的输入框不会误触发选中', () => {
  ev('selectObject(null)');
  const inp = doc.querySelector('.fn-input');
  inp.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('selectedId'), null);
});
check('属性面板：换色 / 粗细 / 隐藏 / 删掉', () => {
  ev('selectObject(state.funcs[0].id)');
  const c = doc.querySelectorAll('#propsColors button')[2];
  c.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.funcs[0].color'), c.dataset.color);
  const w = doc.getElementById('propsWidth');
  w.value = '4';
  w.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(ev('state.funcs[0].width'), 4);
  doc.getElementById('propsVis').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.funcs[0].visible'), false);
  assert.doesNotThrow(() => ev('draw()'));
  doc.getElementById('propsDel').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.funcs.length'), 1, '删掉后补一行空的');
  assert.equal(ev('state.funcs[0].expr'), '');
  assert.equal(ev('selectedId'), null);
});
/* 点住点对象拖着走 */
function mouse(type, id, x, y){
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  e.pointerId = id; e.pointerType = 'mouse'; e.clientX = x; e.clientY = y;
  canvas.dispatchEvent(e);
}
check('图上拖点：坐标实时变，输入框跟着变', () => {
  ev('state.funcs = []; addFunc("point","0,0","manual"); renderList()');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56; state.settings.snap=false');
  const [sx, sy] = [400, 300];
  mouse('pointerdown', 41, sx, sy);
  assert.ok(ev('dragPoint'), '按住点开始拖');
  mouse('pointermove', 41, sx + 56, sy);          // 往右一格 → (1, 0)
  mouse('pointerup', 41, sx + 56, sy);
  assert.equal(ev('dragPoint'), null);
  assert.equal(ev('state.funcs[0].expr'), '1, 0');
  assert.equal(doc.querySelector('.fn-input').value, '1, 0', '代数区行跟着变');
  assert.equal(ev('selectedId'), ev('state.funcs[0].id'), '拖点顺手选中');
});
check('线段记住端点：拖点后线段跟着变', () => {
  ev('state.funcs = []; var A = addFunc("point","0,0","manual"); var B = addFunc("point","2,2","manual");' +
     ' var L = addFunc("y", lineFromPoints({x:0,y:0},{x:2,y:2}, false), "manual");' +
     ' L.obj = {kind:"segment", a:A.id, b:B.id}; renderList();');
  const before = ev('state.funcs[2].expr');
  assert.match(before, /\{/, '先是带范围的线段：' + before);
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  mouse('pointerdown', 51, 400, 300);             // 抓住 A=(0,0)
  mouse('pointermove', 51, 512, 300);             // 拖到 (2,0)
  mouse('pointerup', 51, 512, 300);
  const after = ev('state.funcs[2].expr');
  assert.notEqual(after, before, '线段表达式要跟着端点重算');
  assert.equal(ev('state.funcs[0].expr'), '2, 0');
  assert.equal(ev('state.funcs[2].error'), null, String(ev('state.funcs[2].error')));
});
check('撤销 / 重做：按钮状态 + 内容回滚', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('hist.past = []; hist.future = []; hist.last = serializeObjects(); updateHistoryUI()');
  assert.equal(doc.getElementById('undoBtn').disabled, true, '一开始没得撤');
  ev('ibInput.value = "x^3"; submitInput()');
  assert.equal(doc.getElementById('undoBtn').disabled, false, '改完能撤了');
  assert.match(ev('state.funcs[0].expr'), /x\^3/);
  ev('undo()');
  assert.equal(ev('state.funcs[0].expr'), '', '撤销回空行');
  assert.equal(doc.getElementById('redoBtn').disabled, false, '能重做');
  ev('redo()');
  assert.match(ev('state.funcs[0].expr'), /x\^3/, '重做回来');
});
check('撤销会保留对象 id（线段引用不能断）', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('hist.past = []; hist.future = []; hist.last = serializeObjects(); updateHistoryUI()');
  ev('addFunc("point","1,1","manual"); renderList(); historyTick()');
  const id = ev('state.funcs[1].id');
  ev('selectObject(state.funcs[1].id)');
  ev('hist.last = serializeObjects()');
  ev('addFunc("point","2,2","manual"); renderList()');
  ev('undo()');
  assert.ok(ev(`state.funcs.some(f => f.id === ${id})`), '撤销后那个点还在');
  assert.equal(ev('selectedId'), null);
});
check('键盘 Ctrl+Z / Ctrl+Y', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
  ev('hist.past = []; hist.future = []; hist.last = serializeObjects(); updateHistoryUI()');
  ev('ibInput.value = "sin(x)"; submitInput()');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'z', ctrlKey: true }));
  assert.equal(ev('state.funcs[0].expr'), '');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'y', ctrlKey: true }));
  assert.match(ev('state.funcs[0].expr'), /sin\(x\)/);
});
check('拖点时先不记历史，松手才记', () => {
  ev('state.funcs = []; addFunc("point","0,0","manual"); renderList()');
  ev('hist.past = []; hist.future = []; hist.last = serializeObjects(); updateHistoryUI()');
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  mouse('pointerdown', 61, 400, 300);
  mouse('pointermove', 61, 456, 300);
  mouse('pointermove', 61, 512, 300);
  assert.equal(ev('hist.past.length'), 0, '拖着的时候不记');
  mouse('pointerup', 61, 512, 300);
  assert.equal(ev('hist.past.length'), 1, '松手记一笔');
});

console.log('\n[J] 几何构造：中点 / 交点 / 垂线 / 平行线 / 多边形 / 距离 / 角度');
function twoPoints(){
  ev('state.funcs = []; var P1 = addFunc("point","0,0","manual"); var P2 = addFunc("point","4,0","manual");' +
     ' state.view.cx=0; state.view.cy=0; state.view.scale=56; renderList();');
  return [ev('state.funcs[0].id'), ev('state.funcs[1].id')];
}
check('工具栏有 7 个构造按钮', () => {
  assert.equal(doc.querySelectorAll('.tool[data-construct]').length, 7);
});
check('中点：选两个点 → 建出中点，拖端点跟着走', () => {
  const [a, b] = twoPoints();
  doc.querySelector('.tool[data-construct="mid"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(ev('construct'), '工具进入构造态');
  assert.ok(doc.getElementById('pickBadge').classList.contains('show'));
  assert.match(doc.getElementById('pickBadgeText').textContent, /1|2/);
  ev(`constructPick({ id: ${a} })`);
  assert.equal(ev('construct.picks.length'), 1);
  ev(`constructPick({ id: ${b} })`);
  assert.equal(ev('construct'), null, '够了就自动构造');
  const mid = ev('state.funcs[2]');
  assert.equal(mid.type, 'point');
  assert.equal(mid.expr, '2, 0');
  assert.equal(mid.obj.kind, 'mid');
  /* 拖 A 到 (0,4) → 中点变成 (2,2) */
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  mouse('pointerdown', 71, 400, 300);
  mouse('pointermove', 71, 400, 76);
  mouse('pointerup', 71, 400, 76);
  assert.equal(ev('state.funcs[0].expr'), '0, 4', 'A 拖上去了');
  assert.equal(ev('state.funcs[2].expr'), '2, 2', '中点跟着走');
});
check('中点工具只收点，选曲线会被拦', () => {
  ev('state.funcs = []; addFunc("point","0,0","manual"); addFunc("y","x","manual"); renderList()');
  ev('startConstruct("mid")');
  const toast = doc.getElementById('toast');
  ev('constructPick({ id: state.funcs[1].id })');
  assert.equal(ev('construct.picks.length'), 0);
  assert.match(toast.textContent, /要选点/);
  ev('cancelConstruct()');
});
check('交点：y=x 与 y=x^2 → (0,0) 和 (1,1)', () => {
  ev('state.funcs = []; addFunc("y","x","manual"); addFunc("y","x^2","manual");' +
     ' state.view.cx=0; state.view.cy=0; state.view.scale=56; renderList()');
  ev('startConstruct("inter")');
  ev('constructPick({ id: state.funcs[0].id })');
  ev('constructPick({ id: state.funcs[1].id })');
  const pts = ev('state.funcs.filter(f => f.type === "point").map(f => f.expr)');
  assert.equal(pts.length, 2, '两个交点，实际：' + JSON.stringify(pts));
  const norm = pts.map(s => s.replace(/\s/g, '')).sort().join(' | ');
  assert.equal(norm, '0,0 | 1,1');
});
check('交点：取不到就报错不建东西', () => {
  ev('state.funcs = []; addFunc("y","x","manual"); addFunc("y","x+1","manual"); renderList()');
  ev('startConstruct("inter")');
  ev('constructPick({ id: state.funcs[0].id })');
  ev('constructPick({ id: state.funcs[1].id })');
  assert.equal(ev('state.funcs.filter(f => f.type === "point").length'), 0);
  assert.match(doc.getElementById('toast').textContent, /没有交点/);
});
check('垂线 / 平行线：过点对 y=2x 作线', () => {
  ev('state.funcs = []; addFunc("y","2x","manual"); addFunc("point","0,3","manual"); renderList()');
  const lineId = ev('state.funcs[0].id'), ptId = ev('state.funcs[1].id');
  ev('startConstruct("perp")');
  ev(`constructPick({ id: ${ptId} })`);
  ev(`constructPick({ id: ${lineId} })`);
  const perp = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(perp.obj.kind, 'perp');
  assert.ok(Math.abs(perp.fn(1) - (3 - 0.5)) < 1e-6, '过 (0,3) 斜率 -0.5：' + perp.fn(1));
  ev('startConstruct("para")');
  ev(`constructPick({ id: ${ptId} })`);
  ev(`constructPick({ id: ${lineId} })`);
  const para = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(para.obj.kind, 'para');
  assert.ok(Math.abs(para.fn(1) - (3 + 2)) < 1e-6, '过 (0,3) 斜率 2：' + para.fn(1));
});
check('垂线工具的顺序要求：先点再曲线', () => {
  ev('startConstruct("perp")');
  const toast = doc.getElementById('toast');
  ev('constructPick({ id: state.funcs[0].id })');   // 先给曲线
  assert.match(toast.textContent, /先点一个点/);
  assert.equal(ev('construct.picks.length'), 0);
  ev('cancelConstruct()');
});
check('多边形：三点成面，顶点串可读，能画', () => {
  ev('state.funcs = [];');
  ev('var A1 = addFunc("point","0,0","manual"); var B1 = addFunc("point","4,0","manual");' +
     ' var C1 = addFunc("point","4,3","manual"); renderList();');
  const ids = ev('state.funcs.map(f => f.id)');
  ev('startConstruct("poly")');
  ids.forEach(id => ev(`constructPick({ id: ${id} })`));
  assert.equal(ev('construct.picks.length'), 3, '开放式构造不会自动收尾');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Enter' }));
  assert.equal(ev('construct'), null);
  const poly = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(poly.type, 'poly');
  assert.equal(poly.pts.length, 3);
  assert.equal(poly.error, null, String(poly.error));
  assert.match(ev(`polyVerticesText(state.funcs.find(f => f.type === "poly"))`), /→/);
  assert.equal(ev('vertexPoints(state.funcs.find(f => f.type === "poly")).length'), 3);
  assert.doesNotThrow(() => ev('draw()'));
  /* 代数区那一行不该有输入框，而是顶点串 */
  const polyRow = doc.querySelector('.fn-row[data-id="' + poly.id + '"]');
  assert.ok(polyRow, '多边形要有自己那一行');
  assert.equal(polyRow.querySelector('.fn-input'), null);
  assert.match(polyRow.querySelector('.fn-static').textContent, /→/);
});
check('多边形顶点拖动后跟着变形', () => {
  ev('state.view.cx=0; state.view.cy=0; state.view.scale=56');
  const before = ev('vertexPoints(state.funcs.find(f => f.type === "poly")).map(p => p.x + "," + p.y).join("|")');
  mouse('pointerdown', 81, 400, 300);              // 抓 A=(0,0)
  mouse('pointermove', 81, 344, 300);              // 拖到 (-1,0)
  mouse('pointerup', 81, 344, 300);
  const after = ev('vertexPoints(state.funcs.find(f => f.type === "poly")).map(p => p.x + "," + p.y).join("|")');
  assert.notEqual(after, before, '顶点动了多边形就该变');
  assert.doesNotThrow(() => ev('draw()'));
});
check('距离：两点 → 线段 + 长度标注', () => {
  const [a, b] = twoPoints();
  ev('startConstruct("dist")');
  ev(`constructPick({ id: ${a} })`);
  ev(`constructPick({ id: ${b} })`);
  const seg = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(seg.measure, 'length');
  assert.equal(seg.obj.kind, 'seg');
  assert.match(doc.getElementById('toast').textContent, /距离 = 4/);
  assert.doesNotThrow(() => ev('draw()'));
});
check('角度：三点 → 直角 90°', () => {
  ev('state.funcs = [];');
  ev('var A2 = addFunc("point","0,0","manual"); var B2 = addFunc("point","1,0","manual");' +
     ' var C2 = addFunc("point","1,1","manual"); renderList();');
  const ids = ev('state.funcs.map(f => f.id)');
  ev('startConstruct("angle")');
  ids.forEach(id => ev(`constructPick({ id: ${id} })`));
  const poly = ev('state.funcs[state.funcs.length - 1]');
  assert.equal(poly.measure, 'angle');
  assert.equal(poly.pts.length, 3);
  assert.doesNotThrow(() => ev('draw()'));
});
check('画布上点一下也能选（走 handleCanvasClick）', () => {
  const [a, b] = twoPoints();
  ev('startConstruct("mid")');
  const [sx, sy] = [400, 300];                     // (0,0) 上的 P1
  ev(`(() => { const e = new Event('pointerdown', { bubbles:true, cancelable:true });` +
     ` e.pointerId = 91; e.pointerType='mouse'; e.clientX=${sx}; e.clientY=${sy};` +
     ` document.getElementById('cv').dispatchEvent(e); })()`);
  assert.equal(ev('construct.picks.length'), 1, '画布点一下要选中那个点');
  ev(`constructPick({ id: ${b} })`);
  assert.equal(ev('state.funcs.filter(f => f.obj && f.obj.kind === "mid").length'), 1);
});
check('Esc 退出构造', () => {
  ev('startConstruct("poly")');
  ev('constructPick({ id: state.funcs[0].id })');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  assert.equal(ev('construct'), null);
  assert.ok(!doc.getElementById('pickBadge').classList.contains('show'));
});
check('多边形能挺过撤销 / 重做', () => {
  ev('state.funcs = [];');
  ev('var A3 = addFunc("point","0,0","manual"); var B3 = addFunc("point","2,0","manual");' +
     ' var C3 = addFunc("point","0,2","manual"); renderList();');
  const ids = ev('state.funcs.map(f => f.id)');
  ev('startConstruct("poly")');
  ids.forEach(id => ev(`constructPick({ id: ${id} })`));
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Enter' }));
  ev('hist.past = []; hist.future = []; hist.last = serializeObjects(); updateHistoryUI()');
  ev('deleteObject(state.funcs[state.funcs.length - 1].id)');
  assert.equal(ev('state.funcs.filter(f => f.type === "poly").length'), 0);
  ev('undo()');
  const polys = ev('state.funcs.filter(f => f.type === "poly")');
  assert.equal(polys.length, 1, '撤销把多边形找回来');
  assert.equal(polys[0].pts.length, 3);
  assert.doesNotThrow(() => ev('draw()'));
});
check('导出的 CSV 含多边形，导出 JSON 带 pts', () => {
  assert.match(ev('objectsForExport().map(r => r.kind).join(",")'), /polygon/);
  assert.match(win.exportJSON.toString(), /pts: f\.pts/);
});

console.log('\n[K] 三套主题的对比度（WCAG：正文 ≥4.5、大字/图形 ≥3）');
(function contrast(){
  const hex = h => {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  };
  const lum = rgb => {
    const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = c => {
    const m = String(c).trim().match(/^rgba?\(([^)]+)\)$/);
    if (m){ const p = m[1].split(',').map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
    return { rgb: hex(c), a: 1 };
  };
  const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg.rgb[i] * (1 - fg.a));
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const block = sel => {
    const i = css.indexOf(sel);
    if (i < 0) throw new Error('找不到主题块 ' + sel);
    const body = css.slice(i, css.indexOf('}', i));
    const out = {};
    for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = m[2].trim();
    return out;
  };
  const THEMES = [
    ['swiss-light', ':root, :root[data-theme="swiss-light"]{'],
    ['swiss-dark', ':root[data-theme="swiss-dark"]{'],
    ['swiss-green', ':root[data-theme="swiss-green"]{'],
  ];
  const PAIRS = [
    ['正文 ink/surface', 'ink', 'surface', 4.5],
    ['次要字 ink-2/surface', 'ink-2', 'surface', 4.5],
    ['辅助字 ink-3/surface', 'ink-3', 'surface', 4.5],
    ['错误字 danger/surface', 'danger', 'surface', 4.5],
    ['按钮 accent-on/accent', 'accent-on', 'accent', 4.5],
    ['画布刻度 tick/plot-bg', 'plot-tick', 'plot-bg-1', 3],
    ['画布轴 axis/plot-bg', 'plot-axis', 'plot-bg-1', 3],
  ];
  for (const [name, sel] of THEMES){
    const t = block(sel);
    for (const [label, fg, bg, min] of PAIRS){
      check(name + ' · ' + label, () => {
        if (!t[fg] || !t[bg]) throw new Error('缺令牌 ' + fg + '/' + bg);
        const B = parse(t[bg]), F = parse(t[fg]);
        const c = ratio(parse('rgb(' + over(F, B).map(Math.round).join(',') + ')').rgb, B.rgb);
        assert.ok(c >= min, c.toFixed(2) + ':1 < ' + min + ':1');
      });
    }
  }
})();

console.log('\n[L] 跟随系统主题 / 自动交点 / 811 工具索引');
function loadWith({ dark, saved, narrow, savedToolbar }){
  const d = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/811/function.html',
    beforeParse(w){
      w.matchMedia = (q) => ({
        matches: /prefers-color-scheme:\s*dark/.test(q) ? !!dark : false,
        media: q, onchange: null,
        addEventListener(){}, removeEventListener(){},
        addListener(){}, removeListener(){}, dispatchEvent: () => false,
      });
      if (saved){ try { w.localStorage.setItem('plot-theme', saved); } catch(e){} }
      if (savedToolbar){ try { w.localStorage.setItem('plot-toolbar', savedToolbar); } catch(e){} }
      if (narrow) Object.defineProperty(w, 'innerWidth', { value: narrow, configurable: true });
      w.HTMLCanvasElement.prototype.getContext = () => makeCtx(w);
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      w.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
      w.Element.prototype.setPointerCapture = () => {};
      w.Element.prototype.releasePointerCapture = () => {};
      w.Element.prototype.getBoundingClientRect = () =>
        ({ left:0, top:0, width:800, height:600, right:800, bottom:600, x:0, y:0 });
    },
  });
  return d.window;
}
check('系统是深色 → 默认深色主题', () => {
  const w = loadWith({ dark: true });
  assert.equal(w.document.documentElement.getAttribute('data-theme'), 'swiss-dark');
  w.close();
});
check('系统是浅色 → 默认浅色主题', () => {
  const w = loadWith({ dark: false });
  assert.equal(w.document.documentElement.getAttribute('data-theme'), 'swiss-light');
  w.close();
});
check('手动选过主题 → 以手动为准', () => {
  const w = loadWith({ dark: true, saved: 'swiss-green' });
  assert.equal(w.document.documentElement.getAttribute('data-theme'), 'swiss-green');
  w.close();
});
check('head 里就有跟随系统的脚本（不会闪一下）', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /prefers-color-scheme:\s*dark/);
  assert.match(head, /localStorage\.getItem\(/);
  assert.match(head, /plot-theme/);
});
check('自动交点：默认开，两条曲线能算出交点', () => {
  ev('state.funcs = []; addFunc("y","x","manual"); addFunc("y","x^2","manual");');
  assert.equal(ev('state.settings.autoInter'), true);
  const pts = ev('autoIntersections()');
  assert.equal(pts.length, 2, 'y=x 与 y=x² 有两个交点，实际 ' + pts.length);
  const xs = pts.map(p => p.x.toFixed(6)).sort().join(',');
  assert.equal(xs, '0.000000,1.000000');
  assert.doesNotThrow(() => ev('draw()'));
});
check('交点开关能关掉', () => {
  const sw = doc.getElementById('swInter');
  assert.ok(sw, '设置里要有这个开关');
  sw.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.settings.autoInter'), false);
  assert.equal(sw.getAttribute('aria-checked'), 'false');
  ev('draw()');
  sw.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.settings.autoInter'), true);
});
check('三条曲线两两求交并去重（同一个点只画一次）', () => {
  ev('state.funcs = []; addFunc("y","x","manual"); addFunc("y","x^2","manual"); addFunc("y","0","manual");');
  const pts = ev('autoIntersections()');
  const xs = pts.map(p => p.x.toFixed(6)).sort().join(',');
  assert.equal(xs, '0.000000,1.000000', '(0,0) 被三条曲线共用，只该出现一次；实际 ' + xs);
});
check('导出的 JSON 带 autoInter', () => assert.match(win.exportJSON.toString(), /autoInter/));
check('更多811工具里有「打开 811 工具索引」', () => {
  const a = doc.getElementById('toolsIndexLink');
  assert.ok(a, '按钮要在');
  assert.equal(a.getAttribute('href'), '/811/index.html');
  assert.match(a.textContent, /811 工具索引/);
  assert.equal(a.getAttribute('target'), '_blank');
});

check('启动不算手动选择：不写 localStorage（下次还跟系统）', () => {
  const w = loadWith({ dark: true });
  assert.equal(w.document.documentElement.getAttribute('data-theme'), 'swiss-dark');
  assert.equal(w.localStorage.getItem('plot-theme'), null, '启动不该把主题存下来');
  w.close();
});
check('手动选主题 → 存下来；点「跟随系统」→ 清掉并回到系统色', () => {
  ev('setTheme("swiss-green")');
  assert.equal(win.localStorage.getItem('plot-theme'), 'swiss-green');
  ev('setTheme("auto")');
  assert.equal(win.localStorage.getItem('plot-theme'), null, '跟随系统要把手动选择清掉');
  assert.equal(ev('savedTheme()'), null);
  assert.equal(ev('currentTheme()'), ev('systemThemeName()'));
});
check('设置里的主题分段控件有「跟随系统」', () => {
  const btns = [...doc.querySelectorAll('#themeSeg .seg-btn')].map(b => b.dataset.theme);
  assert.equal(btns.join(','), 'swiss-light,swiss-dark,swiss-green,auto');
});
check('跟随系统时，分段控件勾在「跟随系统」上', () => {
  ev('setTheme("auto")');
  const on = [...doc.querySelectorAll('#themeSeg .seg-btn')].filter(b => b.getAttribute('aria-checked') === 'true');
  assert.equal(on.length, 1);
  assert.equal(on[0].dataset.theme, 'auto');
  ev('setTheme("swiss-light")');
  const on2 = [...doc.querySelectorAll('#themeSeg .seg-btn')].filter(b => b.getAttribute('aria-checked') === 'true');
  assert.equal(on2.length, 1);
  assert.equal(on2[0].dataset.theme, 'swiss-light');
  ev('setTheme("auto")');
});

console.log('\n[M] 导出图片（无 UI 截图）');
const opsOf = (kind) => ev(`__ops.filter(o => o === ${JSON.stringify(kind)}).length`);
const resetOps = () => ev('__ops.length = 0');
const SHOT_DEFAULT = 'shotOpts = { format:"png", scale:2, grid:true, axes:true, bg:"theme", quality:0.92 }';

check('四个入口都在', () => {
  assert.ok(doc.querySelector('#menuPop .menu-item[data-act="shot"]'), '☰ 菜单要有');
  assert.ok(doc.getElementById('expShot'), '更多811工具要有');
  assert.ok(doc.querySelector('#ctxMenu .menu-item[data-act="shot"]'), '绘图区右键菜单要有');
  assert.ok(doc.getElementById('shotModal'), '弹窗要在');
});
check('P 键开、再按关；页脚写了这个快捷键', () => {
  ev('closeShot()');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'p' }));
  assert.ok(doc.getElementById('shotModal').classList.contains('show'));
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'p' }));
  assert.ok(!doc.getElementById('shotModal').classList.contains('show'));
  assert.match(doc.querySelector('.footnote').textContent, /P/);
});
check('预设「只有图像」→ 关网格关坐标系 + 透明；「和屏幕一样」→ 还原', () => {
  ev(SHOT_DEFAULT);
  ev('shotPreset("image")');
  assert.equal(ev('shotOpts.grid'), false);
  assert.equal(ev('shotOpts.axes'), false);
  assert.equal(ev('shotOpts.bg'), 'transparent');
  assert.equal(doc.getElementById('shotGrid').getAttribute('aria-checked'), 'false');
  ev('shotPreset("view")');
  assert.equal(ev('shotOpts.grid'), true);
  assert.equal(ev('shotOpts.axes'), true);
  assert.equal(ev('shotOpts.bg'), 'theme');
});
check('开关 / 下拉 / 格式 / 倍率 都能改选项', () => {
  const clickSw = (id) => doc.getElementById(id).dispatchEvent(new win.Event('click', { bubbles: true }));
  clickSw('shotGrid');
  assert.equal(ev('shotOpts.grid'), false);
  clickSw('shotGrid');
  assert.equal(ev('shotOpts.grid'), true);
  const bg = doc.getElementById('shotBg');
  bg.value = 'dark';
  bg.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(ev('shotOpts.bg'), 'dark');
  doc.querySelector('#shotFormat .seg-btn[data-format="webp"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('shotOpts.format'), 'webp');
  doc.querySelector('#shotScale .seg-btn[data-scale="3"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('shotOpts.scale'), 3);
  ev(SHOT_DEFAULT);
});
check('shotPlan：PNG 无质量、尺寸 = 舞台 × 倍率（桩里舞台是 800×600）', () => {
  ev(SHOT_DEFAULT);
  const p = ev('shotPlan()');
  assert.equal(p.mime, 'image/png');
  assert.equal(p.ext, 'png');
  assert.equal(p.quality, undefined);
  assert.equal(p.width, 1600);
  assert.equal(p.height, 1200);
  assert.equal(p.transparent, false);
  assert.equal(p.solid, null);
});
check('JPG + 透明 → 自动改纯白（JPEG 没有 alpha 通道）', () => {
  ev('shotOpts = { format:"jpeg", scale:2, grid:true, axes:true, bg:"transparent", quality:0.8 }');
  const p = ev('shotPlan()');
  assert.equal(p.bg, 'paper');
  assert.equal(p.transparent, false);
  assert.equal(p.solid, '#FFFFFF');
  assert.equal(p.ext, 'jpg');
  assert.equal(p.mime, 'image/jpeg');
  assert.equal(p.quality, 0.8);
  assert.ok(p.palette && p.palette.grid1, '纯白底要配亮色线色');
});
check('纯黑底配暗色线色（不是当前主题那套）', () => {
  ev('shotOpts = { format:"webp", scale:1, grid:true, axes:true, bg:"dark", quality:1 }');
  const p = ev('shotPlan()');
  assert.equal(p.mime, 'image/webp');
  assert.equal(p.quality, 1);
  assert.equal(p.solid, '#0F1012');
  assert.notEqual(p.palette.tick, ev('CV.tick'), '暗色刻度色应不同于当前主题');
});
check('倍率越界被夹到 1–4', () => {
  ev('shotOpts.scale = 0');
  assert.equal(ev('shotPlan()').scale, 1);
  ev('shotOpts.scale = 99');
  assert.equal(ev('shotPlan()').scale, 4);
  ev(SHOT_DEFAULT);
});
check('透明底不铺背景；跟随主题铺', () => {
  ev('state.funcs = []; addFunc("y","x^2","manual"); renderList()');
  ev('shotOpts = { format:"png", scale:1, grid:false, axes:false, bg:"transparent", quality:0.92 }');
  resetOps();
  ev('renderShotCanvas(shotPlan())');
  assert.equal(opsOf('fillRect'), 0, '透明底不该铺满背景');
  ev('shotOpts.bg = "theme"');
  resetOps();
  ev('renderShotCanvas(shotPlan())');
  assert.ok(opsOf('fillRect') >= 1, '跟随主题要铺背景');
});
check('关网格 stroke 变少；关坐标系 fillText 变少', () => {
  ev('shotOpts = { format:"png", scale:1, grid:true, axes:true, bg:"theme", quality:0.92 }');
  resetOps(); ev('renderShotCanvas(shotPlan())');
  const strokeAll = opsOf('stroke'), textAll = opsOf('fillText');
  assert.ok(strokeAll > 0 && textAll > 0, '基准要有东西：' + strokeAll + '/' + textAll);
  ev('shotOpts.grid = false');
  resetOps(); ev('renderShotCanvas(shotPlan())');
  const strokeNoGrid = opsOf('stroke');
  assert.ok(strokeNoGrid < strokeAll, '关网格 stroke 该变少：' + strokeNoGrid + ' < ' + strokeAll);
  ev('shotOpts.axes = false');
  resetOps(); ev('renderShotCanvas(shotPlan())');
  assert.ok(opsOf('fillText') < textAll, '关坐标系刻度/轴标签该不画');
});
check('导出不画界面叠层（悬停十字 / 数值表标记），实时画面照画', () => {
  ev('hover = { mx: 30, my: 30 }; vtHighlight = { x: 1 }');
  ev('shotOpts = { format:"png", scale:1, grid:false, axes:false, bg:"transparent", quality:0.92 }');
  resetOps();
  ev('renderShotCanvas(shotPlan())');
  assert.equal(opsOf('setLineDash'), 0, '导出图里不该有虚线');
  resetOps();
  ev('draw()');
  assert.ok(opsOf('setLineDash') >= 1, '实时画面该有虚线');
  ev('hover = null; vtHighlight = null');
});
check('导出后实时画面照旧：W/H/ctx/CV/选中 全还原', () => {
  ev('state.funcs = []; addFunc("y","x^2","manual"); renderList(); selectObject(state.funcs[0].id)');
  ev(SHOT_DEFAULT);
  const W0 = ev('W'), H0 = ev('H'), ctxId = ev('ctx.__id'), sel = ev('selectedId'), tick = ev('CV.tick');
  ev('renderShotCanvas(shotPlan())');
  assert.equal(ev('W'), W0);
  assert.equal(ev('H'), H0);
  assert.equal(ev('ctx.__id'), ctxId, 'ctx 要换回原来那个');
  assert.equal(ev('selectedId'), sel, '选中不能丢');
  assert.equal(ev('CV.tick'), tick, '调色板不能变');
  assert.equal(ev('renderOverride'), null, '渲染覆盖要清掉');
  assert.doesNotThrow(() => ev('draw()'));
});
check('exportShot：WebP 的 MIME / 质量 / 文件名都对', () => {
  ev('shotOpts = { format:"webp", scale:2, grid:true, axes:true, bg:"transparent", quality:0.75 }');
  ev('exportShot()');
  assert.equal(ev('__lastToBlob.mime'), 'image/webp');
  assert.equal(ev('__lastToBlob.quality'), 0.75);
  assert.match(ev('__lastDownload'), /^plot-[\d-]+\.webp$/);
});
check('exportShot：JPG 存成 .jpg 且带质量', () => {
  ev('shotOpts = { format:"jpeg", scale:1, grid:false, axes:false, bg:"transparent", quality:0.6 }');
  ev('exportShot()');
  assert.equal(ev('__lastToBlob.mime'), 'image/jpeg');
  assert.equal(ev('__lastToBlob.quality'), 0.6);
  assert.match(ev('__lastDownload'), /\.jpg$/);
});
check('浏览器不给 WebP 时按实际类型存并提示', () => {
  ev('window.__forceMime = "image/png"');
  ev('shotOpts = { format:"webp", scale:1, grid:true, axes:true, bg:"theme", quality:0.9 }');
  ev('exportShot()');
  assert.match(ev('__lastDownload'), /\.png$/, '退回 PNG 要改扩展名');
  assert.match(doc.getElementById('toast').textContent, /不支持 WEBP|改存/);
  ev('window.__forceMime = null');
});
check('白/黑底时曲线配色一起换，导出后还原', () => {
  ev('setTheme("swiss-dark", true)');
  ev('state.funcs = []; addFunc("y","x^2","manual"); renderList()');
  const darkColor = ev('state.funcs[0].color');
  ev('shotOpts = { format:"png", scale:1, grid:true, axes:true, bg:"paper", quality:0.92 }');
  /* 渲染时短暂换色：用 __ops 之外的办法看——渲染完必须还原，所以这里查还原 + 计划里带了配色 */
  const plan = ev('shotPlan()');
  assert.ok(plan.curvePalette && plan.curvePalette.length >= 6, '纯白底要带一套亮色曲线配色');
  assert.notEqual(plan.curvePalette[0], ev('THEME_PALETTE["swiss-dark"][0]'), '两套配色不该一样');
  ev('renderShotCanvas(shotPlan())');
  assert.equal(ev('state.funcs[0].color'), darkColor, '导出后曲线颜色要还原');
  ev('shotOpts.bg = "theme"');
  assert.equal(ev('shotPlan()').curvePalette, null, '跟随主题时不换色');
});
check('信息行跟着选项走，PNG 不显示质量', () => {
  ev('shotOpts = { format:"png", scale:2, grid:true, axes:true, bg:"transparent", quality:0.92 }');
  ev('syncShotUI()');
  const t = doc.getElementById('shotInfo').textContent;
  assert.match(t, /1600 × 1200 px/);
  assert.match(t, /PNG/);
  assert.match(t, /透明底/);
  assert.ok(doc.getElementById('shotQualityRow').classList.contains('hidden'), 'PNG 不显示质量');
  ev('shotOpts.format = "jpeg"');
  ev('syncShotUI()');
  assert.match(doc.getElementById('shotInfo').textContent, /JPG/);
  assert.ok(!doc.getElementById('shotQualityRow').classList.contains('hidden'), 'JPG 要显示质量');
  ev(SHOT_DEFAULT);
});
check('预览图会生成', () => {
  ev('openShot()');
  assert.match(doc.getElementById('shotPreview').getAttribute('src') || '', /^data:image\/png/);
  assert.equal(doc.getElementById('shotClose').getAttribute('aria-label'), '关闭');
  ev('closeShot()');
  assert.ok(!doc.getElementById('shotModal').classList.contains('show'));
});
check('Esc 能关掉导出弹窗和更多811工具', () => {
  ev('openShot()');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  assert.ok(!doc.getElementById('shotModal').classList.contains('show'));
  ev('openTools()');
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  assert.ok(!doc.getElementById('toolsModal').classList.contains('show'));
});

console.log('\n[N] 工具栏可收起（真机上横滑不靠谱）');
check('工具栏里有收起按钮，默认展开（宽屏）', () => {
  const bar = doc.getElementById('toolbar');
  const btn = doc.getElementById('toolbarToggle');
  assert.ok(btn, '按钮要在');
  assert.ok(bar.contains(btn), '按钮要在工具栏里');
  assert.equal(btn.getAttribute('aria-controls'), 'toolbar');
  assert.equal(bar.classList.contains('collapsed'), false, 'jsdom 窗口宽 1024 → 默认展开');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
});
check('点一下收起：只留 primary 那一组 + 记住选择', () => {
  const bar = doc.getElementById('toolbar');
  const btn = doc.getElementById('toolbarToggle');
  assert.ok(bar.querySelector('.tool-group.primary'), '第一组要有 primary 标记');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(bar.classList.contains('collapsed'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.match(btn.getAttribute('aria-label'), /展开/);
  assert.equal(win.localStorage.getItem('plot-toolbar'), 'closed');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(!bar.classList.contains('collapsed'));
  assert.equal(win.localStorage.getItem('plot-toolbar'), 'open');
});
check('setToolbarCollapsed(on,false) 不写 localStorage', () => {
  ev('setToolbarCollapsed(true, false)');
  assert.ok(doc.getElementById('toolbar').classList.contains('collapsed'));
  assert.equal(win.localStorage.getItem('plot-toolbar'), 'open', '还是上次的值');
  ev('setToolbarCollapsed(false, false)');
});
check('窄屏默认收起、宽屏默认展开', () => {
  const narrow = loadWith({ narrow: 420 });
  assert.ok(narrow.document.getElementById('toolbar').classList.contains('collapsed'), '窄屏该默认收起');
  narrow.close();
  const wide = loadWith({ narrow: 1440 });
  assert.ok(!wide.document.getElementById('toolbar').classList.contains('collapsed'), '宽屏该默认展开');
  wide.close();
});
check('选过之后以用户选择为准（窄屏也不再自动收起）', () => {
  const w = loadWith({ narrow: 420, savedToolbar: 'open' });
  assert.ok(!w.document.getElementById('toolbar').classList.contains('collapsed'));
  w.close();
});
check('收起后 primary 组里的工具还能用', () => {
  ev('setToolbarCollapsed(true, false)');
  doc.querySelector('.tool[data-tool="point"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('tool'), 'point');
  ev('setTool("move", true)');
  ev('setToolbarCollapsed(false, false)');
});

console.log('\n[O] 侧栏与点表收起 / 帮助浮窗 / 对齐选项 / 注释');
check('左侧栏能收起，并记住选择', () => {
  const btn = doc.getElementById('panelToggle');
  assert.ok(btn, '顶栏要有侧栏开关');
  const ws = doc.querySelector('.workspace');
  win.localStorage.setItem('plot-panel', 'open');
  ev('setPanelCollapsed(false, false)');
  assert.ok(!ws.classList.contains('panel-collapsed'));
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(ws.classList.contains('panel-collapsed'), '点一下收起');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(win.localStorage.getItem('plot-panel'), 'closed');
  btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(!ws.classList.contains('panel-collapsed'));
  assert.equal(win.localStorage.getItem('plot-panel'), 'open');
});
check('点表（表格区）收起状态会记住', () => {
  const tv = doc.getElementById('tableView');
  const tg = doc.getElementById('tvToggle');
  tg.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.ok(tv.classList.contains('collapsed'));
  assert.equal(win.localStorage.getItem('plot-table'), 'closed');
  tg.dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(win.localStorage.getItem('plot-table'), 'open');
});
check('帮助是点击后的浮窗，不是跳转', () => {
  const hm = doc.getElementById('helpModal');
  assert.ok(hm, '要有帮助浮窗');
  assert.ok(!hm.classList.contains('show'));
  ev('showHelp()');
  assert.ok(hm.classList.contains('show'), 'showHelp 要打开浮窗');
  const txt = hm.textContent;
  ['能输入的东西', '函数与常量', '工具怎么用', '鼠标与触屏', '键盘', 'Curve(', 'If('].forEach(k =>
    assert.ok(txt.includes(k), '帮助里要有：' + k));
  win.dispatchEvent(Object.assign(new win.Event('keydown', { bubbles: true }), { key: 'Escape' }));
  assert.ok(!hm.classList.contains('show'), 'Esc 能关掉');
  assert.equal(doc.querySelector('#menuPop .menu-item[data-act="help"]').textContent.trim(), '帮助 / 语法速查');
});
check('对齐方式：网格 / 鼠标指针', () => {
  assert.equal(ev('state.settings.alignMode'), 'grid');
  ev('state.settings.snap = true; state.settings.snapStep = 0.5');
  assert.equal(ev('JSON.stringify(snapPoint({x:1.31,y:-2.44}))'), JSON.stringify({ x:1.5, y:-2.5 }));
  ev('setAlignMode("pointer")');
  assert.equal(ev('state.settings.alignMode'), 'pointer');
  assert.equal(ev('JSON.stringify(snapPoint({x:1.31,y:-2.44}))'), JSON.stringify({ x:1.31, y:-2.44 }));
  assert.equal(doc.querySelector('#alignSeg .seg-btn[data-align="pointer"]').getAttribute('aria-checked'), 'true');
  ev('setAlignMode("grid")');
  assert.equal(ev('JSON.stringify(snapPoint({x:1.31,y:-2.44}))'), JSON.stringify({ x:1.5, y:-2.5 }));
});
check('网格步长可微调（0.01 起），快捷值能点', () => {
  ev('setSnapStep(0.25)');
  assert.equal(ev('state.settings.snapStep'), 0.25);
  assert.equal(ev('JSON.stringify(snapPoint({x:1.31,y:-2.44}))'), JSON.stringify({ x:1.25, y:-2.5 }));
  doc.querySelector('#snapChips .chip[data-step="2"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.settings.snapStep'), 2);
  assert.ok(doc.querySelector('#snapChips .chip[data-step="2"]').classList.contains('on'));
  ev('setSnapStep(0.01)');
  assert.equal(ev('state.settings.snapStep'), 0.01);
  ev('setSnapStep(0.5)');
});
check('注释对象：能放、能选中、能改字体和坐标', () => {
  ev('state.funcs = []; addFunc("y","","manual",0)');
  ev('placeTextAt(400, 300)');
  const f = ev('state.funcs.find(o => o.type === "text")');
  assert.ok(f, '要生成一个 text 对象');
  assert.equal(f.expr, '注释');
  assert.ok(isFinite(f.x) && isFinite(f.y), '要用坐标存位置');
  assert.equal(f.font.size, 15);
  assert.equal(f.font.family, 'sans');
  assert.equal(ev('hitTestObject(w2sX(state.funcs[1].x), w2sY(state.funcs[1].y)).type'), 'text', '点它要能选中');
  assert.doesNotThrow(() => ev('draw()'));
  const tb = ev('textBox(state.funcs[1])');
  assert.ok(tb.w > 0 && tb.h > 0, '要能算出外框');
});
check('注释：属性面板有字体控件，改了会生效', () => {
  const f = ev('state.funcs.find(o => o.type === "text")');
  ev('selectObject(' + JSON.stringify(f.id) + ')');
  assert.notEqual(doc.getElementById('propsTextRow').style.display, 'none', '注释要显示字号行');
  assert.equal(doc.getElementById('propsWidthRow').style.display, 'none', '注释不显示粗细行');
  const fs = doc.getElementById('propsFontSize');
  fs.value = '30';
  fs.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(ev('state.funcs.find(o => o.type === "text").font.size'), 30);
  const ff = doc.getElementById('propsFontFamily');
  ff.value = 'mono';
  ff.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(ev('state.funcs.find(o => o.type === "text").font.family'), 'mono');
  doc.querySelector('#propsFontStyle .seg-btn[data-style="bold"]').dispatchEvent(new win.Event('click', { bubbles: true }));
  assert.equal(ev('state.funcs.find(o => o.type === "text").font.bold'), true);
  assert.match(ev('textFontCss(state.funcs.find(o => o.type === "text").font)'), /700 30px/);
  const px = doc.getElementById('propsX');
  px.value = '2.5';
  px.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(ev('state.funcs.find(o => o.type === "text").x'), 2.5);
});
check('注释：拖动能改坐标', () => {
  const f = ev('state.funcs.find(o => o.type === "text")');
  ev('beginPointDrag(findObj(' + JSON.stringify(f.id) + '))');
  ev('updatePointDrag(200, 150)');
  const after = ev('state.funcs.find(o => o.type === "text")');
  assert.ok(isFinite(after.x) && isFinite(after.y));
  ev('endPointDrag()');
  ev('selectObject(null)');
});
check('注释进 JSON 存档（位置 + 字体）', () => {
  const src = win.exportJSON.toString();
  assert.match(src, /type === 'text' \? \{ x: f\.x, y: f\.y, font/);
  const data = JSON.parse(ev('JSON.stringify({ functions: state.funcs.map(f => ({ type:f.type, expr:f.expr, x:f.x, y:f.y, font:f.font })) })'));
  const t = data.functions.find(o => o.type === 'text');
  assert.ok(t && isFinite(t.x) && isFinite(t.y) && t.font && t.font.size === 30, '存档里要有坐标和字体');
});
check('注释行在代数区里，能编辑内容', () => {
  ev('renderList()');
  const row = doc.querySelector('.fn-row[data-id="' + ev('state.funcs.find(o => o.type === "text").id') + '"]');
  assert.ok(row, '注释要出现在代数区');
  const inp = row.querySelector('.fn-input');
  assert.ok(inp, '注释内容要能编辑');
  inp.value = '顶点在这里';
  inp.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(ev('state.funcs.find(o => o.type === "text").expr'), '顶点在这里');
  assert.equal(ev('state.funcs.find(o => o.type === "text").error'), null, '注释不该报语法错');
});

console.log('\n[P] 公式排版（可选）：上标 / 下标 / 分式 / 根号 / 符号');
check('上标下标能拆出来', () => {
  const runs = ev('JSON.stringify(texParse("x^2"))');
  assert.equal(runs, JSON.stringify([{ t:'base', s:'x' }, { t:'sup', s:'2' }]));
  assert.equal(ev('JSON.stringify(texParse("a_2"))'), JSON.stringify([{ t:'base', s:'a' }, { t:'sub', s:'2' }]));
  assert.equal(ev('JSON.stringify(texParse("a_{12}"))'), JSON.stringify([{ t:'base', s:'a' }, { t:'sub', s:'12' }]));
});
check('乘号 / 常量符号会换成正字形', () => {
  const runs = JSON.parse(ev('JSON.stringify(texParse("x \\\\times \\\\pi"))'));
  const all = runs.map(r => r.s || '').join('');
  assert.ok(all.includes('×') && all.includes('π'), '实际：' + all);
});
check('分式和根号', () => {
  assert.equal(ev('JSON.stringify(texParse("\\\\frac{a}{b}"))'), JSON.stringify([{ t:'frac', a:'a', b:'b' }]));
  assert.equal(ev('JSON.stringify(texParse("\\\\sqrt{x+1}"))'), JSON.stringify([{ t:'sqrt', s:'x+1' }]));
});
check('只有带标记的行才走排版', () => {
  assert.equal(ev('hasTexMark("x^2")'), true);
  assert.equal(ev('hasTexMark("\\\\frac{a}{b}")'), true);
  assert.equal(ev('hasTexMark("就是一句话")'), false);
  assert.equal(ev('hasTexMark("x2")'), false);
});
check('开关关掉后按纯文字量宽度', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); placeTextAt(300, 200)');
  const f = 'state.funcs.find(o => o.type === "text")';
  ev(f + '.expr = "x^2 + \\\\frac{1}{2}"');
  ev('state.settings.texRender = true');
  const on = ev('(function(){ const b = textBox(' + f + '); return b.w; })()');
  ev('state.settings.texRender = false');
  const off = ev('(function(){ const b = textBox(' + f + '); return b.w; })()');
  assert.ok(on > 0 && off > 0, '两种模式都要能算宽：' + on + '/' + off);
  assert.notEqual(on, off, '排版和纯文字的宽度不该一样');
  ev('state.settings.texRender = true');
  assert.doesNotThrow(() => ev('draw()'));
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
});
check('注释里画公式不炸（三种写法）', () => {
  ev('state.funcs = []; addFunc("y","","manual",0); placeTextAt(300, 200)');
  const f = 'state.funcs.find(o => o.type === "text")';
  for (const s of ['x^2 \\\\times x', 'a_2 + b_2', '\\\\frac{a}{b} = \\\\sqrt{x}']){
    ev(f + '.expr = ' + JSON.stringify(s));
    assert.doesNotThrow(() => ev('draw()'), s);
    assert.ok(ev('textBox(' + f + ').w') > 0, s);
  }
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
});
check('设置里有公式排版开关，默认开', () => {
  assert.equal(ev('state.settings.texRender'), true);
  assert.ok(doc.getElementById('swTex'), '要有开关');
  assert.ok(doc.getElementById('swTex').classList.contains('on'));
});

check('注释真的会被画到画布上（不是只有数据）', () => {
  ev('state.funcs = []; addFunc("y","","manual",0)');
  ev('state.settings.texRender = true');
  const f = ev('addTextObj(0, 0, "x^2 \\\\times x").id');
  ev('hover = null; vtHighlight = null; selectObject(null)');
  resetOps();
  ev('draw()');
  assert.ok(opsOf('fillText') > 0 || opsOf('stroke') > 0, '注释文字要真的画出来');
  const box = ev('textBox(findObj(' + f + '))');
  assert.ok(box.w > 4 && box.h > 4, '外框要有尺寸');
  ev('selectObject(' + f + ')');
  resetOps();
  ev('draw()');
  assert.ok(opsOf('setLineDash') > 0, '选中注释要画虚线框');
  ev('selectObject(null)');
  ev('state.funcs = []; addFunc("y","","manual",0); renderList()');
});

console.log('\n' + (fails.length ? `✗ ${fails.length} 项失败` : '✓ 全部通过'));
process.exitCode = fails.length ? 1 : 0;
