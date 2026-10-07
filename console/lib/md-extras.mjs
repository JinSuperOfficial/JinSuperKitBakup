/**
 * 控制台预览的「渲染增强」（只在预览 / 归档时生效，文档站构建不碰）
 * ---------------------------------------------------
 * 控制台写作面板的 md 预览复用 build/lib/markdown.cjs —— 和文档站同一套渲染核心，
 * 所以「告示 / 提示框 / 选项卡 / 代码组 / 剧透 / 目录 / 公式 / 卡片」这些语法
 * 本来就已经渲染成 HTML 了。差的是两件事：
 *
 *   1. **样式**：文档站那套扩展样式在 p/docs-md.css、卡片样式在 p/docs-card.js，
 *      控制台页面以前一个都没引，预览里就成了一堆没上色的裸元素。
 *      （这两件事在 web/index.html 里解决：直接把站点那两个文件引进来。）
 *   2. **被站点砍掉的图表**：mermaid / echarts 这几类围栏在站点里是「普通代码块
 *      + 一行说明」。预览里我们把它真正画出来 —— 这就是本文件干的事。
 *
 * 三条约定（和用户对齐过）：
 *   · **只增强预览，不动文档站**：外挂通过 createRenderer({ setup }) 注入，
 *     build.mjs / renderMarkdown() 完全不传 setup，站点产物一个字节都不变。
 *   · **缺什么就说什么**：插件没装、能力不支持，就在预览里给一条可操作的提示，
 *     而不是安静地退化成一坨代码。
 *   · **归档产物必须自包含**：能「烘」进静态 HTML 的（ECharts → 内联 SVG）才进归档；
 *     需要浏览器运行时的（mermaid）在归档里退回代码块 —— 归档 HTML 不引用任何外部插件脚本。
 *
 * 想再加外部 markdown-it 插件：编辑 console/md-plugins.json（见文件里的说明），
 * 装到 build/ 里即可被这里加载；装不上会在状态里标出来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDir, consoleDir, isFile } from './paths.mjs';

/** 依赖装在 build/ 里（控制台刻意不重复装一遍），所以 require 从那边解析 */
const buildRequire = createRequire(path.join(buildDir, 'package.json'));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ═══════════════════════════════════════════════════
   可选依赖的加载
   ═══════════════════════════════════════════════════ */

const loadCache = new Map();

/** 试 require 一个包；失败返回 { error } */
function tryRequire(spec, base = buildRequire) {
  const key = 'r:' + spec;
  if (loadCache.has(key)) return loadCache.get(key);
  let out;
  try {
    out = { mod: base(spec) };
  } catch (e) {
    out = { error: (e && e.message ? e.message : String(e)).split('\n')[0] };
  }
  loadCache.set(key, out);
  return out;
}

/**
 * 加载「UMD 但被标成 ESM」的包（@mdit/* 就是这样）。
 * ---------------------------------------------------
 * 这些包 package.json 里写着 "type":"module"，`require()` 会把 .js 当 ESM 处理，
 * 拿回来的是一个空命名空间 —— 明明文件里就是 UMD。构建期靠 build.mjs 把它们
 * 复制成 .cjs 绕过去；控制台不想往 build/ 里写文件，就在内存里按 CJS 求值一次。
 * 只在 UMD 分支（typeof module 是对象）下展开，拿不到 exports 就报错退出。
 */
function loadUmd(absFile) {
  const key = 'u:' + absFile;
  if (loadCache.has(key)) return loadCache.get(key);
  let out;
  try {
    const code = fs.readFileSync(absFile, 'utf8');
    const mod = { exports: {} };
    const req = createRequire(absFile);
    const run = new Function('exports', 'module', 'require', '__filename', '__dirname', code);
    run(mod.exports, mod, req, absFile, path.dirname(absFile));
    const keys = Object.keys(mod.exports || {});
    out = keys.length ? { mod: mod.exports } : { error: '这个 UMD 文件没有导出任何东西：' + path.basename(absFile) };
  } catch (e) {
    out = { error: (e && e.message ? e.message : String(e)).split('\n')[0] };
  }
  loadCache.set(key, out);
  return out;
}

/** 包在 node_modules 里的绝对目录（不存在返回 null） */
function pkgDirIn(root, pkg) {
  const dir = path.join(root, 'node_modules', ...pkg.split('/'));
  return isFile(path.join(dir, 'package.json')) ? dir : null;
}

/** 依次在 build/、console/ 的 node_modules 里找包 */
function pkgDir(pkg) {
  return pkgDirIn(buildDir, pkg) || pkgDirIn(consoleDir, pkg);
}

/* ═══════════════════════════════════════════════════
   能力探测（结果缓存；进程活一次探一次就够）
   ═══════════════════════════════════════════════════ */

let probed = null;

/** mermaid 的浏览器包（自带、单文件、经典 script 就能用） */
export function mermaidClientFile() {
  const dir = pkgDir('mermaid');
  if (!dir) return null;
  for (const rel of ['dist/mermaid.min.js', 'dist/mermaid.js']) {
    const f = path.join(dir, rel);
    if (isFile(f)) return f;
  }
  return null;
}

/** ECharts 的 Node 包（服务端 SSR 出内联 SVG） */
function echartsModule() {
  const r = tryRequire('echarts');
  return r.mod || null;
}

function probe() {
  if (probed) return probed;

  const ec = echartsModule();
  const mf = mermaidClientFile();

  const features = [
    {
      id: 'echarts',
      label: 'ECharts 图表',
      langs: ['echarts', 'chart'],
      bake: true,
      ok: !!ec,
      detail: ec
        ? '服务端渲染成内联 SVG；预览和归档都能画（归档 HTML 自包含）'
        : '没装 echarts：在 build/ 里跑 npm install（它是 build 的依赖）',
    },
    {
      id: 'mermaid',
      label: 'Mermaid 图表',
      langs: ['mermaid'],
      bake: false,
      ok: !!mf,
      detail: mf
        ? '浏览器端渲染（控制台本地提供 mermaid.min.js）；归档里退回代码块'
        : '没装 mermaid：在 build/ 里 npm i mermaid 就能画；归档一直是代码块',
    },
    {
      id: 'plantuml',
      label: 'PlantUML / 其他图表语法',
      langs: ['plantuml', 'puml', 'flow', 'flowchart', 'ditaa', 'dot', 'graphviz'],
      bake: false,
      ok: false,
      detail: '这些语法要外部渲染服务，离线环境不接；预览与归档都保持代码块',
    },
  ];

  const external = loadExternalPlugins();

  probed = { features, external };
  return probed;
}

/** 给界面 / 自检用的能力快照 */
export function extrasStatus() {
  const { features, external } = probe();
  return {
    features: features.map(({ id, label, langs, bake, ok, detail }) => ({ id, label, langs, bake, ok, detail })),
    external: external.map((p) => ({
      id: p.id, label: p.label, ok: !!p.fn,
      detail: p.fn ? (p.applied ? '已启用' : '可用') : (p.error || '没装'),
    })),
    /** 一句话概括，界面上直接显示 */
    summary: [
      ...features.filter((f) => f.ok).map((f) => f.label + ' ✓'),
      ...features.filter((f) => !f.ok && f.id !== 'plantuml').map((f) => f.label + ' ✗'),
      ...external.filter((p) => p.fn).map((p) => p.label + ' ✓'),
    ].join(' · ') || '只用文档站语法',
  };
}

/* ═══════════════════════════════════════════════════
   外部 markdown-it 插件：console/md-plugins.json
   ---------------------------------------------------
   形如：
     {
       "说明": "……",
       "plugins": [
         {
           "id": "figure",
           "label": "图片图注",
           "package": "@mdit/plugin-figure",
           "export": "figure",
           "umd": "dist/cdn.umd.js",
           "options": {}
         }
       ]
     }
   字段说明：
     package  包名（装在 build/ 或 console/ 的 node_modules 里）
     export   取包上的哪个导出（默认 default / 模块本身）
     umd      包是 ESM 时，写明 UMD 文件的相对路径；不写就先试正常 require
     options  传给 md.use 的第二个参数
   ═══════════════════════════════════════════════════ */

const PLUGIN_FILE = path.join(consoleDir, 'md-plugins.json');

/** 读配置；没有配置文件 / 读坏了都当作「没有插件」 */
function readPluginConfig() {
  if (!isFile(PLUGIN_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(PLUGIN_FILE, 'utf8'));
    return Array.isArray(raw && raw.plugins) ? raw.plugins.filter((p) => p && p.package) : [];
  } catch {
    return [];
  }
}

/** 从包里挑出插件函数 */
function pickExport(mod, name) {
  if (!mod) return null;
  if (name && typeof mod[name] === 'function') return mod[name];
  if (typeof mod === 'function') return mod;
  const d = mod.default;
  if (d && typeof d === 'function') return d;
  if (d && name && typeof d[name] === 'function') return d[name];
  // 常见的 CJS 双包：module.exports = { default: { fn } }
  for (const k of Object.keys(mod)) {
    if (typeof mod[k] === 'function') return mod[k];
  }
  return null;
}

function loadExternalPlugins() {
  return readPluginConfig().map((spec) => {
    const id = spec.id || spec.package;
    const label = spec.label || spec.package;
    const dir = pkgDir(spec.package);
    if (!dir) {
      return { id, label, spec, fn: null, error: '没装 ' + spec.package + '（在 build/ 里 npm i ' + spec.package + '）' };
    }

    /* 1) 普通 require（经典 CJS 插件走这条） */
    const viaRequire = tryRequire(spec.package);
    let fn = viaRequire.mod ? pickExport(viaRequire.mod, spec.export) : null;
    if (fn) return { id, label, spec, fn };

    /* 2) UMD 兜底：包被标成 ESM 时 require 拿不到东西，直接读 UMD 文件求值 */
    if (spec.umd) {
      const abs = path.join(dir, spec.umd);
      if (!isFile(abs)) return { id, label, spec, fn: null, error: '找不到 ' + spec.umd };
      const umd = loadUmd(abs);
      fn = umd.mod ? pickExport(umd.mod, spec.export) : null;
      if (fn) return { id, label, spec, fn };
      return { id, label, spec, fn: null, error: umd.error || 'UMD 里没有可用的插件导出' };
    }

    return { id, label, spec, fn: null, error: viaRequire.error || '包里没有可用的插件导出' };
  });
}

/* ═══════════════════════════════════════════════════
   图表：ECharts（服务端 SSR → 内联 SVG）
   ═══════════════════════════════════════════════════ */

/** 图表默认尺寸；选项里写 __width / __height 可以覆盖 */
const CHART_W = 760;
const CHART_H = 380;
const CHART_MAX_H = 1400;

/**
 * 宽松 JSON：允许多行、允许 // 与 /* *\/ 注释、允许尾逗号。
 * 写图表配置时手滑留个逗号很正常，不值得整篇报错。
 */
function parseOption(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('围栏里是空的');
  try {
    return JSON.parse(raw);
  } catch { /* 再宽松一把 */ }
  const cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

/** 图表渲染失败的提示块（不发呆，直接说哪儿错了） */
function chartError(msg) {
  return '<figure class="md-chart md-chart-bad">' +
    '<p class="md-ext-note">图表没画出来：' + esc(msg) + '</p>' +
    '</figure>\n';
}

function renderEcharts(token) {
  const echarts = echartsModule();
  if (!echarts) return null; /* 交给调用方给「没装插件」的提示 */

  let opt;
  try {
    opt = parseOption(token.content);
  } catch (e) {
    return chartError('配置不是合法 JSON（' + (e && e.message ? e.message : e) + '）');
  }
  if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
    return chartError('配置得是一个 JSON 对象，例如 { "series": [...] }');
  }

  const width = Math.max(240, Math.min(2000, Number(opt.__width) || CHART_W));
  const height = Math.max(160, Math.min(CHART_MAX_H, Number(opt.__height) || CHART_H));
  delete opt.__width;
  delete opt.__height;
  if (opt.animation == null) opt.animation = false;

  let chart = null;
  try {
    chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
    chart.setOption(opt);
    const svg = chart.renderToSVGString();
    return '<figure class="md-chart" data-chart="echarts" ' +
      'style="--chart-w:' + width + 'px;--chart-h:' + height + 'px">' + svg + '</figure>\n';
  } catch (e) {
    return chartError((e && e.message ? e.message : String(e)));
  } finally {
    try { if (chart) chart.dispose(); } catch { /* 渲染失败时 dispose 也可能抛，忽略 */ }
  }
}

/* ═══════════════════════════════════════════════════
   图表：Mermaid（浏览器端渲染；归档里不烘）
   ═══════════════════════════════════════════════════ */

function renderMermaid(token, mode) {
  /* 归档产物要自包含：mermaid 得靠浏览器里的脚本，烘不进静态 HTML，
     所以归档沿用核心渲染的代码块，只在这里（preview）画。 */
  if (mode !== 'preview') return null;
  if (!mermaidClientFile()) return null; /* 没装 → 走「没插件」提示 */
  const code = String(token.content || '').trim();
  if (!code) return null;
  return '<div class="mermaid md-mermaid">' + esc(code) + '</div>\n';
}

/* ═══════════════════════════════════════════════════
   围栏接管
   ═══════════════════════════════════════════════════ */

/** 围栏语言：info 的第一个词，小写 */
function fenceLang(token) {
  const m = /^[a-zA-Z0-9#+._-]*/.exec(String(token.info || '').trim());
  return (m ? m[0] : '').toLowerCase();
}

/** 这条围栏归哪个特性管（不归任何特性就返回 null） */
function featureOfLang(lang) {
  const { features } = probe();
  for (const f of features) if (f.langs.includes(lang)) return f;
  return null;
}

function noticeBlock(feature) {
  return '<p class="md-ext-note" data-ext="' + esc(feature.id) + '">' +
    '<strong>' + esc(feature.label + ' 在预览里没渲染') + '</strong>：' +
    esc(feature.detail || '') + ' 下面是源码，代码块照常可读。' +
    '</p>\n';
}

/**
 * 装围栏增强。
 * @param {object} md      markdown-it 实例
 * @param {'preview'|'bake'} mode
 *   preview：预览，能画的都画（含需要浏览器脚本的 mermaid）
 *   bake   ：归档，只放「能烘成静态 HTML」的（ECharts → 内联 SVG）
 */
function installFences(md, mode) {
  const base = md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];

    /* 代码组里的面板由核心代码接管（它要包 .cg-panel），别抢 */
    if (token.meta && token.meta.cgId != null) return base(tokens, idx, options, env, self);

    const lang = fenceLang(token);
    const feature = featureOfLang(lang);
    if (!feature) return base(tokens, idx, options, env, self);

    const codeFallback = () => base(tokens, idx, options, env, self);

    /* 归档：能烘的才烘，烘不了的直接退回代码块 —— 产物里不留提示块，要干净 */
    if (mode === 'bake' && !feature.bake) return codeFallback();

    if (feature.id === 'echarts') {
      const out = renderEcharts(token);
      if (out != null) return out;
      return mode === 'preview' ? noticeBlock(feature) + codeFallback() : codeFallback();
    }

    if (feature.id === 'mermaid') {
      const out = renderMermaid(token, mode);
      if (out != null) return out;
      return mode === 'preview' ? noticeBlock(feature) + codeFallback() : codeFallback();
    }

    /* plantuml 之类：站点本来就砍了、离线也接不了，预览里说清楚原因 */
    return mode === 'preview' && !feature.ok ? noticeBlock(feature) + codeFallback() : codeFallback();
  };
}

/**
 * 把外部 markdown-it 插件装上去。
 * 用的是 probe() 缓存的那一份描述对象 —— 注册结果要能反馈到 extrasStatus()，
 * 所以不能每次重新 load 一批新的。
 * 装不上的只记状态，不打断渲染。
 */
function installExternal(md) {
  probe().external.forEach((p) => {
    if (!p.fn || p.applied) return;
    try {
      md.use(p.fn, p.spec.options || {});
      p.applied = true;
    } catch (e) {
      p.fn = null;
      p.error = '装上去了但注册失败：' + (e && e.message ? e.message : e);
    }
  });
}

/* ═══════════════════════════════════════════════════
   对外接口
   ═══════════════════════════════════════════════════ */

/** 预览用的 setup（交给 createRenderer({ setup })） */
export function previewSetup(md) {
  installExternal(md);
  installFences(md, 'preview');
}

/** 归档用的 setup：只装能烘进静态 HTML 的东西 */
export function bakeSetup(md) {
  installExternal(md);
  installFences(md, 'bake');
}

/**
 * 扫一遍源码，列出「这篇用了、但当前画不出来」的语法。
 * 归档时用它给用户一句人话，而不是让人自己发现图没了。
 * @param {string} src
 * @param {'preview'|'bake'} mode
 * @returns {Array<{lang:string, id:string, label:string, detail:string}>}
 */
export function scanUnsupported(src, mode = 'preview') {
  const text = String(src == null ? '' : src);
  const lines = text.split(/\r?\n/);
  const hits = [];
  const seen = new Set();
  let fence = null;

  for (const line of lines) {
    const m = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/.exec(line);
    if (m) {
      if (!fence) {
        const lang = (m[2].trim().split(/[\s{[]/)[0] || '').toLowerCase();
        fence = { lang };
        const f = featureOfLang(lang);
        if (f) {
          const usable = mode === 'bake' ? f.bake && f.ok : f.ok;
          if (!usable && !seen.has(f.id)) {
            seen.add(f.id);
            hits.push({ lang, id: f.id, label: f.label, detail: f.detail });
          }
        }
      } else {
        fence = null;
      }
    }
  }
  return hits;
}
