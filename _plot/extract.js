
/* ═══════════════════════════════════════════════════
   0. 基础
   ═══════════════════════════════════════════════════ */

const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');

/* ═══════════════════════════════════════════════════
   1. 数学函数与常量
   ═══════════════════════════════════════════════════ */

const CONSTS = { pi:Math.PI, PI:Math.PI, e:Math.E, E:Math.E, tau:Math.PI*2 };

const fn1 = f => ({ arity:1, f });
const fn2 = f => ({ arity:2, f });
const fnN = f => ({ arity:-1, f });

const FUNCS = {
  sin:fn1(Math.sin), cos:fn1(Math.cos), tan:fn1(Math.tan),
  asin:fn1(Math.asin), arcsin:fn1(Math.asin),
  acos:fn1(Math.acos), arccos:fn1(Math.acos),
  atan:fn1(Math.atan), arctan:fn1(Math.atan),
  sinh:fn1(Math.sinh), cosh:fn1(Math.cosh), tanh:fn1(Math.tanh),
  ln:fn1(Math.log), log:fn1(Math.log10), log2:fn1(Math.log2), log10:fn1(Math.log10),
  exp:fn1(Math.exp), sqrt:fn1(Math.sqrt), cbrt:fn1(Math.cbrt),
  abs:fn1(Math.abs), floor:fn1(Math.floor), ceil:fn1(Math.ceil),
  round:fn1(Math.round), sign:fn1(Math.sign),
  min:fnN((...a)=>Math.min(...a)),
  max:fnN((...a)=>Math.max(...a)),
  pow:fn2(Math.pow), atan2:fn2(Math.atan2),
  mod:fn2((a,b)=>a-b*Math.floor(a/b)),
};

const COMPARISONS = new Set(['<','>','<=','>=','==','!=']);

function compare(a, b, op){
  switch(op){
    case '<':  return a < b;
    case '>':  return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
  return false;
}
const truthy = v => v !== 0 && !Number.isNaN(v);

/* ═══════════════════════════════════════════════════
   2. 词法 / 语法
   ═══════════════════════════════════════════════════ */

function tokenize(src){
  const s = src.replace(/\s+/g, '');
  const out = [];
  let i = 0;
  while (i < s.length){
    const c = s[i], c2 = s[i+1];
    if ((c==='<'||c==='>') && c2==='='){ out.push({t:c+'='}); i+=2; continue; }
    if (c==='=' && c2==='='){ out.push({t:'=='}); i+=2; continue; }
    if (c==='!' && c2==='='){ out.push({t:'!='}); i+=2; continue; }
    if (c==='&' && c2==='&'){ out.push({t:'&&'}); i+=2; continue; }
    if (c==='|' && c2==='|'){ out.push({t:'||'}); i+=2; continue; }

    if (/[0-9.]/.test(c)){
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j]==='e' || s[j]==='E'){
        let k = j+1;
        if (s[k]==='+' || s[k]==='-') k++;
        if (/[0-9]/.test(s[k]||'')){
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const num = parseFloat(s.slice(i, j));
      if (!isFinite(num)) throw new Error('数字写错了');
      out.push({ t:'num', v:num });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)){
      let j = i;
      while (j < s.length && /[a-zA-Z_0-9]/.test(s[j])) j++;
      out.push({ t:'id', v:s.slice(i, j) });
      i = j;
    } else if (c==='='){ out.push({t:'=='}); i++; }
    else if (c==='&'){ out.push({t:'&&'}); i++; }
    else if (c==='|'){ out.push({t:'||'}); i++; }
    else if ('+-*/^%(),{}<>!'.includes(c)){ out.push({t:c}); i++; }
    else throw new Error('看不懂这个符号：' + c);
  }
  return out;
}

/* 编译时接收变量名数组，变量按位置取 args[idx] */
function compile(src, varNames){
  if (!src || !src.trim()) throw new Error('空的');
  let s = src.trim().replace(/^\s*(y|f\s*\(\s*x\s*\)|r)\s*=\s*/i, '');

  const tokens = tokenize(s);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const need = t => {
    if (!peek() || peek().t !== t) throw new Error('这里少了个 ' + t);
    return next();
  };

  function parseOr(){
    let left = parseAnd();
    while (peek() && peek().t === '||'){
      next();
      const r = parseAnd(), l = left;
      left = (...a) => (truthy(l(...a)) || truthy(r(...a))) ? 1 : 0;
    }
    return left;
  }
  function parseAnd(){
    let left = parseComparison();
    while (peek() && peek().t === '&&'){
      next();
      const r = parseComparison(), l = left;
      left = (...a) => (truthy(l(...a)) && truthy(r(...a))) ? 1 : 0;
    }
    return left;
  }
  function parseComparison(){
    const first = parseExpr();
    const ops = [], vals = [first];
    while (peek() && COMPARISONS.has(peek().t)){
      ops.push(next().t);
      vals.push(parseExpr());
    }
    if (ops.length === 0) return first;
    if (ops.length === 1){
      const a = vals[0], b = vals[1], op = ops[0];
      return (...args) => compare(a(...args), b(...args), op) ? 1 : 0;
    }
    return (...args) => {
      for (let i = 0; i < ops.length; i++){
        if (!compare(vals[i](...args), vals[i+1](...args), ops[i])) return 0;
      }
      return 1;
    };
  }
  function parseExpr(){
    let left = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')){
      const op = next().t;
      const r = parseTerm(), l = left;
      left = op === '+' ? (...a)=>l(...a)+r(...a) : (...a)=>l(...a)-r(...a);
    }
    return left;
  }
  function parseTerm(){
    let left = parseUnary();
    for(;;){
      const tk = peek();
      if (!tk) break;
      if (tk.t === '*' || tk.t === '/' || tk.t === '%'){
        next();
        const r = parseUnary(), l = left, op = tk.t;
        if (op === '*')      left = (...a)=>l(...a)*r(...a);
        else if (op === '/') left = (...a)=>l(...a)/r(...a);
        else                 left = (...a)=>l(...a)%r(...a);
      } else if (tk.t === 'num' || tk.t === 'id' || tk.t === '('){
        const r = parseUnary(), l = left;
        left = (...a)=>l(...a)*r(...a);
      } else break;
    }
    return left;
  }
  function parseUnary(){
    const tk = peek();
    if (tk && tk.t === '-'){ next(); const v = parseUnary(); return (...a)=>-v(...a); }
    if (tk && tk.t === '+'){ next(); return parseUnary(); }
    if (tk && tk.t === '!'){ next(); const v = parseUnary(); return (...a)=>truthy(v(...a))?0:1; }
    return parseConditional();
  }
  function parseConditional(){
    const base = parsePower();
    const conds = [];
    while (peek() && peek().t === '{'){
      next();
      conds.push(parseOr());
      need('}');
    }
    if (conds.length === 0) return base;
    return (...a) => {
      for (let i = 0; i < conds.length; i++){
        if (!truthy(conds[i](...a))) return NaN;
      }
      return base(...a);
    };
  }
  function parsePower(){
    const base = parseAtom();
    if (peek() && peek().t === '^'){
      next();
      const e = parseUnary(), b = base;
      return (...a)=>Math.pow(b(...a), e(...a));
    }
    return base;
  }
  function parseAtom(){
    const tk = next();
    if (!tk) throw new Error('表达式没写完');
    if (tk.t === 'num'){ const v = tk.v; return ()=>v; }

    if (tk.t === 'id'){
      const name = tk.v;
      if (peek() && peek().t === '('){
        next();
        const args = [];
        if (peek() && peek().t !== ')'){
          args.push(parseOr());
          while (peek() && peek().t === ','){ next(); args.push(parseOr()); }
        }
        need(')');
        /* GeoGebra 的 If(条件, 真, 假) */
        if (name.toLowerCase() === 'if'){
          if (args.length !== 2 && args.length !== 3)
            throw new Error('If 要写成 If(条件, 值) 或 If(条件, 真, 假)');
          const c = args[0], a = args[1], b = args[2];
          return (...x) => truthy(c(...x)) ? a(...x) : (b ? b(...x) : NaN);
        }
        const spec = FUNCS[name.toLowerCase()];
        if (!spec) throw new Error('不认识的函数：' + name);
        if (spec.arity >= 0 && args.length !== spec.arity)
          throw new Error(`${name} 要 ${spec.arity} 个参数，你给了 ${args.length} 个`);
        const A = args;
        return (...x) => spec.f(...A.map(g => g(...x)));
      }
      if (name in CONSTS){ const v = CONSTS[name]; return ()=>v; }

      const idx = varNames.indexOf(name);
      if (idx >= 0) return (...args) => args[idx];

      throw new Error('不认识的变量：' + name);
    }
    if (tk.t === '('){
      const inner = parseOr();
      need(')');
      return inner;
    }
    throw new Error('这里多了个 ' + tk.t);
  }

  const fn = parseOr();
  if (pos < tokens.length){
    const t = tokens[pos];
    throw new Error('多余的符号：' + (t.v !== undefined ? t.v : t.t));
  }
  return fn;
}

/* 顶层逗号拆分：用于参数方程 (x(t), y(t)) */
function splitTopLevel(s){
  const parts = [];
  let depth = 0, cur = '';
  for (const c of s){
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0){ parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map(p => p.trim()).filter(p => p !== '');
}

/* ═══════════════════════════════════════════════════
   3. 图形类型
   ═══════════════════════════════════════════════════ */

/* vars 只是默认值：真正用哪几个字母，由 recompile 现场从表达式里认 */
const TYPES = {
  y: {
    key:'y', label:'函数', icon:'y', sub:'y = f(x)',
    vars:['x'], placeholder:'sin(x)',
    hint:'只含一个自变量；也能换名字，比如 a=54b+cos(b)',
  },
  implicit: {
    key:'implicit', label:'隐函数', icon:'◇', sub:'f(x,y)=0',
    vars:['x','y'], placeholder:'x^2+y^2-4',
    hint:'含两个未知数，字母随便挑',
  },
  polar: {
    key:'polar', label:'极坐标', icon:'θ', sub:'r = f(t)',
    vars:['t'], placeholder:'1+cos(t)',
    hint:'含 t 作为角度，也能换成别的字母',
  },
  parametric: {
    key:'parametric', label:'参数方程', icon:'(t)', sub:'(x(t), y(t))',
    vars:['t'], placeholder:'cos(t), sin(t)',
    hint:'逗号分隔两个式子，共用一个参数字母',
  },
  point: {
    key:'point', label:'点', icon:'·', sub:'(a, b)',
    vars:null, placeholder:'1, 2',
    hint:'一对坐标',
  },
  poly: {
    key:'poly', label:'多边形', icon:'▱', sub:'A-B-C…',
    vars:null, placeholder:'',
    hint:'由已有的点连成，拖顶点会跟着变',
  },
  text: {
    key:'text', label:'注释', icon:'T', sub:'文字 + 坐标',
    vars:null, placeholder:'写点什么…',
    hint:'用坐标记住位置，可以改颜色和字体；跟着 JSON 一起存档',
  },
};

/* ── 轻量公式排版（可选）：^ 上标 · _ 下标 · \frac{}{} · \sqrt{} · 常用符号 ──
   不引任何外部库（站点禁止 CDN）；只认这些标记，其余原样当文字画。 */
const TEX_SYMBOLS = {
  '\\times':'×', '\\cdot':'·', '\\div':'÷', '\\pm':'±', '\\mp':'∓',
  '\\pi':'π', '\\theta':'θ', '\\alpha':'α', '\\beta':'β', '\\gamma':'γ', '\\delta':'δ',
  '\\lambda':'λ', '\\mu':'μ', '\\sigma':'σ', '\\phi':'φ', '\\omega':'ω', '\\rho':'ρ',
  '\\infty':'∞', '\\le':'≤', '\\leq':'≤', '\\ge':'≥', '\\geq':'≥', '\\ne':'≠', '\\neq':'≠',
  '\\approx':'≈', '\\equiv':'≡', '\\to':'→', '\\rightarrow':'→', '\\Rightarrow':'⇒',
  '\\sum':'∑', '\\prod':'∏', '\\int':'∫', '\\in':'∈', '\\notin':'∉', '\\subset':'⊂',
  '\\cup':'∪', '\\cap':'∩', '\\angle':'∠', '\\perp':'⊥', '\\parallel':'∥', '\\degree':'°',
};

function hasTexMark(s){
  return /[\^_]|\\[a-zA-Z]+/.test(String(s || ''));
}

/* 拆成 [{t:'base'|'sup'|'sub', s} | {t:'frac', a, b} | {t:'sqrt', s}] */
function texParse(src){
  const out = [];
  let buf = '';
  const push = () => { if (buf){ out.push({ t:'base', s: buf }); buf = ''; } };
  const readGroup = (s, i) => {                     /* 读 {…} 或单个字符，返回 [内容, 新位置] */
    if (s[i] === '{'){
      let depth = 0, j = i;
      for (; j < s.length; j++){
        if (s[j] === '{') depth++;
        else if (s[j] === '}'){ depth--; if (!depth) break; }
      }
      return [s.slice(i + 1, j), j + 1];
    }
    return [s[i] || '', i + 1];
  };
  for (let i = 0; i < src.length; i++){
    const c = src[i];
    if (c === '\\'){
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (m && TEX_SYMBOLS['\\' + m[1]]){
        buf += TEX_SYMBOLS['\\' + m[1]];
        i += m[0].length - 1;
        continue;
      }
      if (m && m[1] === 'frac'){
        const [a, i2] = readGroup(src, i + m[0].length);
        const [b, i3] = readGroup(src, i2);
        push(); out.push({ t:'frac', a, b }); i = i3 - 1; continue;
      }
      if (m && m[1] === 'sqrt'){
        const [a, i2] = readGroup(src, i + m[0].length);
        push(); out.push({ t:'sqrt', s: a }); i = i2 - 1; continue;
      }
      buf += c; continue;
    }
    if (c === '^' || c === '_'){
      const [g, i2] = readGroup(src, i + 1);
      if (!g) continue;
      push();
      out.push({ t: c === '^' ? 'sup' : 'sub', s: g });
      i = i2 - 1;
      continue;
    }
    buf += c;
  }
  push();
  return out;
}

/* 一行（可能带上下标/分式/根号）的宽度 */
function texMeasure(runs, size){
  let w = 0, maxW = 0;
  for (const r of runs){
    if (r.t === 'base')   w += ctx.measureText(r.s).width;
    else if (r.t === 'sup' || r.t === 'sub'){
      ctx.save(); ctx.font = ctx.font.replace(/(\d+(?:\.\d+)?)px/, (size * 0.7).toFixed(1) + 'px');
      w += ctx.measureText(r.s).width; ctx.restore();
    }
    else if (r.t === 'frac'){
      const a = ctx.measureText(r.a).width, b = ctx.measureText(r.b).width;
      w += Math.max(a, b) + 6;
    }
    else if (r.t === 'sqrt'){ w += ctx.measureText(r.s).width + size * 0.75; }
    maxW = Math.max(maxW, w);
  }
  return maxW;
}

/* 画一行，返回宽度。y 是基线 */
function texDraw(runs, x, y, size, color){
  const small = size * 0.7;
  let cx = x;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  for (const r of runs){
    if (r.t === 'base'){
      ctx.fillText(r.s, cx, y);
      cx += ctx.measureText(r.s).width;
    } else if (r.t === 'sup' || r.t === 'sub'){
      const dy = r.t === 'sup' ? -size * 0.42 : size * 0.26;
      ctx.save();
      ctx.font = ctx.font.replace(/(\d+(?:\.\d+)?)px/, small.toFixed(1) + 'px');
      ctx.fillText(r.s, cx, y + dy);
      cx += ctx.measureText(r.s).width;
      ctx.restore();
    } else if (r.t === 'frac'){
      const a = ctx.measureText(r.a).width, b = ctx.measureText(r.b).width;
      const w = Math.max(a, b) + 6;
      ctx.save();
      ctx.font = ctx.font.replace(/(\d+(?:\.\d+)?)px/, small.toFixed(1) + 'px');
      ctx.fillText(r.a, cx + (w - a) / 2, y - size * 0.16);
      ctx.fillText(r.b, cx + (w - b) / 2, y + size * 0.62);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.06);
      ctx.beginPath();
      ctx.moveTo(cx + 2, y + size * 0.08);
      ctx.lineTo(cx + w - 2, y + size * 0.08);
      ctx.stroke();
      ctx.restore();
      cx += w;
    } else if (r.t === 'sqrt'){
      const w = ctx.measureText(r.s).width;
      const h = size * 0.62;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.07);
      ctx.beginPath();
      ctx.moveTo(cx, y - h * 0.45);
      ctx.lineTo(cx + size * 0.22, y + 1);
      ctx.lineTo(cx + size * 0.46, y - h);
      ctx.lineTo(cx + size * 0.72 + w, y - h);
      ctx.stroke();
      ctx.restore();
      ctx.fillText(r.s, cx + size * 0.5, y);
      cx += w + size * 0.75;
    }
  }
  return cx - x;
}

/* 一行文字要占多宽：开了排版且这行有标记就走排版 */
function lineWidth(str, size){
  const s = String(str == null ? '' : str);
  if (state.settings.texRender !== false && hasTexMark(s)){
    const runs = texParse(s);
    return texMeasure(runs, size);
  }
  return ctx.measureText(s || ' ').width;
}

/* 注释的字体：族 + 字号 + 粗斜体 */
const TEXT_FONTS = {
  sans:  { name:'无衬线', css:'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif' },
  serif: { name:'衬线',   css:'Georgia, "Songti SC", "SimSun", serif' },
  mono:  { name:'等宽',   css:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
};
const TEXT_DEFAULT = { size:15, family:'sans', bold:false, italic:false };

function textFontCss(font){
  const f = Object.assign({}, TEXT_DEFAULT, font || {});
  const fam = (TEXT_FONTS[f.family] || TEXT_FONTS.sans).css;
  const size = Math.min(96, Math.max(8, Number(f.size) || TEXT_DEFAULT.size));
  return (f.italic ? 'italic ' : '') + (f.bold ? '700 ' : '400 ') + size + 'px ' + fam;
}
/* 屏幕上的外框：hitTest / 拖动 / 选中框都用它 */
function textBox(f){
  const font = textFontCss(f.font);
  ctx.save();
  ctx.font = font;
  const size = Math.min(96, Math.max(8, Number((f.font || {}).size) || TEXT_DEFAULT.size));
  const lines = String(f.expr || '').split('\n');
  let w = 0;
  for (const ln of lines) w = Math.max(w, lineWidth(ln || ' ', size));
  ctx.restore();
  const pad = 5;
  const x = w2sX(f.x), y = w2sY(f.y);
  return {
    x, y, w: w + pad * 2, h: lines.length * size * 1.25 + pad * 2,
    lines, font, size, left: x - pad, top: y - size - pad,
  };
}

function drawTextObj(f){
  const box = textBox(f);
  if (box.x < -box.w - 40 || box.x > W + 40 || box.y < -40 || box.y > H + box.h + 40) return;
  ctx.save();
  ctx.font = box.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = box.lines;
  const lh = Math.min(96, Math.max(8, Number((f.font || {}).size) || TEXT_DEFAULT.size)) * 1.25;
  /* 底色，保证压在曲线上也看得清 */
  ctx.globalAlpha = 0.82 * (f.alpha == null ? 1 : f.alpha);
  ctx.fillStyle = CV.chip;
  ctx.beginPath();
  const rr = 6;
  const bx = box.left, by = box.top, bw = box.w, bh = box.h;
  ctx.moveTo(bx + rr, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
  ctx.arcTo(bx, by + bh, bx, by, rr);
  ctx.arcTo(bx, by, bx + bw, by, rr);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = f.alpha == null ? 1 : f.alpha;
  lines.forEach((ln, i) => {
    const yy = box.y + i * lh;
    if (state.settings.texRender !== false && hasTexMark(ln)) texDraw(texParse(ln), box.x, yy, box.size, f.color);
    else { ctx.fillStyle = f.color; ctx.fillText(ln, box.x, yy); }
  });
  ctx.restore();

  /* 选中框也是界面，导出时不画 */
  if (!renderOverride && f.id === selectedId){
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = .75;
    ctx.strokeStyle = CV.ink;
    ctx.strokeRect(box.left, box.top, box.w, box.h);
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════
   4. 状态
   ═══════════════════════════════════════════════════ */

const PALETTE = ['#D97757','#E1FCAD','#7EC8C8','#C9A84C','#C5B8D4','#A8B89A'];
const PEN_COLORS = ['#E1FCAD','#D97757','#7EC8C8','#C9A84C','#C5B8D4','#E7E9E6'];
const PT_COLORS = ['#E1FCAD','#D97757','#7EC8C8','#C9A84C','#C5B8D4','#E7E9E6'];

const COLOR_POOL = [
  '#D97757','#E1FCAD','#7EC8C8','#C9A84C','#C5B8D4','#A8B89A',
  '#E8A87C','#8DA9C4','#B5C99A','#D4A5A5','#9B9ECE','#7EB09B',
  '#E0C097','#A3B5C9','#C9A5B0','#8FBC8F','#B0A8C8','#D9C5A0',
];

const PALETTE_PRESETS = [
  { key:'claude', name:'暖调',  colors:['#D97757','#E1FCAD','#7EC8C8','#C9A84C','#C5B8D4','#A8B89A'] },
  { key:'earth',  name:'陶土',  colors:['#D97757','#C9A84C','#A0522D','#8D6959','#E0C097','#A8B89A'] },
  { key:'forest', name:'苔原',  colors:['#A8B89A','#6B7D5A','#E1FCAD','#C9A84C','#7EB09B','#8DA9C4'] },
  { key:'ocean',  name:'海盐',  colors:['#539DB6','#7EC8C8','#8DA9C4','#A3B5C9','#9B9ECE','#E1FCAD'] },
  { key:'dusk',   name:'暮色',  colors:['#C5B8D4','#9B9ECE','#A3B5C9','#D4A5A5','#C9A5B0','#E8A87C'] },
  { key:'mono',   name:'素墨',  colors:['#E7E9E6','#B0B8BC','#7E8A90','#9CA8AE','#D0D5D7','#566168'] },
];

/* 触屏设备默认打开双指手势；桌面端可以在设置里手动开 */
const isTouchDevice = (navigator.maxTouchPoints || 0) > 0 ||
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

const state = {
  funcs: [],
  view: { cx:0, cy:0, scale:56 },
  settings: {
    snap:false, snapStep:0.5, alignMode:'grid', showGrid:true, showTicks:true,
    axisX:'x', axisY:'y', gestures:isTouchDevice, autoInter:true, texRender:true,
  },
  pointTable: {
    color: PT_COLORS[0],
    visible: true,
    points: [],
  },
};

const pen = {
  active:false, color:PEN_COLORS[0], size:2.5,
  pending:null, cursor:null,
};

let uid = 0;

/* 对象名：函数 f/g/h…，点 A/B/C…（GeoGebra 那套习惯） */
function nextLabel(typeKey){
  const isPoint = typeKey === 'point';
  const used = new Set(state.funcs.filter(f => (f.type === 'point') === isPoint).map(f => f.label));
  const pool = isPoint ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'fghjkmnpqrstuvwxyz';
  for (const c of pool) if (!used.has(c)) return c;
  return (isPoint ? 'P' : 'f') + (used.size + 1);
}

/* 行首显示的对象名：表达式自己写了左边就不重复显示 */
function labelText(f){
  const e = String(f.expr || '').trim();
  const hasLHS = /^[A-Za-z]\s*=(?!=)/.test(e) || /^[A-Za-z]\s*\(/.test(e);
  if (f.type === 'point') return f.label || 'A';
  if (f.type === 'poly') return '';
  if (f.type === 'text') return 'T:';
  if (hasLHS) return '';
  const name = f.label || '';
  if (!name) return '';
  if (f.type === 'y') return f.vertical ? name + ':' : name + '(x) =';
  if (f.type === 'parametric') return name + '(t) =';
  return name + ':';
}

/* 多边形的顶点串：A → B → C */
function polyVerticesText(f){
  return (f.pts || []).map(id => {
    const o = findObj(id);
    return o ? (o.label || '?') : '?';
  }).join(' → ');
}

function makeFunc(typeKey, expr, source){
  return {
    id: ++uid,
    label: nextLabel(typeKey),
    type: typeKey,
    expr: expr,
    color: PALETTE[state.funcs.length % PALETTE.length],
    width: 2,
    visible: true,
    alpha: 1,
    source: source || 'manual',
    fn: null,
    error: null,
    vertical: false,
    _from: 1, _start: 0, _dur: 180,
  };
}

/* 只认单个字母当变量：按出现顺序扫出表达式里的自由变量 */
function freeLetters(src){
  const s = String(src == null ? '' : src);
  const out = [];
  const re = /[A-Za-z_][A-Za-z_0-9]*/g;
  let m;
  while ((m = re.exec(s))){
    const name = m[0];
    if (/^\s*\(/.test(s.slice(re.lastIndex))) continue;  /* 后面跟括号 → 函数名 */
    if (name.length !== 1) continue;                     /* 变量只允许单个字母 */
    if (name in CONSTS) continue;                        /* e / E 这些是常量 */
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/* 单字母的「左边 = 右边」，比如 x=0、a=54b+cos(b)；f(x)=… 不算 */
function splitLHS(expr){
  const m = String(expr).trim().match(/^([A-Za-z])\s*=(?!=)\s*([\s\S]+)$/);
  return m ? { lhs: m[1], rhs: m[2].trim() } : null;
}

function recompile(f){
  f.fn = null; f.error = null; f.vertical = false; f.vars = [];
  const t = TYPES[f.type];
  if (!t){ f.error = '未知类型'; return; }
  /* 注释不解析：内容是纯文字 */
  if (f.type === 'text'){ f.fn = null; f.error = null; return; }
  /* 多边形没有表达式：顶点是点对象的引用，画的时候现取 */
  if (f.type === 'poly'){
    f.fn = null;
    f.pts = Array.isArray(f.pts) ? f.pts : [];
    if (f.pts.length < 3) f.error = '至少要有 3 个顶点';
    return;
  }
  if (!f.expr || !f.expr.trim()){ f.error = '空的'; return; }

  try {
    if (f.type === 'parametric'){
      /* GeoGebra 的 Curve(x(t), y(t), t, 起点, 终点)；也认裸的 "x(t), y(t)" */
      const src = f.expr.trim();
      let parts = splitTopLevel(src);
      let t0 = 0, t1 = Math.PI * 2, hasRange = false, paramName = null;
      const cm = src.match(/^Curve\s*\(([\s\S]*)\)$/i);
      if (cm){
        const cp = splitTopLevel(cm[1]);
        if (cp.length === 5){
          parts = [cp[0], cp[1]];
          paramName = cp[2].trim();
          t0 = compile(cp[3], [])();
          t1 = compile(cp[4], [])();
          hasRange = true;
          if (!isFinite(t0) || !isFinite(t1))
            throw new Error('Curve 的起点 / 终点要是常数（可以用 pi）');
        } else if (cp.length === 3){
          parts = [cp[0], cp[1]];
          paramName = cp[2].trim();
        } else {
          throw new Error('Curve 要写成 Curve(x(t), y(t), t, 起点, 终点)');
        }
      }
      if (parts.length !== 2)
        throw new Error('参数方程要写成 "x(t), y(t)" 两个式子');
      const used = [];
      if (paramName){
        if (paramName.length !== 1) throw new Error('参数只允许单个字母');
        used.push(paramName);
      }
      for (const p of parts){
        for (const l of freeLetters(p)) if (!used.includes(l)) used.push(l);
      }
      f.vars = [used[0] || 't'];
      f.t0 = t0; f.t1 = t1; f.hasRange = hasRange;
      f.fn = [
        compile(parts[0], f.vars),
        compile(parts[1], f.vars),
      ];
    } else if (f.type === 'point'){
      const parts = splitTopLevel(f.expr.replace(/^\(|\)$/g, ''));
      if (parts.length !== 2) throw new Error('点要写成 "a, b"');
      const ax = compile(parts[0], []), ay = compile(parts[1], []);
      f.fn = () => [ax(), ay()];
    } else if (f.type === 'implicit'){
      /* f(x,y)=0：两个未知数字母从式子里自己认，u^2+v^2-4 照样画 */
      const sp = splitLHS(f.expr);
      const body = sp ? sp.rhs : f.expr;
      const ls = freeLetters(body);
      const v1 = ls[0] || 'x';
      const v2 = ls[1] || (v1 === 'y' ? 'x' : 'y');
      f.vars = [v1, v2];
      f.fn = compile(body, f.vars);
    } else if (f.type === 'polar'){
      /* r = f(角度)：默认 t，换成别的字母也行 */
      const sp = splitLHS(f.expr);
      const body = sp ? sp.rhs : f.expr;
      f.vars = [freeLetters(body)[0] || 't'];
      f.fn = compile(body, f.vars);
    } else {
      /* 函数：y = f(x)；左边换成别的单个字母就当纵轴，自变量取右边第一个字母 */
      const sp = splitLHS(f.expr);
      if (sp && sp.lhs === 'x'){
        /* x = … 不是函数，是一条竖直线（或以竖直轴为自变量的曲线） */
        f.vars = [freeLetters(sp.rhs)[0] || 'y'];
        f.vertical = true;
        f.fn = compile(sp.rhs, f.vars);
      } else {
        const body = sp ? sp.rhs : f.expr;
        f.vars = [freeLetters(body)[0] || 'x'];
        f.fn = compile(body, f.vars);
      }
    }
  } catch(e){ f.fn = null; f.error = e.message; }
}

function addFunc(typeKey, expr, source, colorIdx){
  const f = makeFunc(typeKey, expr, source);
  if (colorIdx != null) f.color = PALETTE[colorIdx % PALETTE.length];
  recompile(f);
  state.funcs.push(f);
  return f;
}

/* 不预置任何曲线和点，只留一个空行等着写 */
addFunc('y', '', 'manual', 0);

/* ═══════════════════════════════════════════════════
   5. DOM 引用
   ═══════════════════════════════════════════════════ */

const stage    = document.getElementById('stage');
const canvas   = document.getElementById('cv');
/* let 而不是 const：导出图片时会临时把 ctx 换成离屏画布的 2d（见 renderShotCanvas） */
let ctx        = canvas.getContext('2d');
const fnList   = document.getElementById('fnList');
const hudX     = document.getElementById('hudX');
const hudY     = document.getElementById('hudY');
const legendEl = document.getElementById('legend');
const penBadge = document.getElementById('penBadge');
const penBadgeText = document.getElementById('penBadgeText');
const penToggle= document.getElementById('penToggle');
const penToggleText = document.getElementById('penToggleText');
const penColors= document.getElementById('penColors');
const penSize  = document.getElementById('penSize');
const typeMenu = document.getElementById('typeMenu');
const toastEl  = document.getElementById('toast');

const ptBody   = document.getElementById('ptBody');
const ptColorBtn = document.getElementById('ptColor');

const settingsModal = document.getElementById('settingsModal');
const settingsBtn   = document.getElementById('settingsBtn');
const settingsClose = document.getElementById('settingsClose');
const resetViewBtn  = document.getElementById('resetViewBtn');
const axisLabelX    = document.getElementById('axisLabelX');
const axisLabelY    = document.getElementById('axisLabelY');

const ICON_EYE_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>`;
const ICON_EYE_OFF= `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16"/><path d="M9.6 5.7A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4"/><path d="M6.5 7.7A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.9 9.9 0 0 0 4-.8"/><path d="M10.2 10.3a2.6 2.6 0 0 0 3.6 3.6"/></svg>`;
const ICON_X      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ═══════════════════════════════════════════════════
   5b. 主题：瑞士国际主义 · 亮（默认）/ 暗 / 绿
   ═══════════════════════════════════════════════════ */

const THEMES = ['swiss-light','swiss-dark','swiss-green'];
const THEME_NAMES = { 'swiss-light':'亮色', 'swiss-dark':'暗色', 'swiss-green':'绿色' };

/* 画布颜色也从 CSS 令牌读 —— 令牌是唯一来源 */
const CANVAS_VARS = {
  bg1:'--plot-bg-1', bg2:'--plot-bg-2', bg3:'--plot-bg-3',
  grid1:'--plot-grid-1', grid2:'--plot-grid-2', axis:'--plot-axis',
  cross:'--plot-cross', tick:'--plot-tick', ink:'--plot-ink', chip:'--plot-chip',
};
const CANVAS_FALLBACK = {
  bg1:'#FFFFFF', bg2:'#F6F6F3', bg3:'#EFEFEB',
  grid1:'rgba(10,10,10,.055)', grid2:'rgba(10,10,10,.11)',
  axis:'rgba(10,10,10,.55)', cross:'rgba(10,10,10,.22)',
  tick:'#737373', ink:'#5A5A5A', chip:'rgba(255,255,255,.92)',
};

function readCanvasTheme(){
  const out = {};
  let cs = null;
  try { cs = getComputedStyle(document.documentElement); } catch(e){}
  for (const k in CANVAS_FALLBACK){
    const v = cs ? String(cs.getPropertyValue(CANVAS_VARS[k]) || '').trim() : '';
    out[k] = v || CANVAS_FALLBACK[k];
  }
  return out;
}
let CV = readCanvasTheme();

/* 曲线配色也跟着主题走：亮底用深色系，暗底用柔和色 */
const THEME_PALETTE = {
  'swiss-light': ['#002FA7','#0A0A0A','#737373','#C2410C','#0F6E6E','#5A6B2F'],
  'swiss-dark':  ['#F97316','#7EC8C8','#E1FCAD','#C9A84C','#C5B8D4','#A8B89A'],
  'swiss-green': ['#2D6A4F','#0A0A0A','#6B7A63','#1B4332','#A3B18A','#4F5F49'],
};
let curvePalette = PALETTE.slice();

function currentTheme(){
  const t = document.documentElement.getAttribute('data-theme');
  return THEMES.includes(t) ? t : 'swiss-light';
}

/* 换主题时按位置把已有曲线 / 画笔 / 点的颜色映射过去，否则亮底上看不见 */
function applyCurvePalette(name){
  const next = (THEME_PALETTE[name] || THEME_PALETTE['swiss-light']).slice();
  const prev = curvePalette.slice();
  const at = c => prev.indexOf(c);

  for (const f of state.funcs){
    const i = at(f.color);
    if (i >= 0) f.color = next[i % next.length];
  }
  if (at(pen.color) >= 0) pen.color = next[at(pen.color) % next.length];
  if (at(state.pointTable.color) >= 0)
    state.pointTable.color = next[at(state.pointTable.color) % next.length];

  curvePalette = next;
  for (const list of [PALETTE, PEN_COLORS, PT_COLORS]){
    list.length = 0;
    for (const c of next) list.push(c);
  }
}

/* 系统偏好 → 主题名（取不到系统偏好时退回暗色） */
function systemThemeName(){
  try {
    if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) return 'swiss-dark';
    if (window.matchMedia) return 'swiss-light';
  } catch(e){}
  return 'swiss-dark';
}
function savedTheme(){
  try {
    const v = localStorage.getItem('plot-theme');
    return THEMES.includes(v) ? v : null;
  } catch(e){ return null; }
}

/* setTheme(名字, silent, noSave)
   noSave=true 表示「这次不是用户的手动选择」——不写 localStorage，
   这样下次打开仍然跟着系统走（否则第一次访问就把主题焊死了）。 */
function setTheme(name, silent, noSave){
  if (name === 'auto'){                      /* 跟随系统：把手动选择清掉 */
    try { localStorage.removeItem('plot-theme'); } catch(e){}
    name = systemThemeName();
    noSave = true;
    silent = true;
  }
  if (!THEMES.includes(name)) name = 'swiss-light';
  document.documentElement.setAttribute('data-theme', name);
  if (!noSave){
    try { localStorage.setItem('plot-theme', name); } catch(e){}
  }

  CV = readCanvasTheme();
  applyCurvePalette(name);
  renderPenColors();
  renderList();
  renderPointTable();
  syncThemeUI();
  requestRender();
  updateHUD();
  if (!silent) toast('主题：' + (noSave ? '跟随系统 · ' : '') + (THEME_NAMES[name] || name));
}

function syncThemeUI(){
  const seg = document.getElementById('themeSeg');
  if (!seg) return;
  const cur = currentTheme();
  const isAuto = !savedTheme();
  seg.querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.theme === 'auto' ? isAuto : (!isAuto && b.dataset.theme === cur);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
}

(function bindThemeSeg(){
  const seg = document.getElementById('themeSeg');
  if (!seg) return;
  seg.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('.seg-btn') : null;
    if (b) setTheme(b.dataset.theme);
  });
  seg.addEventListener('keydown', e => {
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    e.preventDefault();
    const list = THEMES.concat(['auto']);
    const i = list.indexOf(savedTheme() ? currentTheme() : 'auto');
    const n = (i + (k === 'ArrowRight' ? 1 : list.length - 1)) % list.length;
    setTheme(list[n]);
    const btn = seg.querySelector('.seg-btn[data-theme="' + list[n] + '"]');
    if (btn) btn.focus();
  });
})();

/* 系统主题变了、而用户没手动选过 → 跟着换（画布颜色也要跟着重读） */
try {
  if (window.matchMedia){
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (!savedTheme()) setTheme(systemThemeName(), true, true); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
} catch(e){}

let toastTimer = null;
function toast(msg, kind){
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', kind === 'error');
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ═══════════════════════════════════════════════════
   6. 表达式列表
   ═══════════════════════════════════════════════════ */

function renderList(newId){
  fnList.innerHTML = '';
  state.funcs.forEach(f => {
    const slot = document.createElement('div');
    slot.className = 'fn-slot';

    const t = TYPES[f.type];
    const row = document.createElement('div');
    row.className = 'fn-row'
      + (f.error && f.expr.trim() ? ' error' : '')
      + (f.id === newId ? ' is-new' : '')
      + (f.id === selectedId ? ' sel' : '')
      + (f.source === 'pen' ? ' pen-made' : '');
    row.dataset.id = f.id;
    row.addEventListener('click', e => {
      if (e.target && e.target.closest && e.target.closest('input,button,select')) return;
      /* 构造工具开着的时候，点一行就是「选它」 */
      if (construct){ constructPick({ id: f.id }); return; }
      selectObject(f.id);
    });
    row.title = (f.error && f.expr.trim()) ? f.error
      : (f.vars && f.vars.length ? '自变量：' + f.vars.join('、') : '');

    const isPoly = f.type === 'poly';
    row.innerHTML = `
      <button class="type-badge" title="${esc(t.label)} · ${esc(t.sub)}"
              aria-label="切换图形类型">${esc(t.icon)}</button>
      <button class="swatch" style="--c:${f.color}" title="换个颜色" aria-label="切换颜色"></button>
      ${isPoly
        ? `<span class="fn-static" title="顶点是点对象，拖它们就能改形状">${esc(polyVerticesText(f))}</span>`
        : `<span class="fn-label">${esc(labelText(f))}</span>
           <input class="fn-input" spellcheck="false" autocomplete="off"
                  value="${esc(f.expr)}" placeholder="${esc(t.placeholder)}"
                  aria-label="表达式">`}
      <button class="icon-btn vis ${f.visible ? '' : 'off'}"
              title="${f.visible ? '藏起来' : '显示出来'}"
              aria-label="${f.visible ? '隐藏' : '显示'}"
              aria-pressed="${f.visible}">
        ${f.visible ? ICON_EYE_ON : ICON_EYE_OFF}
      </button>
      <button class="icon-btn del" title="删掉" aria-label="删除">${ICON_X}</button>
    `;

    const badge  = row.querySelector('.type-badge');
    const input  = row.querySelector('.fn-input');
    const swatch = row.querySelector('.swatch');
    const visBtn = row.querySelector('.vis');
    const delBtn = row.querySelector('.del');

    badge.addEventListener('click', e => {
      e.stopPropagation();
      openTypeMenu(badge, f);
    });

    if (input) input.addEventListener('input', e => {
      f.expr = e.target.value;
      recompile(f);
      const lab = row.querySelector('.fn-label');
      if (lab) lab.textContent = labelText(f);
      const bad = !!f.error && f.expr.trim() !== '';
      row.classList.toggle('error', bad);
      row.title = bad ? f.error
        : (f.vars && f.vars.length ? '自变量：' + f.vars.join('、') : '');
      requestRender();
      updateHUD();
    });

    swatch.addEventListener('click', () => {
      const i = PALETTE.indexOf(f.color);
      f.color = PALETTE[(i + 1 + PALETTE.length) % PALETTE.length];
      swatch.style.setProperty('--c', f.color);
      requestRender();
      updateHUD();
    });

    visBtn.addEventListener('click', () => {
      const nv = !f.visible;
      if (prefersReduced.matches){
        f.alpha = nv ? 1 : 0;
      } else {
        f._from = f.alpha;
        f._start = performance.now();
        f._dur = 180;
        ensureAnim();
      }
      f.visible = nv;
      visBtn.classList.toggle('off', !f.visible);
      visBtn.innerHTML = f.visible ? ICON_EYE_ON : ICON_EYE_OFF;
      visBtn.setAttribute('aria-pressed', String(f.visible));
      requestRender();
      updateHUD();
    });

    delBtn.addEventListener('click', () => {
      const finish = () => { deleteObject(f.id); };
      if (prefersReduced.matches){ finish(); return; }
      slot.classList.add('closing');
      let done = false;
      const once = () => { if (done) return; done = true; finish(); };
      slot.addEventListener('transitionend', e => {
        if (e.propertyName === 'grid-template-rows') once();
      });
      setTimeout(once, 340);
    });

    slot.appendChild(row);
    fnList.appendChild(slot);
  });
  refreshDerived();
  renderValueTable();
}
renderList();

document.getElementById('addBtn').addEventListener('click', () => {
  const f = addFunc('y', '', 'manual');
  if (prefersReduced.matches) f.alpha = 1;
  renderList(f.id);
  const inputs = fnList.querySelectorAll('.fn-input');
  inputs[inputs.length - 1].focus();
  requestRender();
});

/* ── 类型菜单 ── */
let menuTarget = null;

function openTypeMenu(anchor, f){
  menuTarget = f;
  typeMenu.innerHTML = Object.values(TYPES).map(t => `
    <div class="type-item ${t.key === f.type ? 'on' : ''}" data-type="${t.key}">
      <div class="type-item-icon">${esc(t.icon)}</div>
      <div>${esc(t.label)}</div>
      <div class="type-item-sub">${esc(t.sub)}</div>
    </div>
  `).join('');

  typeMenu.querySelectorAll('.type-item').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.type;
      if (k !== f.type){
        f.type = k;
        recompile(f);
        renderList();
        requestRender();
        updateHUD();
        toast('切换为「' + TYPES[k].label + '」');
      }
      closeTypeMenu();
    });
  });

  const r = anchor.getBoundingClientRect();
  typeMenu.style.left = Math.min(r.left, innerWidth - 200) + 'px';
  typeMenu.style.top = (r.bottom + 6) + 'px';
  typeMenu.classList.add('show');
}

function closeTypeMenu(){
  typeMenu.classList.remove('show');
  menuTarget = null;
}

document.addEventListener('click', e => {
  if (!typeMenu.contains(e.target)) closeTypeMenu();
});

/* ── 快捷示例 ── */
const CHIPS = [
  { type:'y',          expr:'sin(x)/x' },
  { type:'y',          expr:'e^(-x^2)' },
  { type:'y',          expr:'x=0' },
  { type:'y',          expr:'y=0' },
  { type:'implicit',   expr:'x^2+y^2-4' },
  { type:'implicit',   expr:'x^2/9+y^2/4-1' },
  { type:'polar',      expr:'1+cos(t)' },
  { type:'parametric', expr:'cos(t), sin(t)' },
  { type:'point',      expr:'1, 1' },
];
const chipsEl = document.getElementById('chips');
CHIPS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = c.expr;
  b.title = TYPES[c.type].label;
  b.addEventListener('click', () => {
    const empty = state.funcs.find(f => f.expr.trim() === '');
    if (empty){
      empty.type = c.type;
      empty.expr = c.expr;
      recompile(empty);
      renderList();
    } else {
      const f = addFunc(c.type, c.expr, 'manual');
      f.alpha = 1;
      renderList(f.id);
    }
    requestRender();
    updateHUD();
  });
  chipsEl.appendChild(b);
});

/* ═══════════════════════════════════════════════════
   7. 点表格
   ═══════════════════════════════════════════════════ */

function syncPtColorUI(){
  ptColorBtn.style.setProperty('--c', state.pointTable.color);
}

function renderPointTable(){
  const t = state.pointTable;

  if (t.points.length === 0){
    ptBody.innerHTML = `<tr><td colspan="4" class="pt-empty">还没有点，点「+ 一行」加一个</td></tr>`;
  } else {
    ptBody.innerHTML = t.points.map((p, i) => `
      <tr>
        <td class="pt-idx">${i+1}</td>
        <td><input type="number" step="any" inputmode="decimal"
                   value="${Number.isFinite(p.x) ? p.x : ''}"
                   data-i="${i}" data-k="x" aria-label="第 ${i+1} 行 x"></td>
        <td><input type="number" step="any" inputmode="decimal"
                   value="${Number.isFinite(p.y) ? p.y : ''}"
                   data-i="${i}" data-k="y" aria-label="第 ${i+1} 行 y"></td>
        <td><button class="pt-del" data-i="${i}" aria-label="删除第 ${i+1} 行">×</button></td>
      </tr>
    `).join('');
  }

  ptBody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = +e.target.dataset.i;
      const k = e.target.dataset.k;
      const v = parseFloat(e.target.value);
      state.pointTable.points[i][k] = isFinite(v) ? v : null;
      requestRender();
      updateHUD();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter'){
        e.preventDefault();
        const all = Array.from(ptBody.querySelectorAll('input'));
        const idx = all.indexOf(e.target);
        if (idx === all.length - 1){
          addPointRow();
        } else if (idx >= 0 && idx < all.length - 1){
          all[idx + 1].focus();
          all[idx + 1].select();
        }
      }
    });
  });

  ptBody.querySelectorAll('.pt-del').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.target.dataset.i;
      state.pointTable.points.splice(i, 1);
      renderPointTable();
      requestRender();
      updateHUD();
    });
  });

  syncPtColorUI();
}

function addPointRow(){
  state.pointTable.points.push({ x: null, y: null });
  renderPointTable();
  const rows = ptBody.querySelectorAll('tr');
  const last = rows[rows.length - 1];
  const inp = last && last.querySelector('input');
  if (inp) inp.focus();
  requestRender();
}

document.getElementById('ptAdd').addEventListener('click', addPointRow);

document.getElementById('ptClear').addEventListener('click', () => {
  if (state.pointTable.points.length === 0){
    toast('表格已经是空的');
    return;
  }
  const n = state.pointTable.points.length;
  state.pointTable.points = [];
  renderPointTable();
  requestRender();
  updateHUD();
  toast('已清空 ' + n + ' 个点');
});

ptColorBtn.addEventListener('click', () => {
  const i = PT_COLORS.indexOf(state.pointTable.color);
  state.pointTable.color = PT_COLORS[(i + 1) % PT_COLORS.length];
  syncPtColorUI();
  requestRender();
});

renderPointTable();

/* ═══════════════════════════════════════════════════
   8. 画笔 UI
   ═══════════════════════════════════════════════════ */

function renderPenColors(){
  penColors.innerHTML = '';
  PEN_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    const on = c === pen.color || (i === 0 && !PEN_COLORS.includes(pen.color));
    b.className = 'pen-color' + (on ? ' on' : '');
    b.style.setProperty('--c', c);
    b.dataset.color = c;
    b.title = c;
    b.setAttribute('aria-label', '画笔颜色 ' + c);
    b.addEventListener('click', () => {
      pen.color = c;
      penColors.querySelectorAll('.pen-color').forEach(el =>
        el.classList.toggle('on', el.dataset.color === c));
    });
    penColors.appendChild(b);
  });
}
renderPenColors();

penSize.addEventListener('input', e => { pen.size = parseFloat(e.target.value) || 2.5; });

function updatePenBadge(){
  if (!pen.active){ penBadge.classList.remove('show'); return; }
  penBadge.classList.add('show');
  const hint = state.settings.gestures ? ' · 双指轻点撤回' : '';
  penBadgeText.textContent = (pen.pending ? '再点一下确定终点' : '点一下设起点') + hint;
}

function setPenActive(v){
  const wasActive = pen.active;
  pen.active = v;
  pen.pending = null;
  pen.cursor = null;
  penToggle.classList.toggle('on', v);
  penToggle.setAttribute('aria-pressed', String(v));
  penToggleText.textContent = v ? '画笔已开启' : '开启画笔';
  canvas.style.cursor = v ? 'cell' : 'crosshair';

  /* 画笔开启时自动打开网格吸附 */
  if (v && !wasActive && !state.settings.snap){
    state.settings.snap = true;
    syncSettingsUI();
    toast('已自动开启网格吸附');
  }

  updatePenBadge();
  requestRender();
}
penToggle.addEventListener('click', () => setTool(pen.active ? 'move' : 'segment'));

function undoStroke(){
  if (pen.pending){
    pen.pending = null; pen.cursor = null;
    updatePenBadge(); requestRender();
    toast('已取消起点');
    return;
  }
  let idx = -1;
  for (let i = state.funcs.length - 1; i >= 0; i--){
    if (state.funcs[i].source === 'pen'){ idx = i; break; }
  }
  /* 没有画笔内容时退一步：撤回最后一条写了东西的表达式 */
  if (idx < 0 && state.funcs.length > 1){
    for (let i = state.funcs.length - 1; i >= 0; i--){
      if (state.funcs[i].expr.trim()){ idx = i; break; }
    }
  }
  if (idx < 0){ toast('没有可撤回的内容'); return; }
  state.funcs.splice(idx, 1);
  if (state.funcs.length === 0) addFunc('y', '', 'manual', 0);
  renderList(); requestRender(); updateHUD();
  toast('已撤销');
}
document.getElementById('penUndo').addEventListener('click', undoStroke);

document.getElementById('penClear').addEventListener('click', () => {
  const before = state.funcs.length;
  state.funcs = state.funcs.filter(f => f.source !== 'pen');
  const removed = before - state.funcs.length;
  pen.pending = null; pen.cursor = null;
  if (removed === 0){
    toast('还没有画笔生成的内容');
    updatePenBadge(); requestRender();
    return;
  }
  if (state.funcs.length === 0) addFunc('y', '', 'manual', 0);
  renderList(); requestRender(); updateHUD(); updatePenBadge();
  toast('已清空 ' + removed + ' 条');
});

/* ═══════════════════════════════════════════════════
   9. 设置（弹窗）
   ═══════════════════════════════════════════════════ */

function bindSwitch(el, key, onChange){
  const sync = () => {
    el.classList.toggle('on', state.settings[key]);
    el.setAttribute('aria-checked', String(state.settings[key]));
  };
  const toggle = () => {
    state.settings[key] = !state.settings[key];
    sync();
    if (onChange) onChange();
    requestRender();
    updateHUD();
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); toggle(); }
  });
  sync();
}

bindSwitch(document.getElementById('swSnap'), 'snap', syncAlignUI);
bindSwitch(document.getElementById('swGrid'), 'showGrid');
bindSwitch(document.getElementById('swTicks'), 'showTicks');
bindSwitch(document.getElementById('swGestures'), 'gestures', updatePenBadge);
bindSwitch(document.getElementById('swInter'), 'autoInter');
bindSwitch(document.getElementById('swTex'), 'texRender');

/* 对齐方式（网格 / 鼠标指针）+ 步长微调 */
function syncAlignUI(){
  const seg = document.getElementById('alignSeg');
  const on = state.settings.alignMode === 'pointer' ? 'pointer' : 'grid';
  if (seg) seg.querySelectorAll('.seg-btn').forEach(b => {
    const isOn = b.dataset.align === on;
    b.classList.toggle('on', isOn);
    b.setAttribute('aria-checked', String(isOn));
    b.setAttribute('tabindex', isOn ? '0' : '-1');
  });
  const step = document.getElementById('snapStep');
  if (step) step.value = String(state.settings.snapStep);
  const chips = document.getElementById('snapChips');
  if (chips) chips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('on', Math.abs(Number(c.dataset.step) - Number(state.settings.snapStep)) < 1e-9);
  });
  /* 对齐到指针时，步长没意义，淡化掉 */
  const row = document.getElementById('snapStepRow');
  if (row) row.classList.toggle('dim', state.settings.alignMode === 'pointer');
  if (chips) chips.classList.toggle('dim', state.settings.alignMode === 'pointer');
}

function setAlignMode(mode){
  state.settings.alignMode = mode === 'pointer' ? 'pointer' : 'grid';
  syncAlignUI();
  toast(state.settings.alignMode === 'pointer' ? '对齐：鼠标指针（不取整）' : '对齐：网格');
}

function setSnapStep(v){
  const s = Math.max(0.01, Math.min(100, Number(v) || 0.5));
  state.settings.snapStep = Math.round(s * 1000) / 1000;
  syncAlignUI();
}

(function bindAlign(){
  const seg = document.getElementById('alignSeg');
  if (seg){
    seg.addEventListener('click', e => {
      const b = e.target.closest ? e.target.closest('.seg-btn') : null;
      if (b) setAlignMode(b.dataset.align);
    });
    seg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const b = seg.querySelector('.seg-btn[data-align="' + (state.settings.alignMode === 'pointer' ? 'grid' : 'pointer') + '"]');
      setAlignMode(state.settings.alignMode === 'pointer' ? 'grid' : 'pointer');
      if (b) b.focus();
    });
  }
  const step = document.getElementById('snapStep');
  if (step){
    step.addEventListener('input', () => setSnapStep(step.value));
    step.addEventListener('change', () => { setSnapStep(step.value); step.value = String(state.settings.snapStep); });
  }
  const chips = document.getElementById('snapChips');
  if (chips) chips.addEventListener('click', e => {
    const c = e.target.closest ? e.target.closest('.chip') : null;
    if (c) setSnapStep(c.dataset.step);
  });
})();

/* 坐标轴标签：随便写什么字符串，留空就不画 */
function bindAxisLabel(input, key){
  input.addEventListener('input', () => {
    state.settings[key] = input.value.slice(0, 16);
    requestRender();
  });
  input.addEventListener('change', () => {
    input.value = state.settings[key];
  });
}
bindAxisLabel(axisLabelX, 'axisX');
bindAxisLabel(axisLabelY, 'axisY');

const snapStepInput = document.getElementById('snapStep');
snapStepInput.addEventListener('input', () => {
  const v = parseFloat(snapStepInput.value);
  if (isFinite(v) && v > 0) state.settings.snapStep = v;
});
snapStepInput.addEventListener('change', () => {
  if (!isFinite(parseFloat(snapStepInput.value)) || parseFloat(snapStepInput.value) <= 0){
    snapStepInput.value = '0.5';
    state.settings.snapStep = 0.5;
  }
});

function snapPoint(p){
  const S = state.settings;
  if (!S.snap) return p;
  /* 鼠标指针对齐：不取整，精确落在指针位置 */
  if (S.alignMode === 'pointer') return p;
  const s = Number(S.snapStep);
  if (!(s > 0)) return p;
  return { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
}

/* 设置弹窗开关 */
let settingsLastFocus = null;

function openSettings(){
  settingsLastFocus = document.activeElement;
  settingsModal.classList.add('show');
  requestAnimationFrame(() => settingsClose.focus());
}

function closeSettings(){
  if (!settingsModal.classList.contains('show')) return;
  settingsModal.classList.remove('show');
  if (settingsLastFocus && typeof settingsLastFocus.focus === 'function'){
    settingsLastFocus.focus();
  }
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) closeSettings();
});
settingsModal.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const items = settingsModal.querySelectorAll(
    'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

resetViewBtn.addEventListener('click', () => {
  state.view.cx = 0; state.view.cy = 0; state.view.scale = 56;
  requestRender();
  updateHUD();
  toast('视图已重置');
});

/* ═══════════════════════════════════════════════════
   10. 配色方案 + 随机
   ═══════════════════════════════════════════════════ */

const paletteGrid = document.getElementById('paletteGrid');
PALETTE_PRESETS.forEach(p => {
  const el = document.createElement('button');
  el.className = 'palette-item';
  el.title = p.name;
  el.innerHTML = `
    <div class="palette-swatches">
      ${p.colors.slice(0,5).map(c => `<i style="background:${c}"></i>`).join('')}
    </div>
    <div class="palette-name">${esc(p.name)}</div>
  `;
  el.addEventListener('click', () => {
    if (state.funcs.length === 0) return;
    state.funcs.forEach((f, i) => { f.color = p.colors[i % p.colors.length]; });
    renderList(); requestRender(); updateHUD();
    toast('已应用「' + p.name + '」');
  });
  paletteGrid.appendChild(el);
});

document.getElementById('randomColors').addEventListener('click', () => {
  if (state.funcs.length === 0) return;
  const pool = [...COLOR_POOL];
  for (let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.funcs.forEach((f, i) => { f.color = pool[i % pool.length]; });
  renderList(); requestRender(); updateHUD();
  toast('已随机上色');
});

/* ═══════════════════════════════════════════════════
   11. 常用公式面板
   ═══════════════════════════════════════════════════ */

const FORMULAS = [
  {
    id:'distance',
    name:'两点坐标公式',
    sub:'求两点间距离',
    kind:'distance',
    formula:'d = √[ (x₂ − x₁)² + (y₂ − y₁)² ]',
    desc:'把 A、B 两点当作直角三角形的两个顶点，斜边长度就是两点距离。',
    vars:['x1','y1','x2','y2'],
    pairs:[{name:'A 点', x:'x1', y:'y1'}, {name:'B 点', x:'x2', y:'y2'}],
    labels:{ x1:'x₁', y1:'y₁', x2:'x₂', y2:'y₂' },
    default:{ x1:0, y1:0, x2:3, y2:4 },
    examples:[
      { name:'(0,0) → (3,4)',  values:{ x1:0,  y1:0, x2:3, y2:4 } },
      { name:'(−2,1) → (5,3)', values:{ x1:-2, y1:1, x2:5, y2:3 } },
      { name:'水平两点',       values:{ x1:1,  y1:2, x2:7, y2:2 } },
    ],
  },
  {
    id:'midpoint',
    name:'两点中点公式',
    sub:'求线段中点',
    kind:'midpoint',
    formula:'M = ( (x₁ + x₂) / 2 , (y₁ + y₂) / 2 )',
    desc:'横坐标取平均、纵坐标取平均，得到的点就是线段中点。',
    vars:['x1','y1','x2','y2'],
    pairs:[{name:'A 点', x:'x1', y:'y1'}, {name:'B 点', x:'x2', y:'y2'}],
    labels:{ x1:'x₁', y1:'y₁', x2:'x₂', y2:'y₂' },
    default:{ x1:-2, y1:1, x2:6, y2:5 },
    examples:[
      { name:'(0,0) 与 (4,6)',   values:{ x1:0,  y1:0,  x2:4, y2:6 } },
      { name:'(−3,−2) 与 (5,8)', values:{ x1:-3, y1:-2, x2:5, y2:8 } },
    ],
  },
  {
    id:'linear',
    name:'两点求解析式',
    sub:'过两点的一次函数',
    kind:'linear',
    formula:'y = kx + b，k = (y₂ − y₁)/(x₂ − x₁)，b = y₁ − k·x₁',
    desc:'先由两点算出斜率 k，再拿任意一点代入求 b，直线解析式就出来了。',
    vars:['x1','y1','x2','y2'],
    pairs:[{name:'A 点', x:'x1', y:'y1'}, {name:'B 点', x:'x2', y:'y2'}],
    labels:{ x1:'x₁', y1:'y₁', x2:'x₂', y2:'y₂' },
    default:{ x1:1, y1:3, x2:4, y2:9 },
    examples:[
      { name:'(1,3) 与 (4,9)',  values:{ x1:1,  y1:3,  x2:4, y2:9 } },
      { name:'(0,2) 与 (5,−3)', values:{ x1:0,  y1:2,  x2:5, y2:-3 } },
      { name:'两点横坐标相同',  values:{ x1:2,  y1:1,  x2:2, y2:7 } },
    ],
  },
  {
    id:'slope',
    name:'斜率 k',
    sub:'两点定斜率',
    kind:'slope',
    formula:'k = (y₁ − y₂) / (x₁ − x₂) = Δy / Δx',
    desc:'纵坐标之差除以横坐标之差。Δx 为 0 时斜率不存在，就是一条竖直线。',
    vars:['x1','y1','x2','y2'],
    pairs:[{name:'A 点', x:'x1', y:'y1'}, {name:'B 点', x:'x2', y:'y2'}],
    labels:{ x1:'x₁', y1:'y₁', x2:'x₂', y2:'y₂' },
    default:{ x1:1, y1:3, x2:4, y2:9 },
    examples:[
      { name:'(1,3) 与 (4,9)',   values:{ x1:1,  y1:3,  x2:4, y2:9 } },
      { name:'(−1,5) 与 (2,−4)', values:{ x1:-1, y1:5,  x2:2, y2:-4 } },
      { name:'竖直线 Δx = 0',    values:{ x1:2,  y1:1,  x2:2, y2:7 } },
    ],
  },
  {
    id:'intercept',
    name:'初始值 b',
    sub:'直线在 y 轴上的截距',
    kind:'intercept',
    formula:'b = y₁ − k·x₁，k = (y₂ − y₁)/(x₂ − x₁)',
    desc:'b 就是直线与 y 轴交点的纵坐标，也就是 x = 0 时的函数值。',
    vars:['x1','y1','x2','y2'],
    pairs:[{name:'A 点', x:'x1', y:'y1'}, {name:'B 点', x:'x2', y:'y2'}],
    labels:{ x1:'x₁', y1:'y₁', x2:'x₂', y2:'y₂' },
    default:{ x1:1, y1:3, x2:4, y2:9 },
    examples:[
      { name:'(1,3) 与 (4,9)', values:{ x1:1, y1:3, x2:4, y2:9 } },
      { name:'(2,0) 与 (0,4)', values:{ x1:2, y1:0, x2:0, y2:4 } },
      { name:'(−1,−1) 与 (3,7)', values:{ x1:-1, y1:-1, x2:3, y2:7 } },
    ],
  },
  {
    id:'pointLineDistance',
    name:'点到直线距离',
    sub:'点与 Ax + By + C = 0',
    kind:'pointLineDistance',
    formula:'d = |A·x₀ + B·y₀ + C| / √(A² + B²)',
    desc:'把点坐标代入直线一般式，取绝对值，再除以法向量长度 √(A²+B²)。',
    vars:['x0','y0','A','B','C'],
    pairs:[{name:'P 点', x:'x0', y:'y0'}],
    labels:{ x0:'x₀', y0:'y₀', A:'A', B:'B', C:'C' },
    default:{ x0:1, y0:2, A:1, B:-1, C:0 },
    examples:[
      { name:'点(1,2) 到 y=x',    values:{ x0:1, y0:2, A:1, B:-1, C:0 } },
      { name:'点(0,0) 到 x+y−2=0', values:{ x0:0, y0:0, A:1, B:1, C:-2 } },
      { name:'点(3,4) 到 y 轴',    values:{ x0:3, y0:4, A:1, B:0, C:0 } },
      { name:'点(2,1) 到 y=−2',    values:{ x0:2, y0:1, A:0, B:1, C:2 } },
    ],
  },
  {
    id:'twoLines',
    name:'两直线关系',
    sub:'平行 / 垂直 / 夹角',
    kind:'twoLines',
    formula:'k₁ = k₂ → 平行；k₁k₂ = −1 → 垂直；tan θ = |(k₂−k₁)/(1+k₁k₂)|',
    desc:'比较两条直线的斜率：相等就平行，乘积为 −1 就垂直，否则计算夹角。',
    vars:['k1','b1','k2','b2'],
    labels:{ k1:'k₁', b1:'b₁', k2:'k₂', b2:'b₂' },
    default:{ k1:1, b1:0, k2:-1, b2:2 },
    examples:[
      { name:'y=x 与 y=−x+2',      values:{ k1:1,   b1:0, k2:-1, b2:2 } },
      { name:'y=2x+1 与 y=2x−3',   values:{ k1:2,   b1:1, k2:2,  b2:-3 } },
      { name:'y=0.5x 与 y=−2x+1',  values:{ k1:0.5, b1:0, k2:-2, b2:1 } },
      { name:'y=3x 与 y=3x',       values:{ k1:3,   b1:0, k2:3,  b2:0 } },
    ],
  },
];

const formulaModal  = document.getElementById('formulaModal');
const formulaNav    = document.getElementById('formulaNav');
const formulaDetail = document.getElementById('formulaDetail');
const formulaClose  = document.getElementById('formulaClose');

let activeFormula = FORMULAS[0].id;
const formulaValues = {};
let lastFocus = null;

function getVals(f){
  if (!formulaValues[f.id]){
    const o = {};
    for (const k of f.vars) o[k] = String(f.default[k]);
    formulaValues[f.id] = o;
  }
  return formulaValues[f.id];
}

function readVals(f){
  const o = getVals(f), out = {};
  for (const k of f.vars){
    const n = parseFloat(o[k]);
    if (!isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

function fmtNum(v, dec = 4){
  if (!isFinite(v)) return '—';
  const r = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
  if (Math.abs(r) < 1e-12) return '0';
  let s = r.toFixed(dec);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function formatLine(k, b){
  let s = 'y = ';
  if (Math.abs(k) < 1e-12){
    s += fmtNum(b);
  } else {
    if (Math.abs(k - 1) < 1e-12)      s += 'x';
    else if (Math.abs(k + 1) < 1e-12) s += '−x';
    else                              s += fmtNum(k) + 'x';
    if (Math.abs(b) > 1e-12) s += (b > 0 ? ' + ' : ' − ') + fmtNum(Math.abs(b));
  }
  return s;
}

/* 生成 y = kx + b 的表达式（给表达式列表用） */
function lineExprFromKB(k, b){
  if (Math.abs(k) < 1e-12) return fmtNum(b);
  let core;
  if (Math.abs(k - 1) < 1e-12)      core = 'x';
  else if (Math.abs(k + 1) < 1e-12) core = '-x';
  else                              core = fmtNum(k) + '*x';
  if (Math.abs(b) > 1e-12) core += (b > 0 ? '+' : '') + fmtNum(b);
  return core;
}

function computeFormula(kind, v){
  const { x1, y1, x2, y2 } = v;
  const dx = (x2 ?? 0) - (x1 ?? 0), dy = (y2 ?? 0) - (y1 ?? 0);

  switch(kind){
    case 'distance': {
      return [
        { label:'d',  value: fmtNum(Math.hypot(dx, dy)) },
        { label:'Δx', value: fmtNum(dx) },
        { label:'Δy', value: fmtNum(dy) },
      ];
    }
    case 'midpoint': {
      return [
        { label:'M', value: `( ${fmtNum((x1+x2)/2)} , ${fmtNum((y1+y2)/2)} )` },
        { label:'x', value: fmtNum((x1+x2)/2) },
        { label:'y', value: fmtNum((y1+y2)/2) },
      ];
    }
    case 'linear': {
      if (Math.abs(dx) < 1e-12)
        return [{ label:'解析式', value:`x = ${fmtNum(x1)}`, note:'两点横坐标相同，是一条竖直线' }];
      const k = dy / dx, b = y1 - k * x1;
      return [
        { label:'解析式', value: formatLine(k, b) },
        { label:'k', value: fmtNum(k) },
        { label:'b', value: fmtNum(b) },
      ];
    }
    case 'slope': {
      if (Math.abs(dx) < 1e-12)
        return [{ label:'k', value:'不存在', bad:true, note:'Δx = 0，竖直线没有斜率' }];
      return [
        { label:'k',  value: fmtNum(dy / dx) },
        { label:'Δy', value: fmtNum(dy) },
        { label:'Δx', value: fmtNum(dx) },
      ];
    }
    case 'intercept': {
      if (Math.abs(dx) < 1e-12)
        return [{ label:'b', value:'不存在', bad:true, note:'竖直线不与 y 轴相交' }];
      const k = dy / dx, b = y1 - k * x1;
      return [
        { label:'b', value: fmtNum(b) },
        { label:'k', value: fmtNum(k) },
        { label:'交点', value: `( 0 , ${fmtNum(b)} )` },
      ];
    }
    case 'pointLineDistance': {
      const { x0, y0, A, B, C } = v;
      const denom = Math.sqrt(A*A + B*B);
      if (denom < 1e-12)
        return [{ label:'d', value:'—', bad:true, note:'A、B 不能同时为 0' }];
      const num = A*x0 + B*y0 + C;
      const d = Math.abs(num) / denom;
      return [
        { label:'d',  value: fmtNum(d) },
        { label:'分子', value: fmtNum(num), note:'A·x₀ + B·y₀ + C' },
        { label:'分母', value: fmtNum(denom), note:'√(A² + B²)' },
      ];
    }
    case 'twoLines': {
      const { k1, b1, k2, b2 } = v;
      const EPS = 1e-9;
      const parallel = Math.abs(k1 - k2) < EPS;
      const same = parallel && Math.abs(b1 - b2) < EPS;
      const perpendicular = Math.abs(1 + k1*k2) < EPS;

      let relation, angleText, note = '';
      if (same){ relation = '重合'; angleText = '0°'; note = '两条线完全一样'; }
      else if (parallel){ relation = '平行'; angleText = '0°'; note = '没有交点'; }
      else if (perpendicular){ relation = '垂直'; angleText = '90°'; note = 'k₁·k₂ = −1'; }
      else {
        relation = '相交';
        const tan = Math.abs((k2 - k1) / (1 + k1*k2));
        angleText = fmtNum(Math.atan(tan) * 180 / Math.PI, 2) + '°';
      }

      return [
        { label:'关系', value: relation },
        { label:'夹角', value: angleText, note },
        { label:'k₂−k₁', value: fmtNum(k2 - k1) },
        { label:'1+k₁k₂', value: fmtNum(1 + k1*k2) },
      ];
    }
  }
  return [];
}

function updateCalcOut(f){
  const out = formulaDetail.querySelector('#calcOut');
  if (!out) return;
  const v = readVals(f);
  if (!v){
    out.innerHTML = `<div class="calc-out-row"><span class="hint">把输入框都填上，结果会实时更新</span></div>`;
    return;
  }
  const rows = computeFormula(f.kind, v);
  out.innerHTML = rows.map(r => `
    <div class="calc-out-row">
      <span class="k">${esc(r.label)}</span>
      <span class="v ${r.bad ? 'bad' : ''}">${esc(r.value)}</span>
      ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}
    </div>
  `).join('');
}

/* 依据公式类型返回「在图上标出」的动作 */
/* 两点定线：asLine=false 出线段（带范围），true 出无限延长的直线 */
function lineFromPoints(p1, p2, asLine){
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (asLine){
    if (Math.abs(dx) < 1e-9) return 'x=' + nf(p1.x);
    const k = dy / dx;
    return lineExprFromKB(k, p1.y - k * p1.x);
  }
  return buildLineExpr(p1, p2);
}

/* 依据公式类型返回「在图上标出来」的动作，可能有好几个 */
function makeMarkButtons(f){
  const twoPointKinds = ['distance','midpoint','slope','linear','intercept'];

  if (twoPointKinds.includes(f.kind)){
    const markPoints = v => {
      const a = addFunc('point', v.x1 + ', ' + v.y1, 'manual');
      a.color = PALETTE[1];
      const b = addFunc('point', v.x2 + ', ' + v.y2, 'manual');
      b.color = PALETTE[3];
      return [a, b];
    };
    const drawLine = (v, asLine) => {
      const [a, b] = markPoints(v);
      const lf = addFunc('y', lineFromPoints({ x:v.x1, y:v.y1 }, { x:v.x2, y:v.y2 }, asLine), 'manual');
      lf.color = PALETTE[2];
      /* 记住两端点：以后拖点，线段 / 直线跟着走 */
      lf.obj = { kind: asLine ? 'line' : 'segment', a: a.id, b: b.id };
      renderList(a.id);
      requestRender(); updateHUD();
      toast(asLine ? '已画出这两点确定的直线（拖端点会跟着动）' : '已画出这两点之间的线段（拖端点会跟着动）');
      closeFormula();
    };
    return [
      { text:'在图上标出这两点', run(v){
          const [a] = markPoints(v);
          renderList(a.id); requestRender(); updateHUD();
          toast('已在图上标出两点'); closeFormula();
        } },
      { text:'标出线段', run(v){ drawLine(v, false); } },
      { text:'标出直线', run(v){ drawLine(v, true); } },
    ];
  }

  if (f.kind === 'pointLineDistance'){
    return [{
      text: '标出点与直线',
      run(v){
        const { x0, y0, A, B, C } = v;
        const lineExpr = Math.abs(B) < 1e-12 ? ('x=' + fmtNum(-C / A)) : lineExprFromKB(-A / B, -C / B);
        const pf = addFunc('point', x0 + ', ' + y0, 'manual');
        pf.color = PALETTE[1];
        const lf = addFunc('y', lineExpr, 'manual');
        lf.color = PALETTE[2];
        renderList(pf.id);
        requestRender(); updateHUD();
        toast('已标出点与直线');
        closeFormula();
      }
    }];
  }

  if (f.kind === 'twoLines'){
    return [{
      text: '画出两条直线',
      run(v){
        const f1 = addFunc('y', lineExprFromKB(v.k1, v.b1), 'manual');
        f1.color = PALETTE[1];
        const f2 = addFunc('y', lineExprFromKB(v.k2, v.b2), 'manual');
        f2.color = PALETTE[2];
        renderList(f1.id);
        requestRender(); updateHUD();
        toast('已画出两条直线');
        closeFormula();
      }
    }];
  }
  return [];
}

function renderFormulaNav(){
  formulaNav.innerHTML = FORMULAS.map(f => `
    <button data-id="${f.id}" class="${f.id === activeFormula ? 'on' : ''}"
            aria-current="${f.id === activeFormula}">
      <span class="fn-name">${esc(f.name)}</span>
      <span class="fn-sub">${esc(f.sub)}</span>
    </button>
  `).join('');
  formulaNav.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      activeFormula = b.dataset.id;
      renderFormulaNav();
      renderFormulaDetail();
    });
  });
}

function renderFormulaDetail(){
  const f = FORMULAS.find(x => x.id === activeFormula);
  if (!f) return;
  const o = getVals(f);
  const mbs = makeMarkButtons(f);
  const pairs = f.pairs || [];
  const curveCands = state.funcs.filter(x => x.visible && x.fn && x.type === 'y' && !x.vertical);
  const instCands = state.funcs.filter(x => x.visible && x.fn && x.type !== 'y' && x.type !== 'point');

  formulaDetail.innerHTML = `
    <div class="formula-head">
      <div class="formula-title">${esc(f.name)}</div>
      <div class="formula-math">${esc(f.formula)}</div>
      <div class="formula-desc">${esc(f.desc)}</div>
    </div>

    ${pairs.length ? `
      <div class="pick-box">
        <div class="pick-label">从图上 / 表格里取点</div>
        ${pairs.map((p, i) => `
          <div class="pair-pick">
            <span class="pp-name">${esc(p.name)}</span>
            <select class="pp-sel" data-pair="${i}" aria-label="${esc(p.name)}：选现成的点">
              <option value="">选现成的点…</option>
              ${pointChoices()}
            </select>
            <button class="pp-btn" type="button" data-pick="${i}">图上点一下</button>
          </div>`).join('')}
        ${pairs.length === 2 ? `
          <div class="pair-pick">
            <span class="pp-name">从曲线</span>
            <select class="pp-sel" id="curvePick" aria-label="从曲线上取两点">
              <option value="">选一条函数，取它上面两点…</option>
              ${curveCands.map(x => `<option value="${x.id}">${esc(displayExpr(x))}</option>`).join('')}
            </select>
            <button class="pp-btn" type="button" data-pick="-1">图上取两点</button>
          </div>` : ''}
        ${instCands.length ? `
          <div class="pair-pick">
            <span class="pp-name">从图上</span>
            <select class="pp-sel" id="instPick" aria-label="从图上的曲线取一点">
              <option value="">选一条曲线，取它上面一点…</option>
              ${instCands.map(x => `<option value="${x.id}">${esc(displayExpr(x))}</option>`).join('')}
            </select>
          </div>` : ''}
      </div>` : ''}

    <div class="calc-grid">
      ${f.vars.map(k => `
        <label class="calc-field">
          <span>${esc(f.labels[k])}</span>
          <input type="number" step="any" inputmode="decimal"
                 data-var="${k}" value="${esc(o[k])}"
                 aria-label="${esc(f.labels[k])}">
        </label>
      `).join('')}
    </div>

    <div class="calc-out" id="calcOut" aria-live="polite"></div>

    ${mbs.length ? `
      <div class="mark-row">
        ${mbs.map((b, i) => `
          <button class="mark-btn" data-mark="${i}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="2.4"/>
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
            </svg>
            ${esc(b.text)}
          </button>`).join('')}
      </div>` : ''}

    <div class="examples-label">实例</div>
    <div class="example-list">
      ${f.examples.map((e, i) =>
        `<button class="example-chip" data-ex="${i}">${esc(e.name)}</button>`).join('')}
    </div>
  `;

  formulaDetail.querySelectorAll('input[data-var]').forEach(inp => {
    inp.addEventListener('input', () => {
      getVals(f)[inp.dataset.var] = inp.value;
      updateCalcOut(f);
    });
  });

  formulaDetail.querySelectorAll('.example-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const ex = f.examples[Number(btn.dataset.ex)];
      if (!ex) return;
      const oo = getVals(f);
      for (const k of f.vars) oo[k] = String(ex.values[k]);
      renderFormulaDetail();
    });
  });

  /* 取点：现成的点（对象 / 点表格） */
  formulaDetail.querySelectorAll('.pp-sel[data-pair]').forEach(sel => {
    sel.addEventListener('change', () => {
      const p = pairs[Number(sel.dataset.pair)];
      const val = sel.value;
      if (!p || !val) return;
      const parts = val.split(',');
      if (parts.length !== 2) return;
      const oo = getVals(f);
      oo[p.x] = parts[0]; oo[p.y] = parts[1];
      renderFormulaDetail();
      toast(p.name + ' 取好了');
    });
  });

  /* 取点：在图上点一下 */
  formulaDetail.querySelectorAll('.pp-btn[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.pick);
      if (idx < 0){
        const v0 = readVals(f);
        startPick('两点中的第一点', (x, y) => {
          getVals(f).x1 = String(+x.toFixed(4));
          getVals(f).y1 = String(+y.toFixed(4));
          reopenFormula();
          toast('A 点取好了，再取 B 点');
          setTimeout(() => startPick('两点中的第二点', (x2, y2) => {
            getVals(f).x2 = String(+x2.toFixed(4));
            getVals(f).y2 = String(+y2.toFixed(4));
            reopenFormula();
          }), 60);
        });
        void v0;
        return;
      }
      const p = pairs[idx];
      if (!p) return;
      startPick(p.name, (x, y) => {
        const oo = getVals(f);
        oo[p.x] = String(+x.toFixed(4));
        oo[p.y] = String(+y.toFixed(4));
        reopenFormula();
      });
    });
  });

  /* 从曲线上取两点：拿它当两个点用（「选中表达式解析」） */
  const cp = formulaDetail.querySelector('#curvePick');
  if (cp){
    cp.addEventListener('change', () => {
      const target = state.funcs.find(x => String(x.id) === cp.value);
      if (!target) return;
      const span = W / state.view.scale;
      const xs = [state.view.cx - span * 0.25, state.view.cx + span * 0.25];
      const pts = [];
      for (const x of xs){
        let y;
        try { y = target.fn(x); } catch(e){ y = NaN; }
        if (typeof y !== 'number' || !isFinite(y)){ toast('这条曲线在这个范围里取不到值', 'error'); return; }
        pts.push([x, y]);
      }
      const oo = getVals(f);
      oo.x1 = String(+pts[0][0].toFixed(4)); oo.y1 = String(+pts[0][1].toFixed(4));
      oo.x2 = String(+pts[1][0].toFixed(4)); oo.y2 = String(+pts[1][1].toFixed(4));
      renderFormulaDetail();
      toast('已从 ' + displayExpr(target) + ' 上取两点');
    });
  }

  /* 从图上的非函数曲线（隐式 / 极坐标 / 参数）取一点 */
  const ip = formulaDetail.querySelector('#instPick');
  if (ip && pairs.length){
    ip.addEventListener('change', () => {
      const target = state.funcs.find(x => String(x.id) === ip.value);
      if (!target) return;
      const p = samplePointOn(target);
      if (!p){ toast('这条曲线取不到点', 'error'); return; }
      const oo = getVals(f);
      oo[pairs[0].x] = String(+p[0].toFixed(4));
      oo[pairs[0].y] = String(+p[1].toFixed(4));
      renderFormulaDetail();
      toast('已从 ' + displayExpr(target) + ' 上取一点');
    });
  }

  formulaDetail.querySelectorAll('.mark-btn[data-mark]').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = mbs[Number(btn.dataset.mark)];
      if (!b) return;
      const freshV = readVals(f);
      if (!freshV){ toast('先把输入框填完整', 'error'); return; }
      b.run(freshV);
    });
  });

  updateCalcOut(f);
}

/* 数值表 / 图上取点共用的：曲线上采一个点（尽量落在当前视图中间） */
function samplePointOn(f){
  const { cx, cy, scale } = state.view;
  const tryList = [];
  if (f.type === 'y'){
    for (let i = 0; i <= 40; i++) tryList.push(cx + (i - 20) * (W / scale) / 40);
    for (const x of tryList){
      let y;
      try { y = f.vertical ? null : f.fn(x); } catch(e){ y = null; }
      if (typeof y === 'number' && isFinite(y)) return [x, y];
    }
    return null;
  }
  if (f.type === 'polar' || f.type === 'parametric'){
    const t0 = isFinite(f.t0) ? f.t0 : 0, t1 = isFinite(f.t1) ? f.t1 : Math.PI * 2;
    for (let i = 0; i <= 60; i++){
      const t = t0 + (t1 - t0) * i / 60;
      let x, y;
      try {
        if (f.type === 'polar'){ const r = f.fn(t); x = r * Math.cos(t); y = r * Math.sin(t); }
        else { x = f.fn[0](t); y = f.fn[1](t); }
      } catch(e){ continue; }
      if (isFinite(x) && isFinite(y)) return [x, y];
    }
    return null;
  }
  if (f.type === 'point'){
    try { const p = f.fn(); return isFinite(p[0]) ? p : null; } catch(e){ return null; }
  }
  /* 隐式：在视图里找一格子使值最接近 0 */
  let best = null, bestV = Infinity;
  for (let sx = 0; sx <= W; sx += 12){
    for (let sy = 0; sy <= H; sy += 12){
      const x = s2wX(sx), y = s2wY(sy);
      let v; try { v = f.fn(x, y); } catch(e){ continue; }
      const av = Math.abs(v);
      if (isFinite(av) && av < bestV){ bestV = av; best = [x, y]; }
    }
  }
  return bestV < 1 ? best : null;
  void cy;
}

function openFormula(){
  lastFocus = document.activeElement;
  renderFormulaNav();
  renderFormulaDetail();
  formulaModal.classList.add('show');
  requestAnimationFrame(() => formulaClose.focus());
}

function closeFormula(){
  if (!formulaModal.classList.contains('show')) return;
  formulaModal.classList.remove('show');
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

document.getElementById('formulaBtn').addEventListener('click', openFormula);
formulaClose.addEventListener('click', closeFormula);

formulaModal.addEventListener('click', e => {
  if (e.target === formulaModal) closeFormula();
});

formulaModal.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const items = formulaModal.querySelectorAll(
    'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

/* ═══════════════════════════════════════════════════
   12. 画布尺寸 & 变换
   ═══════════════════════════════════════════════════ */

let W = 0, H = 0;
let noisePattern = null;
/* 导出图片时的渲染覆盖：非 null 表示「这一帧是画给导出用的」。
   实时画面恒为 null，draw() 在 null 时与以前逐字节一致。 */
let renderOverride = null;

function buildNoise(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const nx = c.getContext('2d');
  const img = nx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4){
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = 255;
  }
  nx.putImageData(img, 0, 0);
  noisePattern = ctx.createPattern(c, 'repeat');
}

function resize(){
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width));
  H = Math.max(1, Math.round(r.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!noisePattern) buildNoise();
  requestRender();
}
new ResizeObserver(resize).observe(stage);

const w2sX = x => (x - state.view.cx) * state.view.scale + W / 2;
const w2sY = y => H / 2 - (y - state.view.cy) * state.view.scale;
const s2wX = sx => (sx - W / 2) / state.view.scale + state.view.cx;
const s2wY = sy => state.view.cy - (sy - H / 2) / state.view.scale;
const screenToWorld = (sx, sy) => ({ x: s2wX(sx), y: s2wY(sy) });

/* ═══════════════════════════════════════════════════
   13. 渲染
   ═══════════════════════════════════════════════════ */

let needsRender = false;
function requestRender(){
  historyTick();                 /* 状态一变就记一笔，撤销才有得撤 */
  if (needsRender) return;
  needsRender = true;
  requestAnimationFrame(() => { needsRender = false; draw(); });
}

let animRaf = null;
function updateAlphas(){
  const now = performance.now();
  let busy = false;
  for (const f of state.funcs){
    const target = f.visible ? 1 : 0;
    if (f.alpha === target) continue;
    const t = Math.min(1, (now - f._start) / f._dur);
    const e = 1 - Math.pow(1 - t, 3);
    f.alpha = f._from + (target - f._from) * e;
    if (t < 1) busy = true;
    else f.alpha = target;
  }
  return busy;
}
function ensureAnim(){
  if (animRaf || prefersReduced.matches) return;
  animRaf = requestAnimationFrame(function step(){
    const busy = updateAlphas();
    draw();
    animRaf = busy ? requestAnimationFrame(step) : null;
  });
}

function niceStep(scale, targetPx){
  const raw = targetPx / scale;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1.5 ? 1 : norm <= 3.5 ? 2 : norm <= 7.5 ? 5 : 10;
  return mult * mag;
}
function fmtTick(v, step){
  if (Math.abs(v) < step * 0.001) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  const dec = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(dec, 6));
}
function nf(v){
  if (!isFinite(v)) return '0';
  if (Math.abs(v) < 1e-9) return '0';
  let s = v.toFixed(4);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s || '0';
}

/* 坐标轴末端的文字标签（默认 x / y，可以在设置里换成任意字符串） */
function drawAxisLabels(x0, y0){
  const lx = state.settings.axisX;
  const ly = state.settings.axisY;
  if (!lx && !ly) return;

  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = CV.ink;

  if (lx){
    const ay = Math.min(Math.max(y0, 18), H - 8);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(lx, W - 10, ay - 5);
  }
  if (ly){
    const ax = Math.min(Math.max(x0, 12), W - 14) + 8;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(ly, ax, 10);
  }
}

function draw(){
  if (!W || !H) return;
  const { cx, cy, scale } = state.view;
  const S = state.settings;
  const RO = renderOverride;                 /* 导出时才有值 */

  /* 背景 */
  if (!RO || !RO.transparent){
    if (RO && RO.solid){
      ctx.fillStyle = RO.solid;
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createRadialGradient(W*.62, H*.12, 0, W*.62, H*.12, Math.max(W,H)*.95);
      g.addColorStop(0, CV.bg1);
      g.addColorStop(.55, CV.bg2);
      g.addColorStop(1, CV.bg3);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* 噪点只给实时画面（导出图要干净、可复现） */
  if (!RO && noisePattern){
    ctx.globalAlpha = 0.028;
    ctx.fillStyle = noisePattern;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  const xMin = cx - W/2/scale, xMax = cx + W/2/scale;
  const yMin = cy - H/2/scale, yMax = cy + H/2/scale;

  /* 网格 */
  if (RO ? RO.grid : S.showGrid){
    const major = niceStep(scale, 88);
    const minor = major / 5;

    if (minor * scale >= 9){
      ctx.strokeStyle = CV.grid1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = Math.ceil(xMin/minor); k*minor <= xMax; k++){
        const sx = Math.round((k*minor - cx)*scale + W/2) + .5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
      }
      for (let k = Math.ceil(yMin/minor); k*minor <= yMax; k++){
        const sy = Math.round(H/2 - (k*minor - cy)*scale) + .5;
        ctx.moveTo(0, sy); ctx.lineTo(W, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = CV.grid2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = Math.ceil(xMin/major); k*major <= xMax; k++){
      const sx = Math.round((k*major - cx)*scale + W/2) + .5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, H);
    }
    for (let k = Math.ceil(yMin/major); k*major <= yMax; k++){
      const sy = Math.round(H/2 - (k*major - cy)*scale) + .5;
      ctx.moveTo(0, sy); ctx.lineTo(W, sy);
    }
    ctx.stroke();
  }

  /* 坐标轴 */
  const y0 = H/2 - (0 - cy)*scale;
  const x0 = W/2 + (0 - cx)*scale;

  const showAxes = RO ? !!RO.axes : true;
  if (showAxes){
    ctx.strokeStyle = CV.axis;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (y0 >= -1 && y0 <= H+1){ ctx.moveTo(0, Math.round(y0)+.5); ctx.lineTo(W, Math.round(y0)+.5); }
    if (x0 >= -1 && x0 <= W+1){ ctx.moveTo(Math.round(x0)+.5, 0); ctx.lineTo(Math.round(x0)+.5, H); }
    ctx.stroke();
  }

  /* 刻度 */
  if (RO ? RO.axes : S.showTicks){
    const major = niceStep(scale, 88);
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = CV.tick;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const labY = Math.min(Math.max(y0, 15), H - 7);
    for (let k = Math.ceil(xMin/major); k*major <= xMax; k++){
      const v = k*major;
      if (Math.abs(v) < major*0.001) continue;
      ctx.fillText(fmtTick(v, major), (v - cx)*scale + W/2 + 4, labY - 6);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labX = Math.min(Math.max(x0, 26), W - 8);
    for (let k = Math.ceil(yMin/major); k*major <= yMax; k++){
      const v = k*major;
      if (Math.abs(v) < major*0.001) continue;
      ctx.fillText(fmtTick(v, major), labX - 7, H/2 - (v - cy)*scale);
    }
  }

  /* 坐标轴标签 */
  if (showAxes) drawAxisLabels(x0, y0);

  /* 曲线 */
  for (const f of state.funcs){
    if (f.alpha <= 0.002 || !f.visible) continue;
    /* poly 顶点现取、text 没有 fn，都不受这个限制 */
    if (f.type !== 'poly' && f.type !== 'text' && !f.fn) continue;
    switch(f.type){
      case 'y':          drawY(f);          break;
      case 'implicit':   drawImplicit(f);   break;
      case 'polar':      drawPolar(f);      break;
      case 'parametric': drawParametric(f); break;
      case 'point':      drawPoint(f);      break;
      case 'text':       drawTextObj(f);    break;
      case 'poly':       drawPolygon(f);    break;
    }
  }
  ctx.globalAlpha = 1;

  /* 点表格 */
  drawPointTable();

  /* 长度 / 角度标注 */
  for (const f of state.funcs){
    if (f.alpha <= 0.002 || !f.visible) continue;
    if (f.measure) drawMeasure(f);
  }

  /* 自动交点 */
  drawAutoIntersections();

  /* 数值表标记 / 画笔预览 / 悬停：都是界面，导出时不画 */
  if (!RO){
    drawVtHighlight();
    if (pen.active) drawPenPreview();
    else drawHover();
  }
}

/* ── 自动交点：所有可见曲线两两求交，画成小圆点 ── */
let interCache = { key: null, pts: [] };

function autoIntersections(){
  const curves = state.funcs.filter(f => f.visible && f.fn && f.type !== 'point' && f.type !== 'poly');
  if (curves.length < 2) return [];
  const v = state.view;
  const key = curves.map(f => f.id + ':' + f.expr).join('|') + '#' + W + 'x' + H + '#' +
    v.cx.toFixed(4) + ',' + v.cy.toFixed(4) + ',' + v.scale.toFixed(4);
  if (interCache.key === key) return interCache.pts;

  const out = [];
  outer:
  for (let i = 0; i < curves.length; i++){
    for (let j = i + 1; j < curves.length; j++){
      let pts = [];
      try { pts = curveIntersections(curves[i], curves[j]); } catch(e){ continue; }
      for (const p of pts){
        if (out.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)) continue;
        out.push(p);
        if (out.length >= 30) break outer;
      }
    }
  }
  interCache = { key, pts: out };
  return out;
}

function drawAutoIntersections(){
  if (!state.settings.autoInter) return;
  const pts = autoIntersections();
  if (!pts.length) return;
  const withLabel = pts.length <= 6;
  for (const p of pts){
    const sx = w2sX(p.x), sy = w2sY(p.y);
    if (sx < -24 || sx > W + 24 || sy < -24 || sy > H + 24) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, 6.4, 0, Math.PI*2);
    ctx.fillStyle = CV.chip;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 3.3, 0, Math.PI*2);
    ctx.fillStyle = CV.ink;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = CV.bg1;
    ctx.stroke();
    if (withLabel) tagLabel(sx + 6, sy - 6, '(' + fmtShort(p.x) + ', ' + fmtShort(p.y) + ')', CV.ink);
  }
}

/* ── y = f(x) ── */
function drawY(f){
  if (f.vertical){ drawVertical(f); return; }

  ctx.beginPath();
  const { cx, cy, scale } = state.view;
  let prevSy = null;
  const n = Math.ceil(W);

  for (let i = 0; i <= n; i++){
    const x = (i - W/2) / scale + cx;
    let y;
    try { y = f.fn(x); } catch { y = NaN; }
    if (typeof y !== 'number' || !isFinite(y)){ prevSy = null; continue; }
    let sy = H/2 - (y - cy)*scale;
    if (!isFinite(sy)){ prevSy = null; continue; }
    if (sy < -6000) sy = -6000; else if (sy > H+6000) sy = H+6000;

    if (prevSy === null || Math.abs(sy - prevSy) > H*3) ctx.moveTo(i, sy);
    else ctx.lineTo(i, sy);
    prevSy = sy;
  }

  strokeCurve(f);
}

/* ── 竖直线 x = f(y) ── */
function drawVertical(f){
  ctx.beginPath();
  const { cx, cy, scale } = state.view;

  const yTop = cy + H/2/scale;
  const yBot = cy - H/2/scale;
  const steps = Math.max(2, Math.ceil(H / 1.5));

  let started = false;
  for (let i = 0; i <= steps; i++){
    const y = yBot + (yTop - yBot) * i / steps;
    let x;
    try { x = f.fn(y); } catch { x = NaN; }
    if (typeof x !== 'number' || !isFinite(x)){ started = false; continue; }
    const sx = (x - cx)*scale + W/2;
    const sy = H/2 - (y - cy)*scale;
    if (!isFinite(sx) || !isFinite(sy)){ started = false; continue; }
    if (!started){ ctx.moveTo(sx, sy); started = true; }
    else ctx.lineTo(sx, sy);
  }

  strokeCurve(f);
}

/* ── 极坐标 ── */
function drawPolar(f){
  ctx.beginPath();
  const { cx, cy, scale } = state.view;
  const steps = 1200;
  const TAU = Math.PI * 2;

  let started = false;
  for (let i = 0; i <= steps; i++){
    const t = i / steps * TAU;
    let r;
    try { r = f.fn(t); } catch { r = NaN; }
    if (typeof r !== 'number' || !isFinite(r)){ started = false; continue; }
    const x = r * Math.cos(t), y = r * Math.sin(t);
    const sx = (x - cx)*scale + W/2;
    const sy = H/2 - (y - cy)*scale;
    if (!isFinite(sx) || !isFinite(sy)){ started = false; continue; }
    if (!started){ ctx.moveTo(sx, sy); started = true; }
    else ctx.lineTo(sx, sy);
  }

  strokeCurve(f);
}

/* ── 参数方程 ── */
function drawParametric(f){
  ctx.beginPath();
  const { cx, cy, scale } = state.view;
  const steps = 1200;
  const t0 = (typeof f.t0 === 'number' && isFinite(f.t0)) ? f.t0 : 0;
  const t1 = (typeof f.t1 === 'number' && isFinite(f.t1)) ? f.t1 : Math.PI * 2;

  let started = false;
  for (let i = 0; i <= steps; i++){
    const t = t0 + (t1 - t0) * i / steps;
    let x, y;
    try { x = f.fn[0](t); y = f.fn[1](t); } catch { started = false; continue; }
    if (!isFinite(x) || !isFinite(y)){ started = false; continue; }
    const sx = (x - cx)*scale + W/2;
    const sy = H/2 - (y - cy)*scale;
    if (!isFinite(sx) || !isFinite(sy)){ started = false; continue; }
    if (!started){ ctx.moveTo(sx, sy); started = true; }
    else ctx.lineTo(sx, sy);
  }

  strokeCurve(f);
}

/* ── 隐函数：Marching Squares ── */
function drawImplicit(f){
  const { cx, cy, scale } = state.view;
  const cell = 6;
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;

  const vals = new Float32Array(cols * rows);
  const vxArr = new Float32Array(cols);
  const vyArr = new Float32Array(rows);

  for (let i = 0; i < cols; i++) vxArr[i] = (i*cell - W/2)/scale + cx;
  for (let j = 0; j < rows; j++) vyArr[j] = cy - (j*cell - H/2)/scale;

  for (let j = 0; j < rows; j++){
    for (let i = 0; i < cols; i++){
      let v;
      try { v = f.fn(vxArr[i], vyArr[j]); } catch { v = NaN; }
      vals[j*cols + i] = (typeof v === 'number' && isFinite(v)) ? v : NaN;
    }
  }

  ctx.beginPath();

  for (let j = 0; j < rows - 1; j++){
    for (let i = 0; i < cols - 1; i++){
      const v00 = vals[j*cols + i];
      const v10 = vals[j*cols + i + 1];
      const v11 = vals[(j+1)*cols + i + 1];
      const v01 = vals[(j+1)*cols + i];

      if (!isFinite(v00) || !isFinite(v10) || !isFinite(v11) || !isFinite(v01)) continue;
      if (v00 === 0) vals[j*cols + i] = 1e-9;

      const s00 = v00 > 0 ? 1 : 0;
      const s10 = v10 > 0 ? 1 : 0;
      const s11 = v11 > 0 ? 1 : 0;
      const s01 = v01 > 0 ? 1 : 0;

      const code = (s00 << 3) | (s10 << 2) | (s11 << 1) | s01;
      if (code === 0 || code === 15) continue;

      const x0 = i*cell, x1 = (i+1)*cell;
      const y0 = j*cell, y1 = (j+1)*cell;

      const tTop    = v00 / (v00 - v10);
      const tRight  = v10 / (v10 - v11);
      const tBottom = v01 / (v01 - v11);
      const tLeft   = v00 / (v00 - v01);

      const top    = { x: x0 + (x1-x0)*tTop,    y: y0 };
      const right  = { x: x1,                   y: y0 + (y1-y0)*tRight };
      const bottom = { x: x0 + (x1-x0)*tBottom, y: y1 };
      const left   = { x: x0,                   y: y0 + (y1-y0)*tLeft };

      const seg = (a, b) => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      };

      switch (code){
        case 1: case 14: seg(bottom, left); break;
        case 2: case 13: seg(right, bottom); break;
        case 3: case 12: seg(right, left); break;
        case 4: case 11: seg(top, right); break;
        case 6: case 9:  seg(top, bottom); break;
        case 7: case 8:  seg(top, left); break;
        case 5:  seg(top, left); seg(right, bottom); break;
        case 10: seg(top, right); seg(bottom, left); break;
      }
    }
  }

  ctx.globalAlpha = 0.14 * f.alpha;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.globalAlpha = f.alpha;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.globalAlpha = 1;
}

/* ── 点 ── */
function drawPoint(f){
  let pt;
  try { pt = f.fn(); } catch { return; }
  if (!pt || !isFinite(pt[0]) || !isFinite(pt[1])) return;

  const sx = w2sX(pt[0]), sy = w2sY(pt[1]);
  if (sx < -20 || sx > W+20 || sy < -20 || sy > H+20) return;

  const r = 3.2 + (Math.max(1, +f.width || 2) - 2) * 1.4;

  ctx.globalAlpha = f.alpha;
  ctx.beginPath();
  ctx.arc(sx, sy, r + 5, 0, Math.PI*2);
  ctx.fillStyle = f.color;
  ctx.globalAlpha = 0.18 * f.alpha;
  ctx.fill();

  if (f.id === selectedId){
    ctx.globalAlpha = 0.9 * f.alpha;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3.4, 0, Math.PI*2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = CV.ink;
    ctx.stroke();
  }

  ctx.globalAlpha = f.alpha;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI*2);
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ── 点表格 ── */
function drawPointTable(){
  const t = state.pointTable;
  if (!t.visible || t.points.length === 0) return;

  for (const p of t.points){
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const sx = w2sX(p.x), sy = w2sY(p.y);
    if (sx < -30 || sx > W+30 || sy < -30 || sy > H+30) continue;

    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI*2);
    ctx.fillStyle = t.color;
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI*2);
    ctx.fillStyle = t.color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, 5.3, 0, Math.PI*2);
    ctx.strokeStyle = CV.chip;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* 通用：双层描边 */
function strokeCurve(f){
  const w = Math.max(1, +f.width || 2);
  if (f.id === selectedId){
    ctx.save();
    ctx.globalAlpha = 0.34 * f.alpha;
    ctx.lineWidth = w + 8;
    ctx.strokeStyle = CV.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 0.14 * f.alpha;
  ctx.lineWidth = w + 5;
  ctx.strokeStyle = f.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.globalAlpha = f.alpha;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ── 画笔预览 ── */
function drawPenPreview(){
  if (!pen.cursor) return;

  let cur = pen.cursor;
  if (state.settings.snap) cur = snapPoint(cur);

  const cpx = w2sX(cur.x), cpy = w2sY(cur.y);

  if (!pen.pending){
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cpx, cpy, 4, 0, Math.PI*2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cpx-8, cpy); ctx.lineTo(cpx-5, cpy);
    ctx.moveTo(cpx+5, cpy); ctx.lineTo(cpx+8, cpy);
    ctx.moveTo(cpx, cpy-8); ctx.lineTo(cpx, cpy-5);
    ctx.moveTo(cpx, cpy+5); ctx.lineTo(cpx, cpy+8);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  const s = pen.pending;
  const spx = w2sX(s.x), spy = w2sY(s.y);

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = pen.color;
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(spx, spy);
  ctx.lineTo(cpx, cpy);
  ctx.stroke();
  ctx.restore();

  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cpx, cpy, 3.2, 0, Math.PI*2);
  ctx.fillStyle = pen.color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(spx, spy, 4.5, 0, Math.PI*2);
  ctx.fillStyle = pen.color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(spx, spy, 9, 0, Math.PI*2);
  ctx.strokeStyle = pen.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const label = `(${nf(s.x)}, ${nf(s.y)})`;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const tw = ctx.measureText(label).width;
  let bx = spx + 14, by = spy - 12;
  if (bx + tw + 12 > W) bx = spx - tw - 20;
  if (by < 12) by = spy + 22;

  ctx.fillStyle = CV.chip;
  ctx.fillRect(bx - 4, by - 11, tw + 10, 18);
  ctx.fillStyle = pen.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx, by - 1);
}

/* ── 悬停十字 ── */
let hover = null;

function drawHover(){
  if (!hover) return;
  const { cx, cy, scale } = state.view;
  const { mx, my } = hover;

  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = CV.cross;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(mx)+.5, 0); ctx.lineTo(Math.round(mx)+.5, H);
  ctx.moveTo(0, Math.round(my)+.5); ctx.lineTo(W, Math.round(my)+.5);
  ctx.stroke();
  ctx.restore();

  const hx = (mx - W/2)/scale + cx;

  for (const f of state.funcs){
    if (f.alpha <= 0.002 || !f.fn || !f.visible) continue;
    if (f.type !== 'y' || f.vertical) continue;

    let y;
    try { y = f.fn(hx); } catch { continue; }
    if (!isFinite(y)) continue;

    const sy = H/2 - (y - cy)*scale;
    if (sy < -24 || sy > H+24) continue;

    ctx.globalAlpha = f.alpha;
    ctx.beginPath();
    ctx.arc(mx, sy, 6, 0, Math.PI*2);
    ctx.fillStyle = CV.chip;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx, sy, 3.6, 0, Math.PI*2);
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/* ═══════════════════════════════════════════════════
   14. HUD
   ═══════════════════════════════════════════════════ */

function fmtShort(v){
  if (!isFinite(v)) return '∞';
  if (Math.abs(v) < 1e-12) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(2);
  return v.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function updateHUD(){
  const { cx, cy, scale } = state.view;

  if (!hover){
    hudX.textContent = '—';
    hudY.textContent = '—';
    legendEl.classList.remove('show');
    return;
  }

  const hx = (hover.mx - W/2)/scale + cx;
  const hy = cy - (hover.my - H/2)/scale;
  hudX.textContent = fmtShort(hx);
  hudY.textContent = fmtShort(hy);

  const live = state.funcs.filter(f => f.visible && f.fn && f.type === 'y' && !f.vertical);
  if (live.length === 0){ legendEl.classList.remove('show'); return; }

  legendEl.innerHTML = live.map(f => {
    let v;
    try { v = f.fn(hx); } catch { v = NaN; }
    const txt = (typeof v === 'number' && isFinite(v)) ? fmtShort(v) : '未定义';
    return `<div class="lg-row">
      <i style="background:${f.color}"></i>
      <span class="lg-eq">${esc(f.expr || '—')}</span>
      <b>${txt}</b>
    </div>`;
  }).join('');
  legendEl.classList.add('show');
}

/* ═══════════════════════════════════════════════════
   15. 交互
   ═══════════════════════════════════════════════════ */

let drag = null;

/* ★ 支持竖直线：dx ≈ 0 时生成 x = 常数 {y 范围} */
function buildLineExpr(p1, p2){
  const dx = p2.x - p1.x, dy = p2.y - p1.y;

  // 竖直线：x = 常数，y 限定在线段两端之间
  if (Math.abs(dx) < 1e-9){
    const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
    return `x=(${nf(p1.x)}){${nf(minY)}<=y&&y<=${nf(maxY)}}`;
  }

  const k = dy / dx;
  const b = p1.y - k * p1.x;
  const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);

  let kPart = '';
  if (Math.abs(k) > 1e-9){
    if (Math.abs(k - 1) < 1e-9) kPart = 'x';
    else if (Math.abs(k + 1) < 1e-9) kPart = '-x';
    else kPart = nf(k) + '*x';
  }

  let bPart = '';
  if (Math.abs(b) > 1e-9){
    if (kPart === '') bPart = nf(b);
    else bPart = b > 0 ? ('+' + nf(b)) : ('-' + nf(-b));
  }

  let core;
  if (kPart === '' && bPart === '') core = '0';
  else if (kPart === '') core = bPart;
  else if (bPart === '') core = kPart;
  else core = kPart + bPart;

  return `(${core}){${nf(minX)}<=x&&x<=${nf(maxX)}}`;
}

function buildDotExpr(p, sizePx){
  const eps = Math.max(sizePx, 1) / state.view.scale;
  const half = eps / 2;
  return `(${nf(p.y)}){${nf(p.x-half)}<=x&&x<=${nf(p.x+half)}}`;
}

function handlePenClick(mx, my){
  let world = screenToWorld(mx, my);
  world = snapPoint(world);
  pen.cursor = world;

  if (!pen.pending){
    pen.pending = world;
    updatePenBadge();
    requestRender();
    return;
  }

  const pixelDist = Math.hypot(
    (world.x - pen.pending.x) * state.view.scale,
    (world.y - pen.pending.y) * state.view.scale
  );

  let expr, msg;

  if (pixelDist < 8){
    expr = buildDotExpr(pen.pending, pen.size);
    msg = '已生成一个点';
  } else {
    // 支持竖直线：buildLineExpr 内部已处理 dx≈0
    expr = buildLineExpr(pen.pending, world);
    msg = '已生成一条线段';
  }

  const f = addFunc('y', expr, 'pen');
  f.color = pen.color;
  renderList(f.id);
  toast(msg + ' · 已追加');

  pen.pending = null;
  pen.cursor = world;
  updatePenBadge();
  requestRender();
  updateHUD();
}

/* ── 触屏手势：双指缩放 / 双指平移 / 双指轻点撤回 ── */
const TAP_MOVE = 8;      /* px：手指挪这么多就算「动过」 */
const TAP_ZOOM = 0.06;   /* 两指间距变化超过 6% 也算动过 */
const TAP_MS   = 320;    /* ms：双指轻点的时长上限 */

const touchPts  = new Map();  /* pointerId → 当前画布坐标，只收触屏 */
const touchDown = new Map();  /* pointerId → 落下时的画布坐标 */
let pinch = null;             /* 双指手势的中间状态 */
let tapCandidate = null;      /* 可能是双指轻点，等最后一根手指抬起再判定 */
let penTap = null;            /* 画笔模式下待确认的单指落点 */
let touchConsumed = false;    /* 这一轮触摸已被双指手势接管 */

const gesturesOn = () => state.settings.gestures === true;

function pinchInfo(){
  const arr = [...touchPts.values()];
  if (arr.length < 2) return null;
  const p = arr[0], q = arr[1];
  return {
    dist: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)),
    mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
  };
}

/* 动过就不算轻点了 */
function markGestureMoved(){
  if (pinch) pinch.moved = true;
  if (tapCandidate) tapCandidate.moved = true;
}

function beginPinch(){
  const info = pinchInfo();
  if (!info) return;
  pinch = {
    dist0: info.dist, mid0: info.mid,
    lastDist: info.dist, lastMid: info.mid,
    moved: false,
  };
  tapCandidate = { t0: performance.now(), moved: false };
  touchConsumed = true;
  penTap = null;
  drag = null;
  hover = null;
  pen.cursor = null;
}

function clearTouch(){
  touchPts.clear();
  touchDown.clear();
  pinch = null;
  tapCandidate = null;
  penTap = null;
  drag = null;
  touchConsumed = false;
}

function updatePinch(){
  const info = pinchInfo();
  if (!pinch || !info) return;

  const dx = info.mid.x - pinch.lastMid.x;
  const dy = info.mid.y - pinch.lastMid.y;
  const ratio = info.dist / pinch.lastDist;

  if (Math.hypot(info.mid.x - pinch.mid0.x, info.mid.y - pinch.mid0.y) > TAP_MOVE ||
      Math.abs(info.dist / pinch.dist0 - 1) > TAP_ZOOM){
    markGestureMoved();
  }

  /* 先按中点位移平移，再以新中点缩放 */
  state.view.cx -= dx / state.view.scale;
  state.view.cy += dy / state.view.scale;
  if (Math.abs(ratio - 1) > 0.001) zoomAt(info.mid.x, info.mid.y, ratio);

  pinch.lastDist = info.dist;
  pinch.lastMid = info.mid;
  hover = { mx: info.mid.x, my: info.mid.y };
  requestRender();
  updateHUD();
}

function endTouchPointer(e){
  touchPts.delete(e.pointerId);
  touchDown.delete(e.pointerId);
  if (touchPts.size === 0 && dragPoint) endPointDrag();

  if (touchPts.size >= 2){ pinch = null; beginPinch(); return; }

  if (touchPts.size === 1){
    /* 还剩一根手指：不给它补单指动作，免得手势收尾时误落点 */
    pinch = null;
    penTap = null;
    drag = null;
    return;
  }

  /* 手都抬完了：这时才判定双指轻点 */
  const isTap = !!tapCandidate && !tapCandidate.moved &&
                (performance.now() - tapCandidate.t0) < TAP_MS;
  pinch = null;
  tapCandidate = null;
  if (isTap){
    penTap = null; drag = null; touchConsumed = false;
    undoStroke();
    return;
  }
  if (!touchConsumed && penTap){
    const p = penTap;
    penTap = null; drag = null; touchConsumed = false;
    handleCanvasClick(p.mx, p.my);
    return;
  }
  penTap = null; drag = null; touchConsumed = false;
}

canvas.addEventListener('pointerdown', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (e.pointerType === 'touch' && gesturesOn()){
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    touchPts.set(e.pointerId, { x: mx, y: my });
    touchDown.set(e.pointerId, { x: mx, y: my });
    hover = { mx, my };

    if (touchPts.size === 1){
      touchConsumed = false;
      if (pen.active || tool === 'point' || tool === 'text' || pickState) penTap = { mx, my };
      else {
        const hit = tool === 'move' ? hitTestObject(mx, my) : null;
        if (hit && !hit.virtual && (hit.type === 'point' || hit.type === 'text')){
          selectObject(hit.id);
          beginPointDrag(hit);
        } else {
          drag = { px:e.clientX, py:e.clientY, cx:state.view.cx, cy:state.view.cy, moved:false };
        }
      }
    } else {
      beginPinch();
    }
    requestRender();
    return;
  }

  canvas.setPointerCapture(e.pointerId);
  hover = { mx, my };

  if (pen.active || tool === 'point' || tool === 'text' || pickState || construct){ handleCanvasClick(mx, my); return; }

  /* 点住一个点对象 / 注释 → 拖着改坐标 */
  if (tool === 'move'){
    const hit = hitTestObject(mx, my);
    if (hit && !hit.virtual && (hit.type === 'point' || hit.type === 'text')){
      selectObject(hit.id);
      beginPointDrag(hit);
      return;
    }
  }

  drag = { px:e.clientX, py:e.clientY, cx:state.view.cx, cy:state.view.cy, moved:false };
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (e.pointerType === 'touch' && gesturesOn() && touchPts.has(e.pointerId)){
    touchPts.set(e.pointerId, { x: mx, y: my });
    const d0 = touchDown.get(e.pointerId);
    if (tapCandidate && d0 && Math.hypot(mx - d0.x, my - d0.y) > TAP_MOVE) markGestureMoved();

    if (touchPts.size >= 2){ updatePinch(); return; }

    hover = { mx, my };
    if (dragPoint){ updatePointDrag(mx, my); return; }
    if (pen.active){
      pen.cursor = snapPoint(screenToWorld(mx, my));
      requestRender();
      updateHUD();
      return;
    }
    if (drag){
      state.view.cx = drag.cx - (e.clientX - drag.px) / state.view.scale;
      state.view.cy = drag.cy + (e.clientY - drag.py) / state.view.scale;
    }
    requestRender();
    updateHUD();
    return;
  }

  hover = { mx, my };

  if (dragPoint){ updatePointDrag(mx, my); return; }

  if (pen.active){
    pen.cursor = snapPoint(screenToWorld(mx, my));
    requestRender();
    updateHUD();
    return;
  }

  if (drag){
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    state.view.cx = drag.cx - dx / state.view.scale;
    state.view.cy = drag.cy + dy / state.view.scale;
  }

  requestRender();
  updateHUD();
});

function endDrag(e){
  if (e.pointerType === 'touch' && gesturesOn() &&
      (touchPts.has(e.pointerId) || pinch)){
    endTouchPointer(e);
    return;
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  if (dragPoint){ endPointDrag(); return; }
  if (pen.active){ drag = null; return; }
  if (drag){
    const wasClick = !drag.moved && !pickState && tool === 'move';
    drag = null;
    canvas.style.cursor = 'crosshair';
    if (wasClick){
      const rect = canvas.getBoundingClientRect();
      identifyAt(e.clientX - rect.left, e.clientY - rect.top);
    }
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', e => {
  if (e.pointerType === 'touch' && gesturesOn()){
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    touchPts.delete(e.pointerId);
    touchDown.delete(e.pointerId);
    if (touchPts.size === 0) clearTouch();
    return;
  }
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  drag = null;
});

canvas.addEventListener('pointerleave', e => {
  if (e.pointerType === 'touch') return;
  hover = null;
  if (!pen.active) drag = null;
  requestRender();
  updateHUD();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const unit = e.deltaMode === 1 ? 0.045 : 0.0018;
  zoomAt(mx, my, Math.exp(-e.deltaY * unit));
}, { passive:false });

function zoomAt(mx, my, factor){
  const { cx, cy, scale } = state.view;
  const bx = (mx - W/2)/scale + cx;
  const by = cy - (my - H/2)/scale;
  const ns = Math.min(Math.max(scale * factor, 0.4), 4000);
  state.view.scale = ns;
  state.view.cx = bx - (mx - W/2)/ns;
  state.view.cy = by + (my - H/2)/ns;
  requestRender();
  updateHUD();
}

document.querySelector('.zoombar').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const mode = btn.dataset.zoom;
  if (mode === 'reset'){
    state.view.cx = 0; state.view.cy = 0; state.view.scale = 56;
  } else {
    zoomAt(W/2, H/2, mode === 'in' ? 1.25 : 0.8);
    return;
  }
  requestRender();
  updateHUD();
});

/* ═══════════════════════════════════════════════════
   16. 导出 / 导入
   ═══════════════════════════════════════════════════ */

function exportJSON(){
  const data = {
    version: 5,
    app: 'function-plot',
    exported: new Date().toISOString(),
    view: {
      cx: +state.view.cx.toFixed(6),
      cy: +state.view.cy.toFixed(6),
      scale: +state.view.scale.toFixed(4),
    },
    settings: {
      showGrid: state.settings.showGrid,
      showTicks: state.settings.showTicks,
      autoInter: !!state.settings.autoInter,
      snap: !!state.settings.snap,
      snapStep: state.settings.snapStep,
      alignMode: state.settings.alignMode === 'pointer' ? 'pointer' : 'grid',
      axisX: state.settings.axisX,
      axisY: state.settings.axisY,
      gestures: !!state.settings.gestures,
    },
    pointTable: {
      color: state.pointTable.color,
      visible: state.pointTable.visible,
      points: state.pointTable.points
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        .map(p => ({ x: p.x, y: p.y })),
    },
    functions: state.funcs.map(f => ({
      type: f.type,
      label: f.label,
      expr: f.expr,
      color: f.color,
      width: f.width,
      obj: f.obj || null,
      pts: f.pts || null,
      measure: f.measure || null,
      visible: f.visible,
      source: f.source,
      /* 注释：位置（坐标）和字体一起存档 */
      ...(f.type === 'text' ? { x: f.x, y: f.y, font: Object.assign({}, TEXT_DEFAULT, f.font || {}) } : {}),
    })),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `plot-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 · ' + data.functions.length + ' 条 · ' + data.pointTable.points.length + ' 点');
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch { toast('文件不是合法 JSON', 'error'); return; }
    if (!data || typeof data !== 'object'){ toast('文件结构不对', 'error'); return; }

    try {
      if (data.view && typeof data.view === 'object'){
        const cx = Number(data.view.cx);
        const cy = Number(data.view.cy);
        const sc = Number(data.view.scale);
        if (isFinite(cx)) state.view.cx = cx;
        if (isFinite(cy)) state.view.cy = cy;
        if (isFinite(sc) && sc > 0) state.view.scale = Math.min(4000, Math.max(0.4, sc));
      }

      if (data.settings && typeof data.settings === 'object'){
        const s = data.settings;
        if (typeof s.snap === 'boolean') state.settings.snap = s.snap;
        if (isFinite(Number(s.snapStep)) && Number(s.snapStep) > 0)
          state.settings.snapStep = Number(s.snapStep);
        if (typeof s.showGrid === 'boolean') state.settings.showGrid = s.showGrid;
        if (typeof s.showTicks === 'boolean') state.settings.showTicks = s.showTicks;
        if (typeof s.autoInter === 'boolean') state.settings.autoInter = s.autoInter;
        if (typeof s.snap === 'boolean') state.settings.snap = s.snap;
        if (s.snapStep > 0) state.settings.snapStep = s.snapStep;
        if (s.alignMode === 'pointer' || s.alignMode === 'grid') state.settings.alignMode = s.alignMode;
        if (typeof s.axisX === 'string') state.settings.axisX = s.axisX.slice(0, 16);
        if (typeof s.axisY === 'string') state.settings.axisY = s.axisY.slice(0, 16);
        if (typeof s.gestures === 'boolean') state.settings.gestures = s.gestures;
        syncSettingsUI();
      }

      /* 点表格 */
      if (data.pointTable && typeof data.pointTable === 'object'){
        const pt = data.pointTable;
        if (Array.isArray(pt.points)){
          state.pointTable.points = pt.points
            .filter(p => p && isFinite(Number(p.x)) && isFinite(Number(p.y)))
            .map(p => ({ x: Number(p.x), y: Number(p.y) }));
        }
        if (typeof pt.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(pt.color)){
          state.pointTable.color = pt.color;
        }
        if (typeof pt.visible === 'boolean'){
          state.pointTable.visible = pt.visible;
        }
        renderPointTable();
      }

      if (Array.isArray(data.functions)){
        state.funcs = [];
        for (const item of data.functions){
          if (!item) continue;
          const type = TYPES[item.type] ? item.type : 'y';
          let expr = item.expr;
          if (type === 'parametric' && item.expr2 && !String(expr).includes(',')){
            expr = String(expr) + ', ' + String(item.expr2);
          }
          if (typeof expr !== 'string') continue;
          const nf2 = addFunc(type, expr, item.source === 'pen' ? 'pen' : 'manual');
          if (typeof item.label === 'string' && /^[A-Za-z][A-Za-z0-9]?$/.test(item.label)){
            nf2.label = item.label;
          }
          if (typeof item.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(item.color)){
            nf2.color = item.color;
          }
          if (isFinite(Number(item.width))) nf2.width = Math.min(6, Math.max(1, Number(item.width)));
          if (Array.isArray(item.pts)) nf2.pts = item.pts.map(Number).filter(isFinite);
          if (item.measure === 'length' || item.measure === 'angle') nf2.measure = item.measure;
          if (nf2.type === 'poly') recompile(nf2);
          if (item.obj && typeof item.obj === 'object'){
            nf2.obj = { kind: item.obj.kind === 'line' ? 'line' : 'segment', a: item.obj.a, b: item.obj.b };
          }
          if (item.visible === false){ nf2.visible = false; nf2.alpha = 0; }
        }
        if (state.funcs.length === 0) addFunc('y', '', 'manual', 0);
      }

      pen.pending = null;
      pen.cursor = null;

      renderList(); requestRender(); updateHUD(); updatePenBadge();
      toast('导入成功 · ' + state.funcs.length + ' 条 · ' + state.pointTable.points.length + ' 点');
    } catch(e){
      toast('导入出错：' + e.message, 'error');
    }
  };
  reader.onerror = () => toast('读文件失败', 'error');
  reader.readAsText(file);
}

function syncSettingsUI(){
  document.getElementById('swSnap').classList.toggle('on', state.settings.snap);
  document.getElementById('swSnap').setAttribute('aria-checked', String(state.settings.snap));
  document.getElementById('swGrid').classList.toggle('on', state.settings.showGrid);
  document.getElementById('swGrid').setAttribute('aria-checked', String(state.settings.showGrid));
  document.getElementById('swTicks').classList.toggle('on', state.settings.showTicks);
  document.getElementById('swTicks').setAttribute('aria-checked', String(state.settings.showTicks));
  const swG = document.getElementById('swGestures');
  swG.classList.toggle('on', !!state.settings.gestures);
  swG.setAttribute('aria-checked', String(!!state.settings.gestures));
  const swI = document.getElementById('swInter');
  if (swI){
    swI.classList.toggle('on', state.settings.autoInter !== false);
    swI.setAttribute('aria-checked', String(state.settings.autoInter !== false));
  }
  axisLabelX.value = state.settings.axisX;
  axisLabelY.value = state.settings.axisY;
  syncAlignUI();
}

document.getElementById('exportBtn').addEventListener('click', exportJSON);

const fileInput = document.getElementById('fileInput');
document.getElementById('importBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (file) importJSON(file);
  fileInput.value = '';
});

/* ═══════════════════════════════════════════════════
   16b. 外壳：工具 / 表格区 / 顶栏
   ═══════════════════════════════════════════════════ */

let tool = 'move';                 /* move | point | segment */
const TOOL_NAMES = { move:'移动', point:'点', segment:'线段', text:'注释' };

function syncToolUI(){
  document.querySelectorAll('.tool[data-tool]').forEach(b => {
    const on = b.dataset.tool === tool;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.tool[data-construct]').forEach(b => {
    const on = !!(construct && construct.key === b.dataset.construct);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const g = document.getElementById('toolGrid');
  const t = document.getElementById('toolTicks');
  if (g){
    g.classList.toggle('on', !!state.settings.showGrid);
    g.setAttribute('aria-pressed', String(!!state.settings.showGrid));
  }
  if (t){
    t.classList.toggle('on', !!state.settings.showTicks);
    t.setAttribute('aria-pressed', String(!!state.settings.showTicks));
  }
}

function setTool(name, quiet){
  tool = (name === 'point' || name === 'segment' || name === 'text') ? name : 'move';
  const wasSegment = pen.active;
  setPenActive(tool === 'segment');
  if (tool !== 'segment'){ pen.pending = null; pen.cursor = null; }
  if ((tool === 'point' || tool === 'text') && !state.settings.snap){
    state.settings.snap = true;
    syncSettingsUI();
  }
  canvas.style.cursor = tool === 'point' ? 'copy' : (tool === 'segment' ? 'cell' : (tool === 'text' ? 'text' : 'crosshair'));
  syncToolUI();
  updatePenBadge();
  requestRender();
  updateHUD();
  if (!quiet && tool !== 'move' && !(tool === 'segment' && wasSegment))
    toast(TOOL_NAMES[tool] + '：' + (tool === 'point' ? '点一下放一个点'
        : tool === 'text' ? '点一下放一段注释' : '点两下画线段'));
}

/* 画布上的单击按当前工具分派 */
function handleCanvasClick(mx, my){
  if (pickState){ doPick(mx, my); return; }
  if (construct){
    const hit = hitTestObject(mx, my);
    if (!hit) toast('这里没有可以选的东西', 'error');
    else constructPick(hit);
    return;
  }
  if (tool === 'point'){ placePointAt(mx, my); return; }
  if (tool === 'text'){ placeTextAt(mx, my); return; }
  handlePenClick(mx, my);
}

function placePointAt(mx, my){
  const w = snapPoint(screenToWorld(mx, my));
  const f = addFunc('point', nf(w.x) + ', ' + nf(w.y), 'manual');
  renderList(f.id);
  requestRender();
  updateHUD();
  toast('点（' + nf(w.x) + ', ' + nf(w.y) + '）');
}

/* ── 注释对象：文字 + 坐标 + 颜色 + 字体 ── */
function addTextObj(x, y, text){
  const f = {
    id: ++uid,
    label: '', type: 'text',
    expr: text == null ? '注释' : String(text),
    color: state.funcs.length ? (state.funcs[state.funcs.length - 1].color || PALETTE[0]) : PALETTE[0],
    width: 2, visible: true, alpha: 1, source: 'manual',
    x: Number(x) || 0, y: Number(y) || 0,
    font: Object.assign({}, TEXT_DEFAULT),
  };
  state.funcs.push(f);
  recompile(f);
  return f;
}

function placeTextAt(mx, my){
  const w = snapPoint(screenToWorld(mx, my));
  const f = addTextObj(w.x, w.y);
  renderList(f.id);
  selectObject(f.id);
  requestRender();
  updateHUD();
  const inp = document.querySelector('.fn-row[data-id="' + f.id + '"] .fn-input');
  if (inp){ inp.focus(); inp.select(); }
  toast('注释放在（' + nf(w.x) + ', ' + nf(w.y) + '）· 右边能改颜色和字体');
}

/* 适应视图：把点、点表格和当前窗口里的函数值都框进来 */
function fitView(){
  const xs = [], ys = [];
  for (const f of state.funcs){
    if (!f.visible || !f.fn) continue;
    if (f.type === 'point'){
      try { const p = f.fn(); xs.push(p[0]); ys.push(p[1]); } catch(e){}
    }
  }
  for (const p of state.pointTable.points){
    if (isFinite(p.x)) xs.push(p.x);
    if (isFinite(p.y)) ys.push(p.y);
  }
  const { cx, scale } = state.view;
  const x0 = cx - W/2/scale, x1 = cx + W/2/scale;
  for (const f of state.funcs){
    if (!f.visible) continue;
    if (f.type === 'poly'){
      for (const p of vertexPoints(f)){ xs.push(p.x); ys.push(p.y); }
      continue;
    }
    if (!f.fn || f.type !== 'y' || f.vertical) continue;
    for (let i = 0; i <= 40; i++){
      const x = x0 + (x1 - x0) * i / 40;
      let y;
      try { y = f.fn(x); } catch(e){ continue; }
      if (typeof y === 'number' && isFinite(y) && Math.abs(y) < 1e6){ xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < 2 || ys.length < 2){ toast('还没有能框进视图的东西'); return; }
  const pad = 0.12;
  const ax0 = Math.min(...xs), ax1 = Math.max(...xs);
  const ay0 = Math.min(...ys), ay1 = Math.max(...ys);
  const dx = Math.max(ax1 - ax0, 1e-6), dy = Math.max(ay1 - ay0, 1e-6);
  const sc = Math.min(W / (dx * (1 + pad * 2)), H / (dy * (1 + pad * 2)));
  state.view.scale = Math.min(4000, Math.max(0.4, sc));
  state.view.cx = (ax0 + ax1) / 2;
  state.view.cy = (ay0 + ay1) / 2;
  requestRender(); updateHUD();
  toast('已适应视图');
}

/* ── 表格区：点列表 / 数值表 ── */
let vtHighlight = null;            /* 数值表里点中的那一行 */
let tvTab = 'points';

function setTvTab(name){
  tvTab = (name === 'values') ? 'values' : 'points';
  document.querySelectorAll('.tv-tab').forEach(b => {
    const on = b.dataset.tab === tvTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  const pp = document.getElementById('tvPanePoints');
  const pv = document.getElementById('tvPaneValues');
  if (pp) pp.classList.toggle('hidden', tvTab !== 'points');
  if (pv) pv.classList.toggle('hidden', tvTab !== 'values');
  const tools = document.getElementById('tvPointsTools');
  if (tools) tools.classList.toggle('hidden', tvTab !== 'points');
  if (tvTab === 'values') renderValueTable();
  else vtHighlight = null;
  requestRender();
}

/* 数值表：当前窗口中心附近 9 组 x / f(x)，多个函数就是多列 */
function renderValueTable(){
  const head = document.getElementById('vtHead');
  const body = document.getElementById('vtBody');
  const empty = document.getElementById('vtEmpty');
  if (!head || !body) return;

  const live = state.funcs.filter(f => f.visible && f.fn && f.type === 'y' && !f.vertical);
  if (!live.length){
    head.innerHTML = '<th>#</th><th>x</th>';
    body.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  head.innerHTML = '<th>#</th><th>x</th>' + live.map(f =>
    `<th title="${esc(f.expr)}">${esc(f.label || (f.expr.length > 14 ? f.expr.slice(0, 13) + '…' : f.expr))}</th>`
  ).join('');

  const step = niceStep(state.view.scale, 88);
  const c = state.view.cx;
  const rows = [];
  for (let i = -4; i <= 4; i++){
    const x = c + i * step;
    rows.push(`<tr data-x="${x}">
      <td class="idx">${i + 5}</td>
      <td>${esc(fmtShort(x))}</td>
      ${live.map(f => {
        let y;
        try { y = f.fn(x); } catch(e){ y = NaN; }
        const ok = typeof y === 'number' && isFinite(y);
        return `<td>${ok ? esc(fmtShort(y)) : '—'}</td>`;
      }).join('')}
    </tr>`);
  }
  body.innerHTML = rows.join('');
  body.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const x = parseFloat(tr.dataset.x);
      if (!isFinite(x)) return;
      const on = vtHighlight && Math.abs(vtHighlight.x - x) < 1e-9;
      vtHighlight = on ? null : { x };
      body.querySelectorAll('tr').forEach(o => o.classList.toggle('on', o === tr && !on));
      requestRender();
    });
  });
}

/* 数值表选中的那一行，在图上画个标记 */
function drawVtHighlight(){
  if (!vtHighlight) return;
  const { cx, cy, scale } = state.view;
  const sx = (vtHighlight.x - cx) * scale + W/2;
  if (sx < -40 || sx > W + 40) return;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = CV.cross;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(sx) + .5, 0);
  ctx.lineTo(Math.round(sx) + .5, H);
  ctx.stroke();
  ctx.restore();

  for (const f of state.funcs){
    if (!f.visible || !f.fn || f.type !== 'y' || f.vertical) continue;
    let y;
    try { y = f.fn(vtHighlight.x); } catch(e){ continue; }
    if (typeof y !== 'number' || !isFinite(y)) continue;
    const sy = H/2 - (y - cy) * scale;
    if (sy < -20 || sy > H + 20) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.4, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = CV.bg1;
    ctx.stroke();
  }
}

/* ── 顶栏按钮 ── */
document.getElementById('themeBtn').addEventListener('click', () => {
  const i = THEMES.indexOf(currentTheme());
  setTheme(THEMES[(i + 1) % THEMES.length]);
});
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

(function bindToolbar(){
  const bar = document.getElementById('toolbar');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    if (btn.dataset.tool){ setTool(btn.dataset.tool); return; }
    if (btn.dataset.construct){ startConstruct(btn.dataset.construct); return; }
    const z = btn.dataset.zoom;
    if (z === 'in') zoomAt(W/2, H/2, 1.25);
    else if (z === 'out') zoomAt(W/2, H/2, 0.8);
    else if (z === 'fit') fitView();
  });
})();

document.getElementById('toolGrid').addEventListener('click', () => {
  state.settings.showGrid = !state.settings.showGrid;
  syncSettingsUI(); syncToolUI(); requestRender(); updateHUD();
});
document.getElementById('toolTicks').addEventListener('click', () => {
  state.settings.showTicks = !state.settings.showTicks;
  syncSettingsUI(); syncToolUI(); requestRender(); updateHUD();
});

/* ── 表格区收起 / 展开 ── */
const TV_KEY = 'plot-table';

(function bindTableView(){
  document.querySelectorAll('.tv-tab').forEach(b =>
    b.addEventListener('click', () => setTvTab(b.dataset.tab)));
  const tv = document.getElementById('tableView');
  const tg = document.getElementById('tvToggle');
  if (!tv || !tg) return;

  const apply = (collapsed, save) => {
    tv.classList.toggle('collapsed', !!collapsed);
    tg.setAttribute('aria-expanded', String(!collapsed));
    tg.setAttribute('aria-label', collapsed ? '展开表格区' : '收起表格区');
    if (save !== false){ try { localStorage.setItem(TV_KEY, collapsed ? 'closed' : 'open'); } catch(e){} }
    requestRender();
  };
  tg.addEventListener('click', () => apply(!tv.classList.contains('collapsed')));

  let saved = null;
  try { saved = localStorage.getItem(TV_KEY); } catch(e){}
  /* 手机屏幕窄：没选过就默认收起，把地方留给画布 */
  apply(saved ? saved === 'closed' : innerWidth <= 880, false);
})();

/* ── 左侧栏收起 / 展开 ── */
const PANEL_KEY = 'plot-panel';

function setPanelCollapsed(on, save){
  const ws = document.querySelector('.workspace');
  const btn = document.getElementById('panelToggle');
  if (!ws) return;
  ws.classList.toggle('panel-collapsed', !!on);
  if (btn){
    btn.setAttribute('aria-pressed', String(!!on));
    btn.title = on ? '展开左侧栏' : '收起左侧栏';
  }
  if (save !== false){ try { localStorage.setItem(PANEL_KEY, on ? 'closed' : 'open'); } catch(e){} }
}

(function initPanel(){
  const btn = document.getElementById('panelToggle');
  if (!btn) return;
  let saved = null;
  try { saved = localStorage.getItem(PANEL_KEY); } catch(e){}
  setPanelCollapsed(saved === 'closed', false);
  btn.addEventListener('click', () => {
    const on = !document.querySelector('.workspace').classList.contains('panel-collapsed');
    setPanelCollapsed(on);
  });
})();

/* ═══════════════════════════════════════════════════
   16c. ☰ 菜单 / 导出 CSV·LaTeX / 更多 811 工具
   ═══════════════════════════════════════════════════ */

const menuPop = document.getElementById('menuPop');
const menuBtn = document.getElementById('menuBtn');

function openMenu(){
  const r = menuBtn.getBoundingClientRect();
  menuPop.style.left = Math.max(8, Math.min(r.left, innerWidth - 214)) + 'px';
  menuPop.style.top = (r.bottom + 6) + 'px';
  menuPop.classList.add('show');
  menuBtn.setAttribute('aria-expanded', 'true');
  const first = menuPop.querySelector('.menu-item');
  if (first) first.focus();
}
function closeMenu(){
  menuPop.classList.remove('show');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (menuPop.classList.contains('show')) closeMenu(); else openMenu();
});
document.addEventListener('click', e => {
  if (menuPop.classList.contains('show') && !menuPop.contains(e.target)) closeMenu();
});

menuPop.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('.menu-item') : null;
  if (!b) return;
  closeMenu();
  const act = b.dataset.act;
  if (act === 'new') newPlot();
  else if (act === 'open') fileInput.click();
  else if (act === 'save') exportJSON();
  else if (act === 'shot') openShot();
  else if (act === 'share') copyShareLink();
  else if (act === 'more') openTools();
  else if (act === 'help') showHelp();
});

function newPlot(){
  state.funcs = [];
  addFunc('y', '', 'manual', 0);
  state.pointTable.points = [];
  state.view.cx = 0; state.view.cy = 0; state.view.scale = 56;
  pen.pending = null; pen.cursor = null;
  vtHighlight = null;
  renderList(); renderPointTable(); requestRender(); updateHUD(); updatePenBadge();
  toast('已新建');
}

function copyShareLink(){
  const url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(() => toast('链接已复制'),
      () => toast('复制失败，从地址栏拿一下', 'error'));
  } else {
    toast('复制失败，从地址栏拿一下', 'error');
  }
}

function showHelp(){
  openHelp();
}

/* ── 帮助浮窗 ── */
const helpModal = document.getElementById('helpModal');
let helpLastFocus = null;

function openHelp(){
  if (!helpModal) return;
  helpLastFocus = document.activeElement;
  helpModal.classList.add('show');
  const c = document.getElementById('helpClose');
  if (c) requestAnimationFrame(() => c.focus());
}
function closeHelp(){
  if (!helpModal || !helpModal.classList.contains('show')) return;
  helpModal.classList.remove('show');
  if (helpLastFocus && helpLastFocus.focus) helpLastFocus.focus();
}
(function bindHelp(){
  if (!helpModal) return;
  document.getElementById('helpClose').addEventListener('click', closeHelp);
  helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
})();

/* ── 导出：CSV / LaTeX ── */
function objectsForExport(){
  const rows = [];
  for (const f of state.funcs){
    if (f.type === 'poly'){
      if ((f.pts || []).length >= 3) rows.push({ kind:'polygon', expr: polyVerticesText(f), color: f.color, visible: f.visible });
      continue;
    }
    if (!f.expr || !f.expr.trim()) continue;
    rows.push({ kind: f.type, expr: f.expr, color: f.color, visible: f.visible });
  }
  state.pointTable.points.forEach(p => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y))
      rows.push({ kind:'point', expr: '(' + p.x + ', ' + p.y + ')', color: state.pointTable.color, visible: true });
  });
  return rows;
}
function downloadFile(name, text, mime){
  downloadBlob(name, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
}
const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function exportCSV(){
  const rows = objectsForExport();
  if (!rows.length){ toast('还没有可导出的内容', 'error'); return; }
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = ['kind,expression,color,visible'];
  for (const r of rows) lines.push([r.kind, r.expr, r.color, r.visible].map(q).join(','));
  downloadFile('plot-' + fileStamp() + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('已导出 CSV · ' + rows.length + ' 行');
}

function texify(expr){
  let s = String(expr);
  s = s.replace(/\b(arcsin|arccos|arctan|asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|ln|log|exp|abs|min|max)\b(?=\s*\()/g, '\\$1');
  s = s.replace(/sqrt\s*\(/g, '\\sqrt{');
  s = s.replace(/\bpi\b/g, '\\pi');
  s = s.replace(/\btau\b/g, '2\\pi');
  s = s.replace(/\*/g, ' \\cdot ');
  s = s.replace(/<=/g, ' \\le ').replace(/>=/g, ' \\ge ');
  s = s.replace(/([A-Za-z0-9)\]])\s*\^\s*\(([^()]*)\)/g, '$1^{$2}');
  s = s.replace(/([A-Za-z0-9)\]])\s*\^\s*(-?[A-Za-z0-9.]+)/g, '$1^{$2}');
  return s.replace(/\s+/g, ' ').trim();
}

function exportTeX(){
  const rows = objectsForExport();
  if (!rows.length){ toast('还没有可导出的内容', 'error'); return; }
  const out = rows.map(r => {
    if (r.kind === 'parametric'){
      const p = splitTopLevel(r.expr);
      return '\\left( ' + texify(p[0] || '') + ',\\; ' + texify(p[1] || '') + ' \\right)';
    }
    if (r.kind === 'point') return String(r.expr);
    return texify(r.expr);
  });
  const text = '\\begin{aligned}\n' + out.map(s => s + ' \\\\').join('\n') + '\n\\end{aligned}\n';
  downloadFile('plot-' + fileStamp() + '.tex', text, 'text/x-tex;charset=utf-8');
  toast('已导出 LaTeX · ' + rows.length + ' 条');
}

/* ── 更多 811 工具 ── */
const toolsModal = document.getElementById('toolsModal');
let toolsLastFocus = null;
let toolsLoaded = false;

function openTools(){
  toolsLastFocus = document.activeElement;
  toolsModal.classList.add('show');
  load811Tools();
  const c = document.getElementById('toolsClose');
  if (c) requestAnimationFrame(() => c.focus());
}
function closeTools(){
  if (!toolsModal.classList.contains('show')) return;
  toolsModal.classList.remove('show');
  if (toolsLastFocus && toolsLastFocus.focus) toolsLastFocus.focus();
}
document.getElementById('more811Btn').addEventListener('click', openTools);
document.getElementById('toolsClose').addEventListener('click', closeTools);
toolsModal.addEventListener('click', e => { if (e.target === toolsModal) closeTools(); });
document.getElementById('expJson').addEventListener('click', exportJSON);
document.getElementById('expCsv').addEventListener('click', exportCSV);
document.getElementById('expTex').addEventListener('click', exportTeX);
document.getElementById('expShot').addEventListener('click', () => { closeTools(); openShot(); });
document.getElementById('impBtn').addEventListener('click', () => fileInput.click());

/* 工具清单走站点统一的 /lib/manifest.js，不自己解析 */
function load811Tools(){
  const grid = document.getElementById('toolsGrid');
  const empty = document.getElementById('toolsEmpty');
  if (!grid || toolsLoaded) return;
  const M = window.JSManifest;
  if (!M || !M.loadCollection){
    if (empty) empty.classList.remove('hidden');
    return;
  }
  toolsLoaded = true;
  M.loadCollection('/811/tools.json', { collection: '811' }).then(col => {
    if (!col.ok || !col.items.length){
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    const here = location.pathname;
    grid.innerHTML = col.items.map(it => {
      const cur = it.href === here;
      const icon = M.iconSvg ? M.iconSvg(it.icon, 1.8) : '';
      const open = '<span class="tc-ico">' + icon + '</span>';
      const body = '<span class="tc-txt"><span class="tc-t">' + esc(it.title) +
        (cur ? ' · 就在这页' : '') + '</span><span class="tc-d">' + esc(it.desc || '') + '</span></span>';
      return cur
        ? '<div class="tool-card cur" aria-current="page">' + open + body + '</div>'
        : '<a class="tool-card" href="' + it.href + '">' + open + body + '</a>';
    }).join('');
  }).catch(() => { if (empty) empty.classList.remove('hidden'); });
}

/* ═══════════════════════════════════════════════════
   16d. 输入栏：f(x)=… / If(…) / Curve(…)
   ═══════════════════════════════════════════════════ */

const inputBar = document.getElementById('inputBar');
const ibInput = document.getElementById('ibInput');

/* 自动猜类型；猜错了点行首的徽章换一个 */
function guessType(text){
  const s = String(text).trim();
  if (/^Curve\s*\(/i.test(s)) return 'parametric';
  const parts = splitTopLevel(s.replace(/^\((.*)\)$/s, '$1'));
  if (parts.length === 2){
    const l0 = freeLetters(parts[0]).length, l1 = freeLetters(parts[1]).length;
    if (!l0 && !l1) return 'point';
    if (l0 || l1) return 'parametric';
  }
  const sp = splitLHS(s);
  const body = sp ? sp.rhs : s;
  return freeLetters(body).length >= 2 ? 'implicit' : 'y';
}

function parseInput(text){
  const s = String(text).trim();
  if (!s) return { error: '写点什么再回车' };
  if (/^Curve\s*\(/i.test(s)) return { type:'parametric', expr:s };

  /* f(x) = …  /  g(u) = … */
  let m = s.match(/^([A-Za-z])\s*\(\s*([A-Za-z])\s*\)\s*=\s*([\s\S]+)$/);
  if (m) return { type:'y', expr:m[3].trim(), label:m[1] };

  /* A = (1, 2)：大写单字母当点 */
  m = s.match(/^([A-Z])\s*=\s*\(?\s*([^=]+?)\s*\)?$/);
  if (m && splitTopLevel(m[2]).length === 2) return { type:'point', expr:m[2], label:m[1] };

  return { type: guessType(s), expr: s };
}

function addFromInput(text){
  const p = parseInput(text);
  if (p.error) return { ok:false, error:p.error };

  const empty = state.funcs.find(f => !f.expr.trim());
  let f;
  if (empty){
    f = empty;
    f.type = p.type;
    f.expr = p.expr;
    if (p.label) f.label = p.label;
    recompile(f);
  } else {
    f = addFunc(p.type, p.expr, 'manual');
    if (p.label) f.label = p.label;
  }
  renderList(f.id);
  requestRender();
  updateHUD();
  return { ok:true, label:f.label, type:f.type, error:f.error };
}

function submitInput(){
  const text = (ibInput.value || '').trim();
  if (!text){ ibInput.focus(); return; }
  const r = addFromInput(text);
  if (!r.ok){ toast(r.error, 'error'); return; }
  ibInput.value = '';
  if (r.error) toast('语法有问题：' + r.error, 'error');
  else toast('已加入 ' + (r.label ? r.label + ' · ' : '') + TYPES[r.type].label);
  ibInput.focus();
}

if (inputBar){
  inputBar.addEventListener('submit', e => { e.preventDefault(); submitInput(); });
  ibInput.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ e.stopPropagation(); ibInput.value = ''; ibInput.blur(); }
  });
}

/* ── 绘图区右键菜单（显示/隐藏网格、坐标轴…） ── */
const ctxMenu = document.getElementById('ctxMenu');

function openCtxMenu(x, y){
  ctxMenu.querySelectorAll('.menu-item.check').forEach(b => {
    const key = b.dataset.act === 'grid' ? 'showGrid' : 'showTicks';
    b.setAttribute('aria-checked', String(!!state.settings[key]));
  });
  ctxMenu.style.left = Math.max(8, Math.min(x, innerWidth - 190)) + 'px';
  ctxMenu.style.top = Math.max(8, Math.min(y, innerHeight - 190)) + 'px';
  ctxMenu.classList.add('show');
}
function closeCtxMenu(){ ctxMenu.classList.remove('show'); }

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  e.stopPropagation();
  closeMenu();
  openCtxMenu(e.clientX, e.clientY);
});
/* 左键（真的左键）在菜单外按下才关；右键紧随的合成 click 不会把它关掉 */
document.addEventListener('pointerdown', e => {
  if (ctxMenu.classList.contains('show') && e.button === 0 && !ctxMenu.contains(e.target))
    closeCtxMenu();
}, true);
document.addEventListener('scroll', () => closeCtxMenu(), true);
window.addEventListener('blur', () => { closeCtxMenu(); closeMenu(); });

ctxMenu.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('.menu-item') : null;
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'grid') state.settings.showGrid = !state.settings.showGrid;
  else if (act === 'ticks') state.settings.showTicks = !state.settings.showTicks;
  else if (act === 'fit') fitView();
  else if (act === 'reset'){ state.view.cx = 0; state.view.cy = 0; state.view.scale = 56; }
  else if (act === 'axes'){ closeCtxMenu(); openSettings(); return; }
  else if (act === 'shot'){ closeCtxMenu(); openShot(); return; }
  syncSettingsUI(); syncToolUI(); requestRender(); updateHUD();
  if (act === 'grid' || act === 'ticks') openCtxMenu(parseFloat(ctxMenu.style.left), parseFloat(ctxMenu.style.top));
  else closeCtxMenu();
});

/* 现成的点：代数区里的点对象 + 点表格里的行 */
function pointChoices(){
  const out = [];
  for (const f of state.funcs){
    if (f.type !== 'point' || !f.fn) continue;
    let p = null;
    try { p = f.fn(); } catch(e){}
    if (p && isFinite(p[0]) && isFinite(p[1]))
      out.push('<option value="' + p[0] + ',' + p[1] + '">' +
        esc((f.label || '点') + ' = (' + nf(p[0]) + ', ' + nf(p[1]) + ')') + '</option>');
  }
  state.pointTable.points.forEach((p, i) => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y))
      out.push('<option value="' + p.x + ',' + p.y + '">点表格 #' + (i + 1) +
        ' = (' + nf(p.x) + ', ' + nf(p.y) + ')</option>');
  });
  return out.join('');
}

/* 一条对象的显示写法：f(x) = x^2 / A = (1, 2) */
function displayExpr(f){
  if (!f) return '';
  if (f.type === 'point') return (f.label || 'A') + ' = (' + f.expr + ')';
  if (f.type === 'poly') return (f.label || 'poly') + ' = ' + polyVerticesText(f);
  const lab = labelText(f);
  return lab ? lab + ' ' + f.expr : f.expr;
}

/* ═══════════════════════════════════════════════════
   16e. 图上取点 / 点一下认对象
   ═══════════════════════════════════════════════════ */

let pickState = null;

function updatePickBadge(){
  const b = document.getElementById('pickBadge');
  if (!b) return;
  if (!pickState){ b.classList.remove('show'); return; }
  b.classList.add('show');
  const t = document.getElementById('pickBadgeText');
  if (t) t.textContent = '点一下图上的' + pickState.label;
}

function startPick(label, onPick){
  pickState = { label, onPick };
  if (formulaModal.classList.contains('show')) closeFormula();
  if (tool !== 'move') setTool('move', true);
  pen.pending = null;
  updatePickBadge();
  requestRender();
  toast('在图上点一下' + label + '（Esc 取消）');
}

function doPick(mx, my){
  const st = pickState;
  pickState = null;
  updatePickBadge();
  if (!st) return;
  const w = snapPoint(screenToWorld(mx, my));
  try { st.onPick(w.x, w.y); } catch(e){}
  requestRender();
  updateHUD();
}

function reopenFormula(){ openFormula(); }

/* 点一下认对象：曲线 → 高亮代数区那一行并报出表达式；点 → 报坐标 */
function identifyAt(mx, my){
  const hit = hitTestObject(mx, my);
  if (!hit){ clearRowFlash(); return; }
  if (hit.virtual) toast('点表格 #' + (hit.index + 1) + ' = (' + nf(hit.x) + ', ' + nf(hit.y) + ')');
  else { toast(displayExpr(hit)); flashRow(hit.id); selectObject(hit.id); }
}

function flashRow(id){
  const row = document.querySelector('.fn-row[data-id="' + id + '"]');
  if (!row) return;
  clearRowFlash();
  row.classList.add('flash');
  if (row.scrollIntoView) row.scrollIntoView({ block:'nearest', behavior: prefersReduced.matches ? 'auto' : 'smooth' });
  clearTimeout(flashRow._t);
  flashRow._t = setTimeout(() => row.classList.remove('flash'), 1500);
}
function clearRowFlash(){
  document.querySelectorAll('.fn-row.flash').forEach(r => r.classList.remove('flash'));
}

function hitTestObject(mx, my){
  const tol = 10;
  /* 注释的画在最上层，先测它 */
  for (let i = state.funcs.length - 1; i >= 0; i--){
    const f = state.funcs[i];
    if (f.type !== 'text' || !f.visible) continue;
    const b = textBox(f);
    if (mx >= b.left && mx <= b.left + b.w && my >= b.top && my <= b.top + b.h) return f;
  }
  for (let i = state.funcs.length - 1; i >= 0; i--){
    const f = state.funcs[i];
    if (!f.visible || !f.fn || f.type !== 'point') continue;
    let p; try { p = f.fn(); } catch(e){ continue; }
    if (!isFinite(p[0]) || !isFinite(p[1])) continue;
    if (Math.hypot(w2sX(p[0]) - mx, w2sY(p[1]) - my) <= tol + 2) return f;
  }
  for (let i = state.pointTable.points.length - 1; i >= 0; i--){
    const p = state.pointTable.points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (Math.hypot(w2sX(p.x) - mx, w2sY(p.y) - my) <= tol)
      return { virtual:true, index:i, x:p.x, y:p.y };
  }
  for (let i = state.funcs.length - 1; i >= 0; i--){
    const f = state.funcs[i];
    if (!f.visible || !f.fn || f.type === 'point') continue;
    if (curveDistance(f, mx, my) <= tol) return f;
  }
  return null;
}

/* 曲线到屏幕上某点的最近距离（够近就算点中了） */
function curveDistance(f, mx, my){
  let best = Infinity;
  const consider = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    const d = Math.hypot(w2sX(x) - mx, w2sY(y) - my);
    if (d < best) best = d;
  };
  const { cx, cy, scale } = state.view;
  if (f.type === 'y'){
    if (f.vertical){
      for (let i = 0; i <= 80; i++){
        const y = cy - H/2/scale + (H/scale) * i / 80;
        let x; try { x = f.fn(y); } catch(e){ continue; }
        consider(x, y);
      }
    } else {
      for (let i = 0; i <= 200; i++){
        const x = cx - W/2/scale + (W/scale) * i / 200;
        let y; try { y = f.fn(x); } catch(e){ continue; }
        consider(x, y);
      }
    }
  } else if (f.type === 'polar' || f.type === 'parametric'){
    const t0 = isFinite(f.t0) ? f.t0 : 0, t1 = isFinite(f.t1) ? f.t1 : Math.PI * 2;
    for (let i = 0; i <= 300; i++){
      const t = t0 + (t1 - t0) * i / 300;
      let x, y;
      try {
        if (f.type === 'polar'){ const r = f.fn(t); x = r * Math.cos(t); y = r * Math.sin(t); }
        else { x = f.fn[0](t); y = f.fn[1](t); }
      } catch(e){ continue; }
      consider(x, y);
    }
  } else if (f.type === 'implicit'){
    for (let sx = Math.max(0, mx - 70); sx <= Math.min(W, mx + 70); sx += 8){
      for (let sy = Math.max(0, my - 70); sy <= Math.min(H, my + 70); sy += 8){
        let v; try { v = f.fn(s2wX(sx), s2wY(sy)); } catch(e){ continue; }
        if (typeof v === 'number' && Math.abs(v) < 0.4) consider(s2wX(sx), s2wY(sy));
      }
    }
  }
  return best;
}

/* ═══════════════════════════════════════════════════
   16f. 对象：选中 / 属性面板 / 图上拖点 / 撤销重做
   ═══════════════════════════════════════════════════ */

/* 用 var：renderList 在脚本前半段就会跑，那时这个绑定还没初始化（TDZ） */
var selectedId = null;
let dragPoint = null;

function findObj(id){ return state.funcs.find(f => f.id === id) || null; }

function pointOf(f){
  if (!f || f.type !== 'point' || !f.fn) return null;
  try {
    const p = f.fn();
    return (isFinite(p[0]) && isFinite(p[1])) ? { x:p[0], y:p[1] } : null;
  } catch(e){ return null; }
}

/* 派生对象记住「来源」，来源一动就重算表达式。
   changedId 给定时只算跟它有关的（拖点时用，免得每帧都去解交点）。 */
function setDerivedExpr(f, expr){
  if (expr == null || expr === f.expr) return;
  f.expr = expr;
  recompile(f);
  const inp = document.querySelector('.fn-row[data-id="' + f.id + '"] .fn-input');
  if (inp && document.activeElement !== inp) inp.value = f.expr;
}

function refreshDerived(changedId){
  const P = id => pointOf(findObj(id));
  for (const f of state.funcs){
    const o = f.obj;
    if (!o || !o.kind) continue;
    const srcs = [o.a, o.b, o.p, o.line].filter(v => v != null);
    if (changedId != null && !srcs.includes(changedId)) continue;
    try {
      if (o.kind === 'seg' || o.kind === 'segment' || o.kind === 'line'){
        const A = P(o.a), B = P(o.b);
        if (!A || !B) continue;
        setDerivedExpr(f, lineFromPoints(A, B, o.kind === 'line'));
      } else if (o.kind === 'mid'){
        const A = P(o.a), B = P(o.b);
        if (!A || !B) continue;
        setDerivedExpr(f, nf((A.x + B.x) / 2) + ', ' + nf((A.y + B.y) / 2));
      } else if (o.kind === 'inter'){
        const c1 = findObj(o.a), c2 = findObj(o.b);
        if (!c1 || !c2) continue;
        const p = curveIntersections(c1, c2)[o.idx || 0];
        if (!p) continue;
        setDerivedExpr(f, nf(p.x) + ', ' + nf(p.y));
      } else if (o.kind === 'perp' || o.kind === 'para'){
        const p = P(o.p), c = findObj(o.line);
        if (!p || !c) continue;
        setDerivedExpr(f, normalOrParallel(p, c, o.kind === 'perp'));
      }
    } catch(e){}
  }
}

function selectObject(id){
  selectedId = (id == null) ? null : id;
  syncSelectionUI();
  requestRender();
}

function syncSelectionUI(){
  document.querySelectorAll('.fn-row').forEach(r => {
    r.classList.toggle('sel', String(selectedId) === r.dataset.id);
  });
  const panel = document.getElementById('propsPanel');
  if (!panel) return;
  const f = findObj(selectedId);
  if (!f){ panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const name = document.getElementById('propsName');
  if (name) name.textContent = displayExpr(f);
  const isText = f.type === 'text';
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('propsWidthRow', !isText);
  show('propsTextRow', isText);
  show('propsTextRow2', isText);
  show('propsPosRow', isText);
  if (isText){
    const font = Object.assign({}, TEXT_DEFAULT, f.font || {});
    const fs = document.getElementById('propsFontSize');
    if (fs) fs.value = String(font.size);
    const ff = document.getElementById('propsFontFamily');
    if (ff) ff.value = font.family;
    document.querySelectorAll('#propsFontStyle .seg-btn').forEach(b => {
      const on = !!font[b.dataset.style];
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const px = document.getElementById('propsX'), py = document.getElementById('propsY');
    if (px && document.activeElement !== px) px.value = String(+Number(f.x).toFixed(4));
    if (py && document.activeElement !== py) py.value = String(+Number(f.y).toFixed(4));
  }
  const w = document.getElementById('propsWidth');
  if (w) w.value = String(f.width || 2);
  const v = document.getElementById('propsVis');
  if (v){
    v.classList.toggle('on', f.visible !== false);
    v.setAttribute('aria-checked', String(f.visible !== false));
  }
  const colors = document.getElementById('propsColors');
  if (colors){
    colors.innerHTML = PALETTE.map(c =>
      '<button type="button" style="--c:' + c + '" data-color="' + c + '"' +
      (c === f.color ? ' class="on"' : '') + ' aria-label="换成 ' + c + '"></button>').join('');
  }
}

function deleteObject(id){
  const before = state.funcs.length;
  state.funcs = state.funcs.filter(x => x.id !== id);
  if (state.funcs.length === before) return;
  refreshDerived();
  if (state.funcs.length === 0) addFunc('y', '', 'manual', 0);
  if (selectedId === id) selectObject(null);
  renderList(); requestRender(); updateHUD(); updatePenBadge();
}

/* ── 图上拖点 ── */
function beginPointDrag(f){
  dragPoint = { id: f.id };
  canvas.style.cursor = 'grabbing';
  historyPaused = true;
}
function updatePointDrag(mx, my){
  const f = findObj(dragPoint.id);
  if (!f) return;
  const w = snapPoint(screenToWorld(mx, my));
  if (f.type === 'text'){
    /* 注释直接改坐标，不解析表达式 */
    f.x = w.x; f.y = w.y;
  } else {
    f.expr = nf(w.x) + ', ' + nf(w.y);
    recompile(f);
  }
  const inp = document.querySelector('.fn-row[data-id="' + f.id + '"] .fn-input');
  if (inp && document.activeElement !== inp) inp.value = f.expr;
  refreshDerived();
  syncSelectionUI();
  requestRender();
  updateHUD();
}
function endPointDrag(){
  if (!dragPoint) return;
  dragPoint = null;
  historyPaused = false;
  canvas.style.cursor = 'crosshair';
  renderList();
  syncSelectionUI();
  historyTick();
}

/* ── 撤销 / 重做：状态一变就打快照 ── */
/* 用 var 是为了 requestRender 在脚本初始化完前被调用时不炸（TDZ） */
var hist = { past: [], future: [], last: null };
var historyPaused = false;

function serializeObjects(){
  return JSON.stringify({
    functions: state.funcs.map(f => ({
      id: f.id, type: f.type, label: f.label, expr: f.expr,
      color: f.color, width: f.width, visible: f.visible !== false,
      source: f.source, obj: f.obj || null,
      pts: f.pts || null, measure: f.measure || null,
    })),
    points: state.pointTable.points,
    ptColor: state.pointTable.color,
  });
}

function historyTick(){
  if (!hist || !hist.past) return;
  if (historyPaused) return;
  const s = serializeObjects();
  if (hist.last === null){ hist.last = s; updateHistoryUI(); return; }
  if (s === hist.last) return;
  hist.past.push(hist.last);
  if (hist.past.length > 80) hist.past.shift();
  hist.last = s;
  hist.future.length = 0;
  updateHistoryUI();
}

function updateHistoryUI(){
  const u = document.getElementById('undoBtn');
  const r = document.getElementById('redoBtn');
  if (u) u.disabled = hist.past.length === 0;
  if (r) r.disabled = hist.future.length === 0;
}

function applySnapshot(s){
  const snap = JSON.parse(s);
  state.funcs = snap.functions.map(o => {
    const f = makeFunc(o.type, o.expr, o.source);
    f.id = o.id;
    f.label = o.label;
    f.color = o.color;
    f.width = o.width || 2;
    f.visible = o.visible !== false;
    f.alpha = f.visible ? 1 : 0;
    f.obj = o.obj || null;
    f.pts = Array.isArray(o.pts) ? o.pts.slice() : null;
    f.measure = o.measure || null;
    recompile(f);
    return f;
  });
  for (const f of state.funcs) uid = Math.max(uid, f.id || 0);
  state.pointTable.points = (snap.points || []).map(p => ({ x: p.x, y: p.y }));
  state.pointTable.color = snap.ptColor;
  if (!state.funcs.length) addFunc('y', '', 'manual', 0);
  selectedId = null;
  renderList(); renderPointTable(); syncSelectionUI();
  requestRender(); updateHUD(); updatePenBadge();
}

function undo(){
  historyTick();
  if (!hist.past.length) return;
  hist.future.push(hist.last);
  const s = hist.past.pop();
  hist.last = s;
  applySnapshot(s);
  updateHistoryUI();
  toast('已撤销');
}

function redo(){
  if (!hist.future.length) return;
  hist.past.push(hist.last);
  const s = hist.future.pop();
  hist.last = s;
  applySnapshot(s);
  updateHistoryUI();
  toast('已重做');
}

/* ── 属性面板接线 ── */
(function bindProps(){
  const panel = document.getElementById('propsPanel');
  if (!panel) return;
  panel.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('button[data-color]') : null;
    if (!b) return;
    const f = findObj(selectedId);
    if (!f) return;
    f.color = b.dataset.color;
    syncSelectionUI(); renderList(); requestRender();
  });
  const w = document.getElementById('propsWidth');
  if (w) w.addEventListener('input', () => {
    const f = findObj(selectedId);
    if (f){ f.width = parseFloat(w.value) || 2; requestRender(); }
  });
  const v = document.getElementById('propsVis');
  if (v){
    const toggle = () => {
      const f = findObj(selectedId);
      if (!f) return;
      const nv = f.visible === false;
      f.visible = nv;
      f.alpha = nv ? 1 : 0;
      syncSelectionUI(); renderList(); requestRender(); updateHUD();
    };
    v.addEventListener('click', toggle);
    v.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); toggle(); }
    });
  }
  const d = document.getElementById('propsDel');
  if (d) d.addEventListener('click', () => { if (selectedId != null) deleteObject(selectedId); });

  /* ── 注释专用：字号 / 字体 / 粗斜体 / 坐标 ── */
  const fs = document.getElementById('propsFontSize');
  if (fs) fs.addEventListener('input', () => {
    const f = findObj(selectedId);
    if (!f || f.type !== 'text') return;
    f.font = Object.assign({}, TEXT_DEFAULT, f.font || {}, { size: Math.min(96, Math.max(8, parseFloat(fs.value) || 15)) });
    requestRender();
  });
  const ff = document.getElementById('propsFontFamily');
  if (ff) ff.addEventListener('change', () => {
    const f = findObj(selectedId);
    if (!f || f.type !== 'text') return;
    f.font = Object.assign({}, TEXT_DEFAULT, f.font || {}, { family: ff.value });
    requestRender();
  });
  const fst = document.getElementById('propsFontStyle');
  if (fst) fst.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('.seg-btn') : null;
    const f = findObj(selectedId);
    if (!b || !f || f.type !== 'text') return;
    const key = b.dataset.style;
    const cur = Object.assign({}, TEXT_DEFAULT, f.font || {});
    cur[key] = !cur[key];
    f.font = cur;
    syncSelectionUI(); requestRender();
  });
  const tc = document.getElementById('propsTextColor');
  if (tc) tc.addEventListener('click', () => {
    const f = findObj(selectedId);
    if (!f || f.type !== 'text') return;
    const i = PALETTE.indexOf(f.color);
    f.color = PALETTE[(i + 1) % PALETTE.length];
    syncSelectionUI(); renderList(); requestRender();
  });
  ['propsX', 'propsY'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const f = findObj(selectedId);
      if (!f || f.type !== 'text') return;
      const v = parseFloat(el.value);
      if (!isFinite(v)) return;
      if (i === 0) f.x = v; else f.y = v;
      requestRender(); updateHUD();
    });
  });
  const c = document.getElementById('propsClose');
  if (c) c.addEventListener('click', () => selectObject(null));
})();

/* ═══════════════════════════════════════════════════
   16g. 几何构造：中点 / 交点 / 垂线 / 平行线 / 多边形 / 距离 / 角度
   ═══════════════════════════════════════════════════ */

var construct = null;          /* { key, picks:[id…] }，var 为了早绑定不炸 */

const CONSTRUCTS = {
  mid:   { need:2, open:false, hint:'点两个点，给你它们的中点' },
  inter: { need:2, open:false, hint:'点两条曲线，找它们的交点' },
  perp:  { need:2, open:false, hint:'先点一个点，再点一条曲线（作垂线）' },
  para:  { need:2, open:false, hint:'先点一个点，再点一条曲线（作平行线）' },
  poly:  { need:3, open:true,  hint:'依次点顶点（≥3 个），回车收尾' },
  dist:  { need:2, open:false, hint:'点两个点，量出距离' },
  angle: { need:3, open:false, hint:'依次点 A、顶点、C，量出夹角' },
};

/* ── 画多边形 / 标注 ── */
function vertexPoints(f){
  const out = [];
  for (const id of (f.pts || [])){
    const p = pointOf(findObj(id));
    if (p) out.push(p);
  }
  return out;
}
function polyPath(vs){
  ctx.beginPath();
  vs.forEach((p, i) => {
    const sx = w2sX(p.x), sy = w2sY(p.y);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}
function drawPolygon(f){
  const vs = vertexPoints(f);
  if (vs.length < 3) return;
  polyPath(vs);
  ctx.globalAlpha = 0.14 * f.alpha;
  ctx.fillStyle = f.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  polyPath(vs);
  strokeCurve(f);
}

function tagLabel(x, y, text, color){
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const tw = ctx.measureText(text).width;
  let bx = x + 12, by = y - 12;
  if (bx + tw + 12 > W) bx = x - tw - 18;
  if (by < 16) by = y + 22;
  ctx.fillStyle = CV.chip;
  ctx.fillRect(bx - 5, by - 11, tw + 11, 17);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx, by - 2);
}

function drawMeasure(f){
  ctx.globalAlpha = f.alpha;
  if (f.measure === 'length' && f.obj && f.obj.a != null){
    const A = pointOf(findObj(f.obj.a)), B = pointOf(findObj(f.obj.b));
    if (A && B){
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      tagLabel((w2sX(A.x) + w2sX(B.x)) / 2, (w2sY(A.y) + w2sY(B.y)) / 2,
        '|AB| = ' + fmtShort(len), f.color);
    }
  } else if (f.measure === 'angle' && f.pts && f.pts.length >= 3){
    const p1 = pointOf(findObj(f.pts[0]));
    const p2 = pointOf(findObj(f.pts[1]));
    const p3 = pointOf(findObj(f.pts[2]));
    if (p1 && p2 && p3){
      const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
      const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
      const den = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
      if (den > 0){
        let c = (v1.x * v2.x + v1.y * v2.y) / den;
        c = Math.max(-1, Math.min(1, c));
        tagLabel(w2sX(p2.x), w2sY(p2.y), '∠ = ' + fmtShort(Math.acos(c) * 180 / Math.PI) + '°', f.color);
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* ── 曲线采样 / 切线 / 交点 ── */
function sampleCurvePoints(f, n){
  const out = [];
  const { cx, cy, scale } = state.view;
  if (!f) return out;
  if (f.type === 'y'){
    if (f.vertical){
      for (let i = 0; i <= n; i++){
        const y = cy - H/2/scale + (H/scale) * i / n;
        let x; try { x = f.fn(y); } catch(e){ continue; }
        if (isFinite(x)) out.push({ x, y });
      }
    } else {
      for (let i = 0; i <= n; i++){
        const x = cx - W/2/scale + (W/scale) * i / n;
        let y; try { y = f.fn(x); } catch(e){ continue; }
        if (isFinite(y)) out.push({ x, y });
      }
    }
  } else if (f.type === 'polar' || f.type === 'parametric'){
    const t0 = isFinite(f.t0) ? f.t0 : 0, t1 = isFinite(f.t1) ? f.t1 : Math.PI * 2;
    for (let i = 0; i <= n; i++){
      const t = t0 + (t1 - t0) * i / n;
      let x, y;
      try {
        if (f.type === 'polar'){ const r = f.fn(t); x = r * Math.cos(t); y = r * Math.sin(t); }
        else { x = f.fn[0](t); y = f.fn[1](t); }
      } catch(e){ continue; }
      if (isFinite(x) && isFinite(y)) out.push({ x, y });
    }
  } else if (f.type === 'point'){
    const p = pointOf(f);
    if (p) out.push(p);
  } else if (f.type === 'implicit'){
    const x0 = cx - W/2/scale, y0 = cy - H/2/scale;
    const stepX = (W/scale) / 70, stepY = (H/scale) / 70;
    for (let i = 0; i <= 70; i++){
      for (let j = 0; j <= 70; j++){
        const x = x0 + i * stepX, y = y0 + j * stepY;
        let v; try { v = f.fn(x, y); } catch(e){ continue; }
        if (typeof v === 'number' && Math.abs(v) < 0.3) out.push({ x, y });
      }
    }
  }
  return out;
}

/* 靠近某点时曲线的切线斜率 dy/dx；竖直线返回 null */
function curveSlopeAt(curve, near){
  if (curve.type === 'y' && !curve.vertical){
    const h = 1e-4 * Math.max(1, W / state.view.scale);
    let y1, y2;
    try { y1 = curve.fn(near.x - h); y2 = curve.fn(near.x + h); } catch(e){ return null; }
    if (!isFinite(y1) || !isFinite(y2)) return null;
    return (y2 - y1) / (2 * h);
  }
  const pts = sampleCurvePoints(curve, 400);
  if (pts.length < 2) return null;
  let bi = -1, bd = Infinity;
  for (let i = 0; i < pts.length; i++){
    const d = Math.hypot(pts[i].x - near.x, pts[i].y - near.y);
    if (d < bd){ bd = d; bi = i; }
  }
  if (bi < 0) return null;
  const a = pts[Math.max(0, bi - 1)], b = pts[Math.min(pts.length - 1, bi + 1)];
  if (Math.abs(b.x - a.x) < 1e-12) return null;
  return (b.y - a.y) / (b.x - a.x);
}

function normalOrParallel(p, curve, isPerp){
  if (curve.type === 'y' && curve.vertical){
    return isPerp ? lineExprFromKB(0, p.y) : ('x=' + nf(p.x));
  }
  const k = curveSlopeAt(curve, p);
  if (k == null) return isPerp ? lineExprFromKB(0, p.y) : ('x=' + nf(p.x));
  if (isPerp){
    if (Math.abs(k) < 1e-9) return 'x=' + nf(p.x);
    const kn = -1 / k;
    return lineExprFromKB(kn, p.y - kn * p.x);
  }
  return lineExprFromKB(k, p.y - k * p.x);
}

function curveIntersections(f1, f2){
  if (!f1 || !f2) return [];
  const { cx, scale } = state.view;
  const diff = x => {
    let a, b;
    try { a = f1.fn(x); b = f2.fn(x); } catch(e){ return NaN; }
    return a - b;
  };
  const y1 = f1.type === 'y' && f1.fn && !f1.vertical;
  const y2 = f2.type === 'y' && f2.fn && !f2.vertical;
  if (y1 && y2){
    const x0 = cx - W/2/scale, x1 = cx + W/2/scale;
    const n = 600, out = [];
    let px = x0, pv = diff(px);
    for (let i = 1; i <= n; i++){
      const x = x0 + (x1 - x0) * i / n;
      const v = diff(x);
      if (isFinite(pv) && isFinite(v) && pv !== 0 && v !== 0 && pv * v < 0){
        let a = px, b = x, fa = pv;
        for (let k = 0; k < 50; k++){
          const m = (a + b) / 2, fm = diff(m);
          if (!isFinite(fm)) break;
          if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
        }
        const xr = (a + b) / 2;
        let yr; try { yr = f1.fn(xr); } catch(e){ yr = NaN; }
        if (isFinite(yr)) out.push({ x: xr, y: yr });
        if (out.length >= 8) break;
      }
      px = x; pv = v;
    }
    return out;
  }
  const A = sampleCurvePoints(f1, 300), B = sampleCurvePoints(f2, 300);
  const out = [];
  const tol = 7 / scale;
  for (const a of A){
    for (const b of B){
      if (Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol) continue;
      const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!out.some(q => Math.hypot(q.x - p.x, q.y - p.y) < tol * 2)) out.push(p);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/* ── 构造工具的状态机 ── */
function startConstruct(key){
  const spec = CONSTRUCTS[key];
  if (!spec) return;
  if (construct && construct.key === key){ cancelConstruct(); return; }
  if (pickState){ pickState = null; updatePickBadge(); }
  construct = { key, picks: [] };
  if (tool !== 'move') setTool('move', true);
  syncToolUI();
  updateConstructBadge();
  requestRender();
  toast(spec.hint);
}

function cancelConstruct(){
  if (!construct) return;
  construct = null;
  syncToolUI();
  updateConstructBadge();
  requestRender();
}

function updateConstructBadge(){
  const b = document.getElementById('pickBadge');
  if (!b) return;
  if (!construct){ b.classList.remove('show'); return; }
  b.classList.add('show');
  const spec = CONSTRUCTS[construct.key];
  const t = document.getElementById('pickBadgeText');
  if (t) t.textContent = spec.hint + '（' + construct.picks.length + '/' + spec.need + '）';
}

/* 画布 / 代数区里挑对象；挑够了就构造 */
function constructPick(hit){
  if (!construct || !hit || hit.virtual) return false;
  const f = findObj(hit.id);
  if (!f) return false;
  const key = construct.key;
  const idx = construct.picks.length;
  const wantPointFirst = (key === 'perp' || key === 'para');
  const twoCurves = (key === 'inter');
  if (twoCurves){
    if (f.type === 'point'){ toast('交点要选两条曲线', 'error'); return true; }
  } else if (wantPointFirst){
    if (idx === 0 && f.type !== 'point'){ toast('先点一个点', 'error'); return true; }
    if (idx === 1 && f.type === 'point'){ toast('再点一条曲线', 'error'); return true; }
  } else if (f.type !== 'point'){
    toast('这个工具要选点', 'error');
    return true;
  }
  if (construct.picks.includes(hit.id)) return true;
  construct.picks.push(hit.id);
  selectObject(hit.id);
  updateConstructBadge();
  const spec = CONSTRUCTS[key];
  if (!spec.open && construct.picks.length >= spec.need) buildConstruct();
  else requestRender();
  return true;
}

function buildConstruct(){
  const c = construct;
  if (!c) return;
  const spec = CONSTRUCTS[c.key];
  const ids = c.picks.slice();
  if (ids.length < spec.need){
    toast('还差 ' + (spec.need - ids.length) + ' 个');
    return;
  }
  construct = null;
  const P = id => pointOf(findObj(id));
  let made = null, msg = '已构造';
  try {
    if (c.key === 'mid'){
      const A = P(ids[0]), B = P(ids[1]);
      if (!A || !B) throw new Error('取不到这两个点');
      const m = addFunc('point', nf((A.x + B.x) / 2) + ', ' + nf((A.y + B.y) / 2), 'manual');
      m.color = PALETTE[4];
      m.obj = { kind:'mid', a: ids[0], b: ids[1] };
      made = m;
      msg = '中点 ' + (m.label || '') + ' 建好了（拖端点会跟着走）';
    } else if (c.key === 'inter'){
      const pts = curveIntersections(findObj(ids[0]), findObj(ids[1]));
      if (!pts.length) throw new Error('这两条曲线在这个范围里没有交点');
      let first = null;
      pts.slice(0, 4).forEach((p, i) => {
        const q = addFunc('point', nf(p.x) + ', ' + nf(p.y), 'manual');
        q.color = PALETTE[4];
        q.obj = { kind:'inter', a: ids[0], b: ids[1], idx: i };
        if (!first) first = q;
      });
      made = first;
      msg = '找到 ' + Math.min(4, pts.length) + ' 个交点';
    } else if (c.key === 'perp' || c.key === 'para'){
      const p = P(ids[0]), curve = findObj(ids[1]);
      if (!p || !curve) throw new Error('取不到点或曲线');
      const lf = addFunc('y', normalOrParallel(p, curve, c.key === 'perp'), 'manual');
      lf.color = PALETTE[2];
      lf.obj = { kind: c.key, p: ids[0], line: ids[1] };
      made = lf;
      msg = c.key === 'perp' ? '垂线画好了' : '平行线画好了';
    } else if (c.key === 'dist'){
      const A = P(ids[0]), B = P(ids[1]);
      if (!A || !B) throw new Error('取不到这两个点');
      const lf = addFunc('y', lineFromPoints(A, B, false), 'manual');
      lf.color = PALETTE[2];
      lf.obj = { kind:'seg', a: ids[0], b: ids[1] };
      lf.measure = 'length';
      made = lf;
      msg = '距离 = ' + fmtShort(Math.hypot(B.x - A.x, B.y - A.y));
    } else if (c.key === 'angle'){
      const poly = addFunc('poly', '', 'manual');
      poly.pts = ids.slice(0, 3);
      recompile(poly);
      poly.color = PALETTE[2];
      poly.width = 1.5;
      poly.measure = 'angle';
      made = poly;
      msg = '夹角标好了';
    } else if (c.key === 'poly'){
      const poly = addFunc('poly', '', 'manual');
      poly.pts = ids.slice();
      recompile(poly);
      poly.color = PALETTE[5];
      made = poly;
      msg = '多边形画好了（拖顶点会跟着变）';
    }
  } catch(e){
    toast(String((e && e.message) || e), 'error');
    syncToolUI();
    updateConstructBadge();
    requestRender();
    return;
  }
  syncToolUI();
  updateConstructBadge();
  if (made){ renderList(made.id); toast(msg); }
  requestRender(); updateHUD();
}

/* ═══════════════════════════════════════════════════
   16h. 导出图片：无 UI 截图（PNG / JPG / WebP）
   ═══════════════════════════════════════════════════ */

/* 选项是临时的：不进 localStorage、不进导出的 JSON */
var shotOpts = { format:'png', scale:2, grid:true, axes:true, bg:'theme', quality:0.92 };

function shotPreset(kind){
  if (kind === 'image'){ shotOpts.grid = false; shotOpts.axes = false; shotOpts.bg = 'transparent'; }
  else { shotOpts.grid = true; shotOpts.axes = true; shotOpts.bg = 'theme'; }
  syncShotUI();
}

/* 从 <style> 里抠出三套主题的 --plot-*：导成纯白/纯黑底时要配对应主题的线色 */
let THEME_CANVAS = null;
function themeCanvasColors(){
  if (THEME_CANVAS) return THEME_CANVAS;
  const out = {};
  try {
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent || '').join('\n');
    for (const name of THEMES){
      const sel = (name === 'swiss-light')
        ? ':root, :root[data-theme="swiss-light"]{'
        : ':root[data-theme="' + name + '"]{';
      const i = css.indexOf(sel);
      if (i < 0) continue;
      const end = css.indexOf('}', i);
      const body = css.slice(i, end < 0 ? css.length : end);
      const vars = {};
      for (const m of body.matchAll(/--(plot-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) vars[m[1]] = m[2].trim();
      if (Object.keys(vars).length) out[name] = vars;
    }
  } catch(e){}
  THEME_CANVAS = out;
  return out;
}

function canvasColorsFor(themeName){
  const v = themeCanvasColors()[themeName];
  if (!v) return CV;
  const pick = (k, fb) => v[k] || fb;
  return {
    bg1: pick('plot-bg-1', CV.bg1), bg2: pick('plot-bg-2', CV.bg2), bg3: pick('plot-bg-3', CV.bg3),
    grid1: pick('plot-grid-1', CV.grid1), grid2: pick('plot-grid-2', CV.grid2),
    axis: pick('plot-axis', CV.axis), cross: pick('plot-cross', CV.cross),
    tick: pick('plot-tick', CV.tick), ink: pick('plot-ink', CV.ink), chip: pick('plot-chip', CV.chip),
  };
}

/* 选项 → 「这次怎么画、存成什么」（纯逻辑，测试主要盯这里） */
function shotPlan(){
  const format = ['png','jpeg','webp'].includes(shotOpts.format) ? shotOpts.format : 'png';
  let bg = ['theme','transparent','paper','dark'].includes(shotOpts.bg) ? shotOpts.bg : 'theme';
  if (format === 'jpeg' && bg === 'transparent') bg = 'paper';     /* JPG 没有透明通道 */
  const scale = Math.min(4, Math.max(1, Math.round(Number(shotOpts.scale) || 1)));
  return {
    format,
    mime: 'image/' + format,
    ext: format === 'jpeg' ? 'jpg' : format,
    quality: format === 'png' ? undefined : Math.min(1, Math.max(0.3, Number(shotOpts.quality) || 0.92)),
    grid: !!shotOpts.grid,
    axes: !!shotOpts.axes,
    bg,
    solid: bg === 'paper' ? '#FFFFFF' : (bg === 'dark' ? '#0F1012' : null),
    transparent: bg === 'transparent',
    palette: bg === 'paper' ? canvasColorsFor('swiss-light')
           : bg === 'dark'  ? canvasColorsFor('swiss-dark')
           : CV,
    /* 白/黑底时曲线也跟着换成对应主题的配色，不然暗色的浅青线在白底上几乎看不见 */
    curvePalette: bg === 'paper' ? THEME_PALETTE['swiss-light']
                : bg === 'dark'  ? THEME_PALETTE['swiss-dark']
                : null,
    scale,
    width: Math.max(1, Math.round(W * scale)),
    height: Math.max(1, Math.round(H * scale)),
  };
}

/* 离屏画一张：临时换渲染目标，finally 全部还原，实时画面不受影响 */
function renderShotCanvas(plan){
  if (!W || !H) return null;
  const off = document.createElement('canvas');
  off.width = plan.width;
  off.height = plan.height;
  let octx = null;
  try { octx = off.getContext('2d'); } catch(e){ octx = null; }
  if (!octx) return null;

  const savedCtx = ctx, savedW = W, savedH = H, savedNoise = noisePattern;
  const savedCV = CV, savedSel = selectedId;
  /* 白/黑底：曲线配色临时换成对应主题那套（导出完还原，不碰用户的选择） */
  const remap = plan.curvePalette && plan.curvePalette !== curvePalette;
  const savedColors = remap ? state.funcs.map(f => f.color) : null;
  const savedPtColor = remap ? state.pointTable.color : null;
  try {
    if (remap){
      state.funcs.forEach((f, i) => {
        const idx = curvePalette.indexOf(savedColors[i]);
        if (idx >= 0) f.color = plan.curvePalette[idx % plan.curvePalette.length];
      });
      const pi = curvePalette.indexOf(savedPtColor);
      if (pi >= 0) state.pointTable.color = plan.curvePalette[pi % plan.curvePalette.length];
    }
    ctx = octx;
    W = plan.width / plan.scale;        /* 逻辑尺寸还是舞台大小，只是乘了倍率 */
    H = plan.height / plan.scale;
    CV = plan.palette;
    noisePattern = null;
    selectedId = null;                  /* 选中光环也是界面 */
    renderOverride = plan;
    octx.setTransform(plan.scale, 0, 0, plan.scale, 0, 0);
    draw();
  } finally {
    renderOverride = null;
    ctx = savedCtx; W = savedW; H = savedH; noisePattern = savedNoise;
    CV = savedCV; selectedId = savedSel;
    if (remap){
      state.funcs.forEach((f, i) => { f.color = savedColors[i]; });
      state.pointTable.color = savedPtColor;
    }
  }
  return off;
}

/* ── 编码 + 下载 ── */
function downloadBlob(name, blob){
  let url = null;
  try { url = URL.createObjectURL(blob); } catch(e){ url = null; }
  if (!url){ toast('这个浏览器不给下载图片', 'error'); return false; }
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch(e){} }, 1000);
  return true;
}

function exportShot(){
  if (!W || !H){ toast('画布还没准备好', 'error'); return; }
  const plan = shotPlan();
  const c = renderShotCanvas(plan);
  if (!c){ toast('画不出图（拿不到画布上下文）', 'error'); return; }
  if (typeof c.toBlob !== 'function'){ toast('这个浏览器不支持导出图片', 'error'); return; }
  try {
    c.toBlob(blob => {
      if (!blob){ toast('导出失败，换个格式试试', 'error'); return; }
      const mime = blob.type || plan.mime;
      const ext = mime.includes('webp') ? 'webp' : (mime.includes('jpeg') ? 'jpg' : 'png');
      const fell = mime !== plan.mime;      /* 浏览器把它换成了别的格式（Safari 的 WebP） */
      if (downloadBlob('plot-' + fileStamp() + '.' + ext, blob)){
        toast((fell ? '这个浏览器不支持 ' + plan.ext.toUpperCase() + '，改存了 ' + ext.toUpperCase()
                    : '已导出 ' + ext.toUpperCase()) +
              ' · ' + plan.width + '×' + plan.height + (plan.transparent ? ' · 透明底' : ''));
      }
    }, plan.mime, plan.quality);
  } catch(e){
    toast('导出失败：' + ((e && e.message) || e), 'error');
  }
}

/* ── 弹窗 ── */
const shotModal = document.getElementById('shotModal');
let shotLastFocus = null;

const SHOT_BG_NAME = { theme:'跟随主题', transparent:'透明底', paper:'纯白底', dark:'纯黑底' };

function syncShotUI(){
  const q = id => document.getElementById(id);
  const setSw = (el, on) => {
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-checked', String(!!on));
  };
  setSw(q('shotGrid'), shotOpts.grid);
  setSw(q('shotAxes'), shotOpts.axes);

  const bg = q('shotBg');
  if (bg) bg.value = shotOpts.bg;

  document.querySelectorAll('#shotFormat .seg-btn').forEach(b => {
    const on = b.dataset.format === shotOpts.format;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
  const sc = Math.min(4, Math.max(1, Math.round(Number(shotOpts.scale) || 1)));
  document.querySelectorAll('#shotScale .seg-btn').forEach(b => {
    const on = Number(b.dataset.scale) === sc;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
  });

  const qual = q('shotQuality');
  if (qual) qual.value = String(shotOpts.quality);
  const qv = q('shotQualityVal');
  if (qv) qv.textContent = Number(shotOpts.quality).toFixed(2);
  const row = q('shotQualityRow');
  if (row) row.classList.toggle('hidden', shotOpts.format === 'png');

  const plan = shotPlan();
  const info = q('shotInfo');
  if (info){
    info.textContent = '输出 ' + plan.width + ' × ' + plan.height + ' px · ' + plan.ext.toUpperCase() +
      ' · ' + (SHOT_BG_NAME[plan.bg] || plan.bg) +
      (plan.format === 'png' ? '' : ' · 质量 ' + plan.quality.toFixed(2));
  }

  const img = q('shotPreview');
  if (img && W && H){
    try {
      const pc = renderShotCanvas({
        format:'png', mime:'image/png', ext:'png', quality:undefined,
        grid: plan.grid, axes: plan.axes, bg: plan.bg, solid: plan.solid,
        transparent: plan.transparent, palette: plan.palette,
        scale: 1, width: W, height: H,
      });
      img.src = pc ? pc.toDataURL('image/png') : '';
    } catch(e){ img.removeAttribute('src'); }
  }
}

function openShot(){
  if (!W || !H){ toast('画布还没准备好', 'error'); return; }
  shotLastFocus = document.activeElement;
  shotModal.classList.add('show');
  syncShotUI();
  const c = document.getElementById('shotClose');
  if (c) requestAnimationFrame(() => c.focus());
}
function closeShot(){
  if (!shotModal || !shotModal.classList.contains('show')) return;
  shotModal.classList.remove('show');
  if (shotLastFocus && shotLastFocus.focus) shotLastFocus.focus();
}

(function bindShot(){
  if (!shotModal) return;
  document.getElementById('shotClose').addEventListener('click', closeShot);
  shotModal.addEventListener('click', e => { if (e.target === shotModal) closeShot(); });
  document.getElementById('shotDownload').addEventListener('click', exportShot);

  const preset = document.getElementById('shotPreset');
  if (preset) preset.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('.seg-btn') : null;
    if (b) shotPreset(b.dataset.preset);
  });

  const flip = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    const toggle = () => { shotOpts[key] = !shotOpts[key]; syncShotUI(); };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); toggle(); }
    });
  };
  flip('shotGrid', 'grid');
  flip('shotAxes', 'axes');

  const bg = document.getElementById('shotBg');
  if (bg) bg.addEventListener('change', () => { shotOpts.bg = bg.value; syncShotUI(); });

  document.querySelectorAll('#shotFormat .seg-btn').forEach(b =>
    b.addEventListener('click', () => { shotOpts.format = b.dataset.format; syncShotUI(); }));
  document.querySelectorAll('#shotScale .seg-btn').forEach(b =>
    b.addEventListener('click', () => { shotOpts.scale = Number(b.dataset.scale); syncShotUI(); }));

  const qual = document.getElementById('shotQuality');
  if (qual) qual.addEventListener('input', () => {
    shotOpts.quality = Math.min(1, Math.max(0.3, parseFloat(qual.value) || 0.92));
    syncShotUI();
  });
})();

/* ── 工具栏收起 / 展开 ── */
const TOOLBAR_KEY = 'plot-toolbar';

function setToolbarCollapsed(on, save){
  const bar = document.getElementById('toolbar');
  const btn = document.getElementById('toolbarToggle');
  if (!bar) return;
  bar.classList.toggle('collapsed', !!on);
  if (btn){
    btn.setAttribute('aria-expanded', String(!on));
    btn.setAttribute('aria-label', on ? '展开工具栏' : '收起工具栏');
    btn.title = on ? '展开工具栏' : '收起工具栏';
  }
  if (save !== false){
    try { localStorage.setItem(TOOLBAR_KEY, on ? 'closed' : 'open'); } catch(e){}
  }
}

(function initToolbar(){
  const btn = document.getElementById('toolbarToggle');
  const bar = document.getElementById('toolbar');
  if (!btn || !bar) return;
  let saved = null;
  try { saved = localStorage.getItem(TOOLBAR_KEY); } catch(e){}
  if (saved){
    setToolbarCollapsed(saved === 'closed', false);
  } else {
    /* 没选过：窄屏、或者工具栏自己就溢出了（有些手机浏览器按桌面宽度渲染）→ 默认收起 */
    const overflow = bar.scrollWidth > bar.clientWidth + 4;
    setToolbarCollapsed(innerWidth <= 880 || overflow, false);
  }
  btn.addEventListener('click', () => {
    setToolbarCollapsed(!bar.classList.contains('collapsed'));
  });
})();

/* ═══════════════════════════════════════════════════
   17. 键盘
   ═══════════════════════════════════════════════════ */

window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  const inField = tag === 'INPUT' || tag === 'TEXTAREA';

  if (e.key === 'Escape'){
    if (construct){ e.preventDefault(); cancelConstruct(); toast('已退出构造'); return; }
    if (pickState){
      e.preventDefault();
      pickState = null; updatePickBadge(); requestRender();
      toast('已取消取点');
      return;
    }
    if (helpModal && helpModal.classList.contains('show')){
      e.preventDefault();
      closeHelp();
      return;
    }
    if (shotModal && shotModal.classList.contains('show')){
      e.preventDefault();
      closeShot();
      return;
    }
    if (toolsModal && toolsModal.classList.contains('show')){
      e.preventDefault();
      closeTools();
      return;
    }
    if (settingsModal.classList.contains('show')){
      e.preventDefault();
      closeSettings();
      return;
    }
    if (formulaModal.classList.contains('show')){
      e.preventDefault();
      closeFormula();
      return;
    }
    if (typeMenu.classList.contains('show')){
      closeTypeMenu();
      e.stopPropagation();
      return;
    }
    if (pen.pending){
      e.preventDefault();
      pen.pending = null; pen.cursor = null;
      updatePenBadge(); requestRender();
      toast('已取消起点');
    }
    return;
  }

  if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey){
    e.preventDefault();
    if (shotModal && shotModal.classList.contains('show')) closeShot();
    else openShot();
    return;
  }

  if (e.key === '0' && (e.metaKey || e.ctrlKey)){
    e.preventDefault();
    state.view.cx = 0; state.view.cy = 0; state.view.scale = 56;
    requestRender(); updateHUD();
    return;
  }

  if (inField) return;

  /* 多边形这类开放式构造：回车收尾 */
  if (e.key === 'Enter' && construct && CONSTRUCTS[construct.key].open){
    e.preventDefault();
    const need = CONSTRUCTS[construct.key].need;
    if (construct.picks.length >= need) buildConstruct();
    else toast('再点几个顶点，至少 ' + need + ' 个');
    return;
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')){
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')){
    e.preventDefault();
    redo();
    return;
  }

  if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey){
    e.preventDefault();
    if (formulaModal.classList.contains('show')) closeFormula();
    else openFormula();
    return;
  }

  if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey){
    e.preventDefault();
    setPenActive(!pen.active);
    return;
  }

  if ((e.key === ',' && (e.metaKey || e.ctrlKey))){
    e.preventDefault();
    if (settingsModal.classList.contains('show')) closeSettings();
    else openSettings();
  }
});

/* ═══════════════════════════════════════════════════
   18. 启动
   ═══════════════════════════════════════════════════ */

/* 首帧就按当前主题铺一遍（曲线/画笔/点的颜色也跟着映射）
   noSave：启动这次不算「手动选择」，别把跟随系统焊死 */
setTheme(currentTheme(), true, true);
setTool('move', true);
setTvTab('points');
syncSettingsUI();
syncToolUI();
syncSelectionUI();
hist.last = serializeObjects();
updateHistoryUI();
resize();
requestRender();
