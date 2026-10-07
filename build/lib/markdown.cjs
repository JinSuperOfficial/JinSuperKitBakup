/**
 * ═══════════════════════════════════════════════════
 *  文档站 · Markdown 渲染核心（Node 侧，构建期使用）
 * ---------------------------------------------------
 *  这是 p/docs-md.js 的服务端版本：语法支持一一对应，
 *  但去掉了所有浏览器专属逻辑（CDN 探测、KaTeX 兜底轮询、
 *  Mermaid 按需加载、灯箱），因为这些东西在预渲染之后
 *  已经没有必要存在了。
 *
 *  支持语法：
 *    · 标题锚点（沿用旧 slug 规则，已有锚点链接不失效）
 *    · 代码块：highlight.js 高亮 + 行号 + {1,3-5} 高亮行
 *    · GitHub 告示 > [!NOTE] / ::: note 提示框
 *    · [[toc]] 目录、{漢字|かんじ} 注音、!!剧透!!
 *    · 图片尺寸 ![alt](x =宽x高)、懒加载、#dark / #light 主题图
 *    · 脚注 / 任务列表 / 定义列表 / 上下标 / 标记 / 插入 / 缩写 / emoji
 *    · KaTeX 数学公式（$…$、$$…$$、\(…\)、\[…\]）
 *
 *  刻意不支持：
 *    · ```mermaid、```plantuml、```flow —— 按团队决定砍掉，
 *      它们会退化成普通代码块（高亮识别不了，就是纯文本）。
 * ═══════════════════════════════════════════════════
 */

var MarkdownIt = require('markdown-it');
var footnote = require('markdown-it-footnote');
var taskLists = require('markdown-it-task-lists');
var deflist = require('markdown-it-deflist');
var sub = require('markdown-it-sub');
var sup = require('markdown-it-sup');
var mark = require('markdown-it-mark');
var ins = require('markdown-it-ins');
var abbr = require('markdown-it-abbr');
var container = require('markdown-it-container');
var emoji = require('markdown-it-emoji').full;
var attrs = require('markdown-it-attrs');
var anchor = require('markdown-it-anchor');
var texmath = require('markdown-it-texmath');

/**
 * 卡片插件（站点自带 p/docs-card.js 的副本，构建时自动同步过来）。
 * 它接管 <card link="…" date="…">标题</card> 这种行内语法，渲染成 <a class="card">。
 * 拿不到就退化为「不注册」——<card> 会以未知元素留在页面上，
 * 页面那侧还有 DocsCard.enhance() 兜底。
 */
var DocsCard = null;
try { DocsCard = require('./docs-card.cjs'); }
catch (e) { DocsCard = null; }

/**
 * @mdit/plugin-tab：`::: tabs` + `@tab 标题` 标签页。
 * 打包时被复制成 lib/vendor/mdit-tab.cjs（原包是 ESM，见 build.mjs 里的说明）。
 * 拿不到就不注册，`::: tabs` 会退化成普通段落，不影响其它语法。
 */
var TabPlugin = null;
try { TabPlugin = require('./vendor/mdit-tab.cjs'); }
catch (e) { TabPlugin = null; }

/** 标签页容器的名字，决定了 CSS 类名前缀（tabs-tabs-wrapper 之类） */
var TAB_NAME = 'tabs';

/* ═══════════════════════════════════════════════════
   重量级引擎走「注入」而不是「硬 import」
   ---------------------------------------------------
   KaTeX（619KB）和 highlight.js（含语言包）都很大。
   Node 构建期当然需要它们；但浏览器端的备用渲染器
   没必要背这个包袱——预渲染稿里公式和高亮早就定好了。

   所以这里不 import，由调用方传进来：
     · build.mjs        → 传 Node 侧 import 的 katex / hljs
     · 浏览器 bundle     → 传 window.katex / window.hljs（有就用，没有就算了）
   ═══════════════════════════════════════════════════ */

let katex = null;
let hljs = null;

/** 注入渲染引擎（可选，不注入就退化为无高亮 / 保留公式源码） */
function setEngines(o) {
  var k = o && o.katex, h = o && o.hljs;
  if (k) katex = k.default || k;
  if (h) hljs = h.default || h;
}

/* ═══════════════════════════════════════════════════
   配置
   ═══════════════════════════════════════════════════ */

var KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: false,
  output: 'htmlAndMathml',
};

/** ::: 提示框的中文默认标题 */
const BOX_LABELS = {
  note: '注意', tip: '提示', info: '信息', warning: '警告',
  danger: '危险', success: '完成', question: '疑问', details: '详情',
};

/** GitHub 告示 */
const ALERT_TITLES = { note: '注意', tip: '提示', important: '重要', warning: '警告', caution: '小心' };
const SVG_HEAD = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor">';
const ALERT_ICONS = {
  note:      SVG_HEAD + '<path d="M8 1.2A6.8 6.8 0 1 0 8 14.8 6.8 6.8 0 0 0 8 1.2Zm0 1.6a5.2 5.2 0 1 1 0 10.4A5.2 5.2 0 0 1 8 2.8Zm0 2.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm-.85 3.3h1.7v4.6h-1.7Z"/></svg>',
  tip:       SVG_HEAD + '<path d="M8 1.2c-2.4 0-4.2 1.8-4.2 4 0 1 .5 1.8 1.1 2.5.6.7 1 1.2 1.1 2h4c.1-.8.5-1.3 1.1-2 .6-.7 1.1-1.5 1.1-2.5 0-2.2-1.8-4-4.2-4Zm-1.7 10h3.4v1.2H6.3Zm.6 2.1h2.2l-.3 1.2H7.2Z"/></svg>',
  important: SVG_HEAD + '<path d="M8 1.2A6.8 6.8 0 1 0 8 14.8 6.8 6.8 0 0 0 8 1.2Zm0 1.6a5.2 5.2 0 1 1 0 10.4A5.2 5.2 0 0 1 8 2.8Zm-.9 1.8h1.8v4.6H7.1Zm0 5.6h1.8v1.8H7.1Z"/></svg>',
  warning:   SVG_HEAD + '<path d="M8 1.4 15 14H1L8 1.4Zm0 3.2a.9.9 0 0 0-.9.9v2.8a.9.9 0 0 0 1.8 0V5.5A.9.9 0 0 0 8 4.6Zm0 5.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
  caution:   SVG_HEAD + '<path d="M5.2 1h5.6L15 5.2v5.6L10.8 15H5.2L1 10.8V5.2L5.2 1Zm2.8 3.4a.9.9 0 0 0-.9.9v2.6a.9.9 0 0 0 1.8 0V5.3a.9.9 0 0 0-.9-.9Zm0 5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
};

/* ═══════════════════════════════════════════════════
   工具
   ═══════════════════════════════════════════════════ */

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * 标题 slug：与 p/docs-md.js 完全一致，保证旧锚点链接不失效。
 * 重复标题从 -2 开始编号。
 *
 * 注意：计数是闭包状态，**同一实例渲染多篇文档时必须重置**，
 * 否则第二篇的标题会莫名其妙带上 -2、-3 后缀。
 */
function createSlugger() {
  let counts = {};
  const slugify = (text) => {
    let s = String(text || '').toLowerCase().trim();
    s = s.replace(/[\s\u3000]+/g, '-');
    s = s.replace(/[^\w\u4e00-\u9fa5-]/g, '');
    s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
    s = s || 'section';
    const n = (counts[s] = (counts[s] || 0) + 1);
    return n > 1 ? `${s}-${n}` : s;
  };
  slugify.reset = () => { counts = {}; };
  return slugify;
}

/* ═══════════════════════════════════════════════════
   代码块：高亮 + 行号 + 高亮行
   ═══════════════════════════════════════════════════ */

/** 解析 {1,3-5} 行号范围 */
function parseRanges(spec) {
  const set = {};
  String(spec || '').split(',').forEach((part) => {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) return;
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (b < a) [a, b] = [b, a];
    for (let i = a; i <= b && i - a < 500; i++) set[i] = 1;
  });
  return set;
}

/** 把高亮后的 HTML 按行切开，并补全每行被拆开的标签 */
function wrapLines(html, hlSet) {
  const lines = String(html).replace(/\n$/, '').split('\n');
  const stack = [];
  const out = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prefix = stack.join('');
    let rebuilt = '';
    let pos = 0;
    let m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line))) {
      rebuilt += line.slice(pos, m.index);
      pos = tagRe.lastIndex;
      const name = m[2];
      const selfClose = /\/\s*$/.test(m[3]) || /^(br|img|hr|input|wbr|meta|link)$/i.test(name);
      if (m[1] === '/') stack.pop();
      else if (!selfClose) stack.push(m[0]);
      rebuilt += m[0];
    }
    rebuilt += line.slice(pos);
    let suffix = '';
    for (let k = stack.length - 1; k >= 0; k--) {
      suffix += `</${stack[k].replace(/^<([a-zA-Z][a-zA-Z0-9-]*).*$/, '$1')}>`;
    }
    out.push(`<span class="cl${hlSet && hlSet[i + 1] ? ' hl' : ''}">${prefix}${rebuilt}${suffix}</span>`);
  }
  return out.join('\n');
}

/* ═══════════════════════════════════════════════════
   行内扩展：{漢字|かんじ} 注音、!!剧透!!
   ═══════════════════════════════════════════════════ */

const INLINE_PATTERNS = [
  {
    re: /\{([^{}|\n]+)\|([^{}|\n]+)\}/g,
    html: (m, kanji, kana) =>
      `<ruby>${esc(kanji)}<rp>(</rp><rt>${esc(kana)}</rt><rp>)</rp></ruby>`,
  },
  {
    re: /!!([^!\n]+)!!/g,
    html: (m, text) => `<span class="spoiler" tabindex="-1">${esc(text)}</span>`,
  },
];

/** 把一段纯文本切成 [{text}|{html}] 片段 */
function splitByPatterns(content) {
  const marks = [];
  INLINE_PATTERNS.forEach((p) => {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(content))) {
      marks.push({ start: m.index, end: m.index + m[0].length, html: p.html(...m) });
      if (!m[0].length) re.lastIndex++;
    }
  });
  if (!marks.length) return null;
  marks.sort((a, b) => a.start - b.start);

  const out = [];
  let pos = 0;
  marks.forEach((k) => {
    if (k.start < pos) return;
    if (k.start > pos) out.push({ text: content.slice(pos, k.start) });
    out.push({ html: k.html });
    pos = k.end;
  });
  if (pos < content.length) out.push({ text: content.slice(pos) });
  return out;
}

/* ═══════════════════════════════════════════════════
   各类适配器
   ═══════════════════════════════════════════════════ */

/**
 * 围栏信息抢救：
 * markdown-it-attrs 会把 ```js {1,3-5} 里的 {1,3-5} 当成属性块吃掉，
 * 导致 token.info 只剩 "js"。
 *
 * 这里把原始源码挂到 env 上，渲染 fence 时用 token.map[0] 精确定位
 * 到那一段围栏的源码行，从源码里取回完整 info。
 * token.map 不受 attrs 影响，所以这个办法是可靠的。
 */
function fenceInfoAdapter(md) {
  md.core.ruler.before('block', 'docs-fence-src', (state) => {
    state.env.__lines = state.src.split('\n');
  });
}

/**
 * 从源码行取围栏开头的 info 串。
 * token.map[0] 是该围栏块在源码里的起始行号，不受 attrs 影响。
 */
function srcFenceInfo(env, token) {
  const lines = env && env.__lines;
  if (!lines || !token.map) return null;
  const line = lines[token.map[0]];
  if (line == null) return null;
  const m = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\n]*)$/.exec(line);
  return m ? m[1].trim() : null;
}

/** ```lang:line-numbers 或 ```lang {1,3-5} */
function fenceRule(md, useHljs) {
  md.renderer.rules.fence = (tokens, idx, options, env) => {
    const token = tokens[idx];
    const fromSrc = srcFenceInfo(env, token);
    const info = String(fromSrc != null ? fromSrc : token.info || '').trim();

    /* Mermaid 已砍掉：按普通代码块渲染，留一个 class 方便 CSS 给提示 */
    const langMatch = /^[a-zA-Z0-9#+._-]*/.exec(info);
    const lang = langMatch ? langMatch[0] : '';
    const rest = info.slice(lang.length);
    const showNumbers = /line-numbers/.test(rest);
    const rangeMatch = /\{([^}]*)\}/.exec(rest);
    const hlSet = rangeMatch ? parseRanges(rangeMatch[1]) : null;
    const wrap = showNumbers || !!hlSet;

    let code = '';
    if (useHljs && lang && hljs && hljs.getLanguage && hljs.getLanguage(lang)) {
      try {
        code = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value;
      } catch (e) {
        code = '';
      }
    }
    if (!code) code = md.utils.escapeHtml(token.content);

    if (wrap) code = wrapLines(code, hlSet);

    const cls = `hljs${lang ? ` language-${lang}` : ''}${wrap ? ' with-lines' : ''}${showNumbers ? ' show-lines' : ''}`;
    const pre = `<pre${wrap ? ' class="with-lines"' : ''}><code class="${cls}">${code}</code></pre>\n`;

    /* 代码组里的面板：各自包一层，面板文字挂在 data-label 上，
       标签行由客户端按真实面板数生成 */
    const meta = token.meta || {};
    if (meta.cgId != null){
      const label = esc(meta.cgLabel || '');
      return '<div class="cg-panel" data-label="' + label + '">' + pre + '</div>';
    }
    return pre;
  };
}

/**
 * 告示 / 提示框的标题文字。
 * 允许行内 Markdown：`code`、**粗体**、[链接](…)、{漢字|かんじ} 等，
 * 这样「自定义名字」才真的能自定义；渲染失败就退回纯文本转义。
 */
function inlineTitle(md, s) {
  const text = String(s == null ? '' : s).trim();
  if (!text) return '';
  try {
    return md.renderInline(text);
  } catch (e) {
    return esc(text);
  }
}

/** GitHub 告示 > [!NOTE] */
function alertAdapter(md) {
  const RE = /^\\?\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]([^\n\r]*)/i;

  md.core.ruler.after('block', 'docs-github-alerts', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      const open = tokens[i];
      const start = i;
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') i++;
      const close = tokens[i];
      if (!close) break;

      let first = null;
      for (let k = start; k <= i; k++) {
        if (tokens[k].type === 'inline') { first = tokens[k]; break; }
      }
      if (!first) continue;
      const match = first.content.match(RE);
      if (!match) continue;

      const type = match[1].toLowerCase();
      /* 名字完全以你自己写的为准：
         `> [!NOTE] 部署须知` → 标题「部署须知」
         `> [!NOTE]`         → 不给标题，不再硬塞「注意」
         类型信息交给 aria-label，屏幕阅读器仍然读得出。 */
      const title = match[2].trim();
      first.content = first.content.slice(match[0].length).replace(/^\s+/, '');

      open.type = 'alert_open';
      open.tag = 'div';
      open.meta = { title, type, defaultTitle: ALERT_TITLES[type] || type };
      close.type = 'alert_close';
      close.tag = 'div';
    }
  });

  md.renderer.rules.alert_open = (tokens, idx) => {
    const meta = tokens[idx].meta || {};
    const type = esc(meta.type || 'note');
    const name = String(meta.title || '').trim();

    /* 写了名字才画标题行；没写就只有内容 + 左侧色条 */
    const head = name
      ? `<p class="markdown-alert-title">${ALERT_ICONS[meta.type] || ''}${inlineTitle(md, name)}</p>`
      : '';

    return `<div class="markdown-alert markdown-alert-${type}" role="note" ` +
           `aria-label="${esc(meta.defaultTitle || name || type)}" ` +
           (name ? '' : 'data-untitled="true"') + '>' + head;
  };
}

/** [[toc]] 目录 */
function tocAdapter(md) {
  md.core.ruler.push('docs-toc', (state) => {
    const tokens = state.tokens;
    let at = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'paragraph_open' &&
          tokens[i + 1] && tokens[i + 1].type === 'inline' &&
          /^\s*\[\[toc\]\]\s*$/i.test(tokens[i + 1].content)) {
        at = i;
        break;
      }
    }
    if (at < 0) return;

    let html = '';
    let count = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const lvl = parseInt(tokens[i].tag.slice(1), 10);
      if (lvl > 3) continue;
      const id = tokens[i].attrGet('id');
      const inline = tokens[i + 1];
      if (!id || !inline || inline.type !== 'inline') continue;
      let text = '';
      inline.children.forEach((c) => {
        if (c.type === 'text' || c.type === 'code_inline' || c.type === 'image') text += c.content;
        else if (c.type === 'softbreak' || c.type === 'hardbreak') text += ' ';
      });
      text = text.trim();
      if (!text) continue;
      count++;
      html += `<a class="md-toc-lv${lvl}" href="#${esc(id)}">${esc(text)}</a>`;
    }
    if (!count) return;

    const block = new state.Token('html_block', '', 0);
    block.content = `<nav class="md-toc" aria-label="本页目录"><p class="md-toc-title">本页目录</p>${html}</nav>\n`;
    tokens.splice(at, 3, block);
  });
}

/**
 * 剧透块：>! 内容
 * 转换成可切换的容器。默认折起，点击标题展开。
 * 行内的 !!剧透!! 由 inlineAdapter 处理，两者互不影响。
 */
function spoilerBlockAdapter(md) {
  md.core.ruler.after('block', 'docs-spoiler-block', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      const open = tokens[i];
      const start = i;
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') i++;
      const close = tokens[i];
      if (!close) break;

      let first = null;
      for (let k = start; k <= i; k++) {
        if (tokens[k].type === 'inline') { first = tokens[k]; break; }
      }
      if (!first) continue;
      /* >! 会被 markdown-it 解析成 "! 内容" */
      if (!/^!\s?/.test(first.content)) continue;

      first.content = first.content.replace(/^!\s?/, '');

      open.type = 'spoiler_open';
      open.tag = 'div';
      open.meta = { label: '剧透' };
      close.type = 'spoiler_close';
      close.tag = 'div';
    }
  });

  md.renderer.rules.spoiler_open = () =>
    '<div class="md-spoiler">' +
    '<button class="md-spoiler-head" type="button" aria-expanded="false">' +
    '<span class="md-spoiler-mark" aria-hidden="true">!</span>' +
    '<span class="md-spoiler-label">剧透 · 点击展开</span>' +
    '</button>' +
    '<div class="md-spoiler-body">';
  md.renderer.rules.spoiler_close = () => '</div></div>\n';
}

/**
 * 任务列表 checkbox 的 id 去随机化
 * ---------------------------------------------------
 * markdown-it-task-lists 用 Math.random() 给每个 checkbox 生成 id：
 *     id="task-item-4839201"
 * 这会让同一份 Markdown 每次构建产出不同的 HTML，构建就不可复现了
 * （缓存、diff、完整性校验全都受影响）。
 *
 * 这里在插件跑完之后，把随机数字换成按出现顺序的编号，
 * id 和它对应的 label[for] 用同一张映射表，保证配得上。
 */
function taskIdAdapter(md) {
  md.core.ruler.push('docs-task-ids', (state) => {
    const map = new Map();
    let seq = 0;

    const fix = (s) =>
      String(s).replace(/(task-item-)\d+/g, (m, prefix) => {
        if (!map.has(m)) map.set(m, prefix + ++seq);
        return map.get(m);
      });

    const walk = (tokens) => {
      for (const t of tokens) {
        if (t.type === 'inline' && t.children) {
          for (const c of t.children) {
            if (c.type === 'html_inline' && c.content && c.content.includes('task-item-')) {
              c.content = fix(c.content);
            }
          }
        }
        if (t.type === 'inline' && typeof t.content === 'string' && t.content.includes('task-item-')) {
          t.content = fix(t.content);
        }
      }
    };

    walk(state.tokens);
  });
}

/**
 * \( ... \) 与 \[ ... \] 公式
 * ---------------------------------------------------
 * markdown-it-texmath 的 delimiters:'dollars' 只认 $...$ 和 $$...$$。
 * 但 MathJax 风格的 \(...\) / \[...\] 也很常见，必须支持。
 *
 * 两个坑：
 *   1. \(...\) 是行内，要换成 $...$；\[...\] 是块级，要换成 $$...$$
 *      （换成 $ 的话块级公式会挤进段落里）
 *   2. texmath 的 $ 定界符**必须紧贴内容**：`$ x $` 不认，`$x$` 才认。
 *      所以拼接时不能带空格，多行内容要先压成一行。
 *
 * 同时要避开代码区：围栏块和行内代码里的反斜杠不能被当成公式。
 */
function mathDelimAdapter(md) {
  md.core.ruler.before('block', 'docs-math-delims', (state) => {
    let src = state.src;
    const stash = [];

    const keep = (s) => {
      stash.push(s);
      return '\u0000K' + (stash.length - 1) + '\u0000';
    };

    /* 1. 围栏代码块整段保护 */
    src = src.replace(/(^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$)/gm, keep);
    /* 2. 行内代码保护 */
    src = src.replace(/`[^`\n]*`/g, keep);

    /* 3. \[ ... \] → $$ ... $$（块级，压成一行） */
    src = src.replace(/\\\[([\s\S]*?)\\\]/g, (m, body) => '$$' + body.trim().replace(/\s*\n\s*/g, ' ') + '$$');
    /* 4. \( ... \) → $ ... $（行内） */
    src = src.replace(/\\\(([\s\S]*?)\\\)/g, (m, body) => '$' + body.trim().replace(/\s*\n\s*/g, ' ') + '$');

    /* 5. 还原 */
    src = src.replace(/\u0000K(\d+)\u0000/g, (m, i) => stash[parseInt(i, 10)]);

    state.src = src;
  });
}

/**
 * 代码组：::: code-group
 * ---------------------------------------------------
 *   ::: code-group
 *   ```js
 *   const a = 1;
 *   ```
 *   ```python
 *   a = 1
 *   ```
 *   :::
 *
 * 渲染成一组标签页，每页一个代码块。
 * 标签文字优先取围栏上的 [label]，没有就用语言名。
 *
 * 为什么不用 markdown-it-code-group：那个包是 0.0.10，
 * peer 锁死 markdown-it ^14（我们用的是 15），而且语法不是 :::。
 * 这里用 container 收容器 + core 规则把里面的围栏组装成 HTML。
 */

/** 从一个围栏的 info 里读出标签文字 */
function fenceLabel(info){
  const s = String(info || '').trim();
  if (!s) return '代码';

  /* [标签] 优先，支持 [标签]js 或 js [标签] 两种写法 */
  const bracketed = /\[([^\]]+)\]/.exec(s);
  if (bracketed) return bracketed[1].trim();

  /* 否则用第一个词当语言名 */
  const lang = /^[a-zA-Z0-9#+._-]+/.exec(s);
  if (!lang) return '代码';

  const map = {
    js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
    py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash', shell: 'Shell',
    html: 'HTML', css: 'CSS', json: 'JSON', yaml: 'YAML', yml: 'YAML',
    md: 'Markdown', markdown: 'Markdown', text: 'Text', plaintext: 'Text',
    c: 'C', cpp: 'C++', java: 'Java', go: 'Go', rust: 'Rust', php: 'PHP',
    sql: 'SQL', xml: 'XML', diff: 'Diff', ini: 'INI',
  };
  return map[lang[0].toLowerCase()] || lang[0];
}

/**
 * container 插件会以 (tokens, idx) 调这里。
 * 标签行留空，由客户端按**真实存在的面板**生成 —— 这样标签数和面板数
 * 永远对得上（预渲染稿/平台渲染稿万一不一致也不会错位）。
 */
function buildFence(tokens, idx){
  const token = tokens[idx];
  if (token.nesting !== 1) return '</div></div>\n';
  return '<div class="code-group">' +
         '<div class="cg-tabs" role="tablist"></div>' +
         '<div class="cg-body">';
}

function codeGroupAdapter(md){
  /* 先用 container 把 ::: code-group 收成容器 token，
     再由 core 规则把容器里的围栏组装成标签页。 */
  md.use(container, 'code-group', { render: buildFence });

  md.core.ruler.after('block', 'docs-code-group', (state) => {
    const tokens = state.tokens;
    let idx = 0;

    for (let i = 0; i < tokens.length; i++){
      if (tokens[i].type !== 'container_code-group_open') continue;

      /* 找到配对的结束标记 */
      let end = i + 1;
      while (end < tokens.length && tokens[end].type !== 'container_code-group_close') end++;

      /* 收集里面的围栏 */
      const fences = [];
      for (let k = i + 1; k < end; k++){
        if (tokens[k].type === 'fence') fences.push(tokens[k]);
      }

      /* 一个都没有：整块丢掉，别在页面上留个空壳 */
      if (!fences.length){
        tokens.splice(i, end - i + 1);
        i--;
        continue;
      }

      const tabs = fences.map((f) => fenceLabel(f.info));
      /* 给每个围栏打标记，并把标签文字挂在 data-label 上 */
      fences.forEach((f, n) => {
        f.meta = f.meta || {};
        f.meta.cgFirst = (n === 0);
        f.meta.cgId = idx;
        f.meta.cgLabel = tabs[n];
      });

      idx++;
      i = end;
    }
  });
}

/**
 * @mdit/plugin-tab 默认「不选中任何标签页」（active = -1）：
 * 只有写了 `@tab:active` 才会有面板可见，否则所有 `.tabs-tab-content`
 * 都是 display:none —— 标签页里一片空白，看起来像语法坏了。
 *
 * 所以这里补一条规则：容器里没人标 active 时，默认选中第一个。
 * 作者显式写了 `@tab:active` 就尊重作者的选择，不动。
 *
 * 为什么不在 openRenderer 里改：`info.data` 和 `tab_open` token 的 meta
 * 是两份数据，渲染器改前者影响不到后者（实测过），必须回到 token 层。
 */
function defaultActiveTab(md, name) {
  md.core.ruler.after(name + '_tabs_core', 'docs-tabs-default-active', (state) => {
    const tokens = state.tokens;
    let seq = -1;      /* 当前容器内第几个 tab，-1 表示不在容器里 */
    let active = -1;

    for (const token of tokens) {
      if (token.type === name + '_tabs_open') {
        const info = token.meta && token.meta.tabsData;
        if (info && info.active < 0) {
          info.active = 0;
          if (info.data && info.data[0]) info.data[0].isActive = true;
          active = 0;
        } else {
          active = info ? info.active : -1;
        }
        seq = 0;
        continue;
      }
      if (token.type === name + '_tabs_close') { seq = -1; active = -1; continue; }
      if (token.type === name + '_tab_open' && seq >= 0) {
        token.meta = token.meta || {};
        token.meta.active = (seq === active);
        seq++;
      }
    }
  });
}

/**
 * 标签页的 HTML 输出。
 * ---------------------------------------------------
 * 类名和 data-* 完全沿用 @mdit/plugin-tab 的默认约定
 * （tabs-tabs-wrapper / tabs-tab-button / data-tab / data-index / data-id /
 *  class="active" / data-active），所以官方那个 register-tab 客户端脚本
 * 拿过来仍然能直接跑。
 *
 * 在它基础上多做了三件事：
 *   1. 补 ARIA（role=tablist/tab/tabpanel、aria-selected、tabindex），
 *      插件默认输出是没有的，读屏用户分不出这是标签页。
 *   2. 只有一个标签时标 data-single，CSS 把没意义的标签行藏掉。
 *   3. 渲染期就定好谁是 active，所以不依赖 JS 也看得见内容
 *      （作者没写 @tab:active 时由 defaultActiveTab 兜底选第一个）。
 */
function tabRenderers(md, name) {
  /* 标签标题支持行内 Markdown（`code`、**粗体**…）。
     插件给的是原文，官方默认渲染器也是拿闭包里的 md 现场 renderInline 的，
     这里保持一致；万一炸了就退回纯文本，不能让一个标题弄坏整页。 */
  function title(text) {
    const raw = String(text == null ? '' : text);
    try {
      return md.renderInline(raw);
    } catch (e) {
      return esc(raw);
    }
  }

  /* 空容器（写了 ::: tabs 却一个 @tab 都没有）会渲染成一个空的边框盒子，
     看起来像坏了。用栈记住哪些 open 是空容器，对应的 close 一起吞掉，
     保证标签成对、不会漏出 </div>。 */
  const emptyStack = [];

  return {
    openRenderer(info) {
      const ns = name + '-';
      const empty = !info.data || info.data.length === 0;
      emptyStack.push(empty);
      if (empty) return '';

      const active = info.active < 0 ? 0 : info.active;
      const idAttr = info.id ? ' data-id="' + esc(info.id) + '"' : '';
      const single = info.data.length === 1 ? ' data-single="true"' : '';

      const buttons = info.data
        .map((d) => {
          const on = d.index === active;
          return (
            '<button type="button" class="' + ns + 'tab-button' + (on ? ' active' : '') + '"' +
            ' role="tab"' +
            ' aria-selected="' + (on ? 'true' : 'false') + '"' +
            ' tabindex="' + (on ? '0' : '-1') + '"' +
            ' data-tab="' + d.index + '"' +
            (d.id ? ' data-id="' + esc(d.id) + '"' : '') +
            (on ? ' data-active' : '') +
            '>' + title(d.title) + '</button>'
          );
        })
        .join('\n    ');

      return (
        '<div class="' + ns + 'tabs-wrapper"' + idAttr + single + '>\n' +
        '  <div class="' + ns + 'tabs-header" role="tablist">\n' +
        '    ' + buttons + '\n' +
        '  </div>\n' +
        '  <div class="' + ns + 'tabs-container">\n'
      );
    },

    closeRenderer() {
      /* 空容器对应的闭合标签也要一起吞掉，否则 </div> 会多出来 */
      return emptyStack.pop() ? '' : '  </div>\n</div>\n';
    },

    tabOpenRenderer(data) {
      const ns = name + '-';
      const on = !!data.isActive;
      return (
        '<div class="' + ns + 'tab-content' + (on ? ' active' : '') + '"' +
        ' role="tabpanel"' +
        ' data-index="' + data.index + '"' +
        (data.id ? ' data-id="' + esc(data.id) + '"' : '') +
        (on ? ' data-active=""' : '') +
        '>\n'
      );
    },

    tabCloseRenderer() {
      return '</div>\n';
    },
  };
}

/** 行内扩展适配 */
function inlineAdapter(md) {
  md.core.ruler.after('inline', 'docs-inline-extra', (state) => {
    state.tokens.forEach((token) => {
      if (token.type !== 'inline' || !token.children) return;
      let changed = false;
      const out = [];
      token.children.forEach((child) => {
        if (child.type !== 'text') { out.push(child); return; }
        const parts = splitByPatterns(child.content);
        if (!parts) { out.push(child); return; }
        changed = true;
        parts.forEach((part) => {
          if (part.text != null) {
            const t = new state.Token('text', '', 0);
            t.content = part.text;
            out.push(t);
          } else {
            const h = new state.Token('html_inline', '', 0);
            h.content = part.html;
            out.push(h);
          }
        });
      });
      if (changed) token.children = out;
    });
  });
}

/** ![alt](url =宽x高) → ![alt](url){width=… height=…} */
function imgSizeAdapter(md) {
  md.core.ruler.before('block', 'docs-img-size', (state) => {
    state.src = state.src.replace(
      /!\[([^\]]*)\]\((<?[^\s>]*>?)\s*=\s*(\d*)\s*x\s*(\d*)\)/g,
      (m, alt, url, w, h) => {
        const a = [];
        if (w) a.push(`width=${w}`);
        if (h) a.push(`height=${h}`);
        return a.length ? `![${alt}](${url}){${a.join(' ')}}` : m;
      },
    );
  });
}

/** 图片：懒加载、主题图、可聚焦 */
function imgRenderAdapter(md) {
  const base = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';

    const mode = /#(dark|light)$/.exec(src);
    if (mode) {
      token.attrSet('src', src.replace(/#(dark|light)$/, ''));
      token.attrSet('data-mode', `${mode[1]}mode-only`);
    }

    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    if (token.attrGet('alt')) token.attrSet('tabindex', '0');

    return base ? base(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
}

/* ═══════════════════════════════════════════════════
   Frontmatter（文章头信息）
   ---------------------------------------------------
   文件开头写一段：

     ---
     title: 枣香童年
     date: 2026-10-06
     tags: [随笔, 童年]
     ---

   解析出来的是「元数据」，正文照常渲染。这一段在
   构建期（预渲染）与浏览器端（现场渲染）走的是同一份代码，
   所以两边排版一模一样 —— 这也是当初把渲染核心抽出来的理由。

   只实现 Markdown 文档真用得上的 YAML 子集：
     · key: value（引号、true/false/null、数字、裸字符串）
     · 行内数组 [a, b, "c"]、行内映射 {k: v}
     · 块数组（- 项，可缩进）
     · 一层嵌套映射
     · 块标量 >（折叠）与 |（原样）
     · 行尾 # 注释（引号里的 # 不算）
   不支持的写法不会抛错，原样当成字符串，宁可难看也别把整篇弄挂。
   ═══════════════════════════════════════════════════ */

/** frontmatter 分隔线：文件第一行 + 一行 `---` 收尾 */
var FM_RE = /^(-{3,})[ \t]*\r?\n([\s\S]*?)\r?\n(-{3,})[ \t]*(?=\r?\n|$)/;

/** 分隔线里最多允许多少行 / 多少字符，超过就不当 frontmatter（防误判长文档） */
var FM_MAX_LINES = 200;
var FM_MAX_CHARS = 8000;

/** 这些键是「控制字段」，只影响构建，不进元数据展示 */
var FM_CONTROL_KEYS = {
  draft: 1, hidden: 1, nopage: 1, slug: 1, permalink: 1, permalinkid: 1,
  layout: 1, template: 1, type: 1, feed: 1, sort: 1, order: 1,
  /* canonical：归档稿用来把重复内容指回真正的地址（见 console/lib/render.mjs） */
  canonical: 1, redirect: 1, alias: 1, aliases: 1, weight: 1, publish: 1,
  /* toc: false 能关掉正文开头自动生成的目录 */
  toc: 1,
};

/** 去掉值后面不属于引号内容的 `# 注释` */
function stripYamlComment(v) {
  var quote = '';
  for (var i = 0; i < v.length; i++) {
    var c = v.charAt(i);
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(v.charAt(i - 1)))) return v.slice(0, i);
  }
  return v;
}

/** `"…"` / `'…'` / 裸值 → 字符串 */
function unquoteYaml(v) {
  var s = String(v).trim();
  if (s.length > 1) {
    var q = s.charAt(0);
    if ((q === '"' || q === "'") && s.charAt(s.length - 1) === q) {
      var inner = s.slice(1, -1);
      if (q === '"') {
        inner = inner.replace(/\\(["\\/nrt])/g, function (m, c) {
          return c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c;
        });
      } else {
        inner = inner.replace(/''/g, "'");
      }
      return inner;
    }
  }
  return s;
}

/** 按顶层逗号切开 `a, b, [c, d], "e,f"` */
function splitTopLevel(s) {
  var out = [], buf = '', depth = 0, quote = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quote) {
      buf += c;
      if (c === '\\' && quote === '"') { buf += s.charAt(++i); continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth <= 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '' || out.length) out.push(buf);
  return out.map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
}

/** 标量：引号 / 布尔 / null / 数字 / 字符串 */
function parseYamlScalar(raw) {
  var v = stripYamlComment(String(raw == null ? '' : raw)).trim();
  if (v === '') return '';
  if (v.charAt(0) === '[' && v.charAt(v.length - 1) === ']') {
    return splitTopLevel(v.slice(1, -1)).map(parseYamlScalar);
  }
  if (v.charAt(0) === '{' && v.charAt(v.length - 1) === '}') {
    var map = {};
    splitTopLevel(v.slice(1, -1)).forEach(function (pair) {
      var i = pair.indexOf(':');
      if (i < 0) return;
      map[unquoteYaml(pair.slice(0, i))] = parseYamlScalar(pair.slice(i + 1));
    });
    return map;
  }
  if (v.charAt(0) === '"' || v.charAt(0) === "'") return unquoteYaml(v);
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^(null|~)$/i.test(v)) return null;
  /* 日期（2026-10-06）、版本号（1.0.0）这类一律留字符串，别被数字吃掉 */
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** 值里的 `key: value` 位置（不在引号 / 括号里）；找不到返回 -1 */
function findKeyColon(line) {
  var quote = '', depth = 0;
  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i);
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    /* 顶层第一个冒号就是键值分隔符；`title: 12:30` 里的第二个冒号不参与 */
    else if (c === ':' && depth <= 0) return i;
  }
  return -1;
}

/** 缩进宽度（tab 当两个空格） */
function yamlIndent(s) {
  var m = /^[ \t]*/.exec(s);
  return m ? m[0].replace(/\t/g, '  ').length : 0;
}

/** 空行或整行注释 */
function yamlBlank(s) {
  return s.trim() === '' || /^\s*#/.test(s);
}

/**
 * 极简 YAML 块解析（游标式）。
 * 只认一层到两层的常见写法，认不出来的行跳过 —— 解析器不能把整篇文档弄挂。
 * @param {string} text
 * @returns {object}
 */
function parseYamlBlock(text) {
  var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  var pos = 0;

  /** 跳过空行与注释 */
  function skipBlank() {
    while (pos < lines.length && yamlBlank(lines[pos])) pos++;
  }

  /**
   * 解析一段「缩进 >= min」的块。
   * @param {number} min
   * @param {boolean} intoArray  - 项开头就是数组
   */
  function parseBlock(min, intoArray) {
    var out = intoArray ? [] : {};
    for (;;) {
      var save = pos;
      skipBlank();
      if (pos >= lines.length) break;
      var line = lines[pos];
      var ind = yamlIndent(line);
      if (ind < min) { pos = save; break; }
      var body = line.slice(ind);

      if (intoArray) {
        if (body.charAt(0) !== '-') break;
        var item = body.slice(1).trim();
        var itemColon = findKeyColon(item);
        if (itemColon > 0) {
          /* `- key: value` + 后续同项缩进行：先按对象解析本项 */
          pos++;
          var first = {};
          var rest0 = item.slice(itemColon + 1).trim();
          first[unquoteYaml(item.slice(0, itemColon))] = rest0 === ''
            ? parseNestedValue(ind + 2)
            : parseYamlScalar(rest0);
          var more = parseBlock(ind + 2, false);
          Object.keys(more).forEach(function (k) { first[k] = more[k]; });
          out.push(first);
          continue;
        }
        out.push(parseYamlScalar(item));
        pos++;
        continue;
      }

      var ci = findKeyColon(body);
      if (ci < 0) { pos++; continue; }          /* 认不出来的行不拦路 */
      var key = unquoteYaml(body.slice(0, ci));
      var rest = body.slice(ci + 1).trim();

      /* 块标量：`>` 折叠 / `|` 原样 */
      if (/^[|>][+-]?\d*$/.test(rest)) {
        var folded = rest.charAt(0) === '>';
        var buf = [];
        var blockIndent = -1;
        pos++;
        while (pos < lines.length) {
          if (lines[pos].trim() === '') { buf.push(''); pos++; continue; }
          var bi = yamlIndent(lines[pos]);
          if (bi <= ind) break;
          if (blockIndent < 0) blockIndent = bi;
          buf.push(lines[pos].slice(blockIndent));
          pos++;
        }
        while (buf.length && buf[buf.length - 1] === '') buf.pop();
        out[key] = folded
          ? buf.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/\n{2,}/g, '\n\n').trim()
          : buf.join('\n').replace(/\s+$/, '');
        continue;
      }

      if (rest === '' || stripYamlComment(rest).trim() === '') {
        pos++;
        out[key] = parseNestedValue(ind + 1);
        continue;
      }

      pos++;
      out[key] = parseYamlScalar(rest);
    }
    return out;
  }

  /** 空值后面缩进的内容：`- ` 开头是数组，`k: v` 开头是映射，否则留空串 */
  function parseNestedValue(min) {
    var save = pos;
    skipBlank();
    if (pos >= lines.length) { pos = save; return ''; }
    var line = lines[pos];
    var ind = yamlIndent(line);
    if (ind < min) { pos = save; return ''; }
    var body = line.slice(ind);
    if (body.charAt(0) === '-') return parseBlock(ind, true);
    if (findKeyColon(body) > 0) return parseBlock(ind, false);
    pos = save;
    return '';
  }

  return parseBlock(0, false);
}

/**
 * 拆出 Markdown 顶部的 frontmatter。
 * @param {string} src
 * @returns {{ok:boolean, data:object, body:string, raw:string}}
 *   ok=false 时 body 就是原文，data 是空对象。
 */
function parseFrontmatter(src) {
  var text = String(src == null ? '' : src).replace(/^\uFEFF/, '');
  var none = { ok: false, data: {}, body: text, raw: '' };
  var m = FM_RE.exec(text);
  if (!m) return none;

  var raw = m[2];
  if (raw.length > FM_MAX_CHARS || raw.split('\n').length > FM_MAX_LINES) return none;
  /* 一段真正的 frontmatter 至少得有一个 `key:` ——
     否则那就是正文开头的一条水平线（`---`），别乱吃内容 */
  if (!/^[ \t]*[^#\s][^:\n]*:/m.test(raw)) return none;

  var data;
  try {
    data = parseYamlBlock(raw);
  } catch (e) {
    return none;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) return none;

  return { ok: true, data: data, body: text.slice(m[0].length), raw: raw };
}

/**
 * 元数据块的字段顺序与中文标签。
 * `date` / `updated` 这类先按这里排，没提到的键排在后面（原样列出）。
 */
var FM_FIELD_ORDER = ['title', 'subtitle', 'date', 'updated', 'author', 'category', 'tags', 'summary'];
var FM_FIELD_LABEL = {
  title: '标题', subtitle: '副标题', date: '日期', updated: '更新',
  author: '作者', category: '分类', tags: '标签', summary: '摘要',
};
/** 摘要字段的几种常见写法，取第一个有值的 */
var FM_SUMMARY_KEYS = ['summary', 'description', 'excerpt', 'abstract', 'intro'];
/** 作者字段的几种写法：单个字符串、数组、或 `authors:` */
var FM_AUTHOR_KEYS = ['author', 'authors'];
/** 作者缺省值（frontmatter 里一个都没写时用它） */
var FM_DEFAULT_AUTHOR = 'JinSuper';
/** 只有这几个字段进「顶部一行」；其余进下面的明细表 */
var FM_INLINE_KEYS = { date: 1, updated: 1, author: 1, authors: 1, category: 1 };

function fmToArray(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter(function (x) { return x !== '' && x != null; });
  return String(v).split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

function fmDisplay(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'object') {
    return Object.keys(v).map(function (k) { return k + '：' + fmDisplay(v[k]); }).join('；');
  }
  return String(v);
}

/**
 * 标签 → 博客首页的筛选锚点。
 * 唯一的定义在这里：正文卡片、文章页、博客首页的标签链接都走它，
 * 免得三处各拼一套、哪天改了前缀就对不上。
 */
function fmTagAnchor(tag) {
  return '/p/#tag-' + encodeURIComponent(String(tag == null ? '' : tag));
}

/** 粗算阅读时间：中文按 350 字/分，西文按 200 词/分 */function fmReadingTime(body) {
  var s = String(body == null ? '' : body);
  var cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  var words = (s.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) || []).length;
  var minutes = Math.max(1, Math.round(cjk / 350 + words / 200));
  return minutes;
}

var FM_CLOCK_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>';
var FM_USER_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="5.6" r="2.6"/><path d="M3.2 13.2c.6-2.3 2.5-3.6 4.8-3.6s4.2 1.3 4.8 3.6"/></svg>';
var FM_TAG_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 7.4 7.6 2.4h5.4v5.4l-5 5z"/><circle cx="10.2" cy="5.4" r="1"/></svg>';

/**
 * frontmatter → 元数据卡片 HTML。
 *
 * 已知字段排成标题 / 摘要 / 一行小字 / 标签，其余键原样列在下面的明细里 ——
 * 「写了什么就能看见什么」，不用为了展示再去改渲染器。
 *
 * @param {object} data   parseFrontmatter().data
 * @param {{title?:string, body?:string, heading?:boolean, exclude?:object}} [opts]
 *   title：frontmatter 没有 title 时用的兜底标题（一般取清单里的名字）
 *   body ：正文，用来算阅读时间
 *   heading：是否把标题渲染成 h1（列表页之类可以关掉）
 */
function renderFrontmatter(data, opts) {
  opts = opts || {};
  var fm = data && typeof data === 'object' ? data : {};
  var out = [];
  var used = {};

  function take(k) { used[k] = 1; return fm[k]; }

  var title = fmDisplay(take('title'));
  if (!title) title = fmDisplay(take('name'));       /* SKILL.md 那种 name: 写法 */
  if (!title) title = opts.title ? String(opts.title) : '';

  var subtitle = fmDisplay(take('subtitle'));
  var summary = '';
  for (var i = 0; i < FM_SUMMARY_KEYS.length; i++) {
    var v = take(FM_SUMMARY_KEYS[i]);
    if (v != null && v !== '') { summary = fmDisplay(v); break; }
  }
  var tags = fmToArray(take('tags'));
  if (!tags.length) tags = fmToArray(take('tag'));

  /* 作者：`author: JinSuper` 与 `author: [JinSuper, ABC]` 都收，
     一个都没写就回落默认作者（站点身份里的那个，见 build/lib/posts.mjs）。 */
  var authors = [];
  for (var ai = 0; ai < FM_AUTHOR_KEYS.length && !authors.length; ai++) {
    authors = fmToArray(take(FM_AUTHOR_KEYS[ai]));
  }
  if (!authors.length) authors = fmToArray(opts.defaultAuthor || FM_DEFAULT_AUTHOR);

  /* 剩下没用过的键：控制字段藏起来，其余原样展示 */
  var rest = [];
  Object.keys(fm).forEach(function (k) {
    if (used[k] || FM_CONTROL_KEYS[String(k).toLowerCase()]) return;
    if (FM_INLINE_KEYS[k]) return;                  /* 这一档在上面那行小字里 */
    if (fm[k] == null || fm[k] === '') return;
    rest.push([FM_FIELD_LABEL[k] || k, fmDisplay(fm[k]), k]);
  });
  /* 预设字段排前面，其余保持书写顺序 */
  var rank = function (k) { var i = FM_FIELD_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  rest.sort(function (a, b) { return rank(a[2]) - rank(b[2]); });

  var head = '';
  if (title && opts.heading !== false) {
    head += '<h1 class="md-fm-title">' + esc(title) + '</h1>\n';
  } else if (title) {
    head += '<p class="md-fm-title md-fm-title-plain">' + esc(title) + '</p>\n';
  }
  if (subtitle) head += '<p class="md-fm-sub">' + esc(subtitle) + '</p>\n';
  if (summary) head += '<p class="md-fm-summary">' + esc(summary) + '</p>\n';

  var bar = [];
  function chip(key, svg, text, cls) {
    if (!text) return;
    bar.push('<span class="md-fm-chip' + (cls ? ' ' + cls : '') + '" data-fm="' + esc(key) + '">' +
      svg + '<span class="md-fm-chip-t">' + esc(text) + '</span></span>');
  }
  chip('date', FM_CLOCK_SVG, fmDisplay(fm.date));
  if (fm.updated && fmDisplay(fm.updated) && fmDisplay(fm.updated) !== fmDisplay(fm.date)) {
    chip('updated', FM_CLOCK_SVG, '更新于 ' + fmDisplay(fm.updated));
  }
  /* 多作者就画多枚（`author: [JinSuper, ABC]`），不硬拼成一行 */
  authors.forEach(function (a) { chip('author', FM_USER_SVG, fmDisplay(a)); });
  chip('category', FM_TAG_SVG, fmDisplay(fm.category));
  if (opts.body != null) chip('reading', FM_CLOCK_SVG, '约 ' + fmReadingTime(opts.body) + ' 分钟', 'md-fm-reading');

  var tagsHtml = '';
  if (tags.length) {
    tagsHtml = '<span class="md-fm-tags" data-fm="tags">' + FM_TAG_SVG +
      tags.map(function (t) {
        /* 标签点得动：跳到博客首页的标签筛选（/p/#tag-xxx） */
        return '<a class="md-fm-tag" href="' + esc(fmTagAnchor(t)) + '">' + esc(fmDisplay(t)) + '</a>';
      }).join('') +
      '</span>';
  }

  if (bar.length || tagsHtml) {
    out.push('<div class="md-fm-chips">' + bar.join('') + tagsHtml + '</div>');
  }
  if (rest.length) {
    out.push('<dl class="md-fm-extra">' + rest.map(function (p) {
      return '<dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd>';
    }).join('') + '</dl>');
  }

  if (!head && !out.length) return '';
  return '<header class="md-fm">\n' + head + out.join('\n') + '\n</header>\n';
}

/* ═══════════════════════════════════════════════════
   组装实例
   ═══════════════════════════════════════════════════ */

/**
 * 创建一个配置好的 markdown-it 实例。
 * @param {{
 *   externalLinkTarget?: boolean,
 *   highlight?: boolean,
 *   setup?: Array<(md) => void>,
 * }} [opts]
 *   externalLinkTarget：外链是否加 target="_blank"（预渲染时我们交给客户端处理，默认 false）
 *   setup：可选的**外挂装配函数**，在全部内置规则装好之后依次调用。
 *     发布控制台用它挂「只在预览里生效」的增强（图表 / 外部 markdown-it 插件），
 *     文档站构建不传这个参数，所以站点产物一个字节都不受影响。
 *     单个 setup 抛错只记进 md.__setupErrors，不会让整篇渲染挂掉。
 */
function createRenderer(opts) {
  opts = opts || {};
  /* highlight:false 时不打 highlight.js 的语言包，代码块退化为纯文本 */
  var useHljs = opts.highlight !== false;
  const slugify = createSlugger();

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: false,
  });

  md.use(footnote);
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  md.use(deflist);
  md.use(sub);
  md.use(sup);
  md.use(mark);
  md.use(ins);
  md.use(abbr);
  md.use(emoji);
  md.use(attrs);

  /* 标题锚点：v10 的 permalink 是函数签名 (slug, opts, state, idx) */
  md.use(anchor, {
    slugify,
    tabIndex: false,
    failOnNonUnique: false,
    uniqueSlugStartIndex: 2,
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '#',
      class: 'anchor',
      space: false,
      placement: 'after',
      ariaHidden: false,
      renderAttrs: () => ({ 'aria-label': '锚点链接' }),
    }),
  });

  /* ::: note / tip / warning … 提示框 */
  Object.keys(BOX_LABELS).forEach((name) => {
    md.use(container, name, {
      render(tokens, idx) {
        if (tokens[idx].nesting === 1) {
          const info = String(tokens[idx].info || '').trim().slice(name.length).trim();
          return `<div class="md-box md-box-${name}"><p class="md-box-title">${inlineTitle(md, info || BOX_LABELS[name])}</p>\n`;
        }
        return '</div>\n';
      },
    });
  });

  /* 数学公式：没注入 KaTeX 就把公式原样留着，不报错 */
  if (katex) {
    md.use(texmath, {
      engine: katex,
      delimiters: 'dollars',
      katexOptions: KATEX_OPTIONS,
    });
  }

  /* 卡片：<card link="…" date="…">标题</card>
     必须在 html_inline 之前注册，否则 <card> 会被当普通 HTML 原样吐出来。 */
  if (DocsCard && typeof DocsCard.plugin === 'function') {
    md.use(DocsCard.plugin);
  }

  /* 代码组 ::: code-group（内部会 md.use(container)） */
  codeGroupAdapter(md);

  /* 标签页 ::: tabs / @tab —— @mdit/plugin-tab 官方插件。
     注册顺序无所谓：人家用的是自己的 block 规则，不走 markdown-it-container。 */
  if (TabPlugin && typeof TabPlugin.tab === 'function') {
    md.use(TabPlugin.tab, Object.assign({ name: TAB_NAME }, tabRenderers(md, TAB_NAME)));
    defaultActiveTab(md, TAB_NAME);
  }

  alertAdapter(md);
  tocAdapter(md);
  spoilerBlockAdapter(md);
  inlineAdapter(md);
  taskIdAdapter(md);
  imgSizeAdapter(md);
  imgRenderAdapter(md);
  mathDelimAdapter(md);
  fenceInfoAdapter(md);
  fenceRule(md, useHljs);

  if (opts.externalLinkTarget) {
    const baseLink = md.renderer.rules.link_open;
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx].attrGet('href') || '';
      if (/^https?:\/\//i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener');
      }
      return baseLink
        ? baseLink(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
    };
  }

  /* 把 slugger 挂出来，给 renderMarkdown 的单例复用做重置用 */
  md.__slugify = slugify;

  /* 外挂装配：控制台预览的图表 / 外部插件走这里（见 render.mjs、md-extras.mjs）。
     放最后是因为它们要包住已经装好的 fence 渲染器（代码块兜底）。 */
  md.__setupErrors = [];
  if (Array.isArray(opts.setup)) {
    opts.setup.forEach((fn, i) => {
      if (typeof fn !== 'function') return;
      try {
        fn(md);
      } catch (e) {
        md.__setupErrors.push('setup[' + i + ']: ' + (e && e.message ? e.message : e));
      }
    });
  }

  return md;
}

/* 单例：给批量预渲染复用，省掉重复构建开销 */
var shared = null;
var enginesReady = false;

/**
 * 自动注入 KaTeX 与 highlight.js。
 * 用同步 require：Node 构建期拿得到。
 * 浏览器 bundle 里这两个是空壳，会走进 catch 静默跳过，
 * 由 bundle 入口按 window 上有什么来 setEngines。
 */
function ensureEngines() {
  if (enginesReady) return;
  enginesReady = true;
  try {
    var k = require('katex');
    var h = require('highlight.js/lib/common');
    setEngines({ katex: k, hljs: h });
  } catch (e) {
    /* 浏览器环境：没有就没有，退化为无公式、无高亮 */
  }
}

/**
 * 从**渲染好的 HTML** 里抽标题，生成正文开头的目录。
 * ---------------------------------------------------
 * 标记与 `[[toc]]` 完全一致（`.md-toc` / `.md-toc-lv{n}`），所以样式只有一份。
 * 为什么按 HTML 抓而不是按 token：文章页 / 归档稿 / 阅读器现场渲染
 * 拿到的都是成品 HTML，这样一处实现三处都能用。
 *
 * 少于两个标题就不生成 —— 只有一节的目录没意义。
 */
function tocEntries(html) {
  var out = [];
  var re = /<h([123])\b([^>]*)>([\s\S]*?)<\/h\1>/g;
  var m;
  while ((m = re.exec(String(html))) !== null) {
    var idm = /\bid="([^"]*)"/.exec(m[2]);
    if (!idm) continue;
    /* 去掉标题尾部的锚点链接，再剥标签、解实体 */
    var inner = m[3].replace(/<a\b[^>]*class="anchor"[\s\S]*?<\/a>/gi, '');
    var text = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ level: Number(m[1]), id: idm[1], text: text });
  }
  return out;
}

/**
 * 把标题层级换成**相对层级**：文档里最浅的那一级算 1。
 * ---------------------------------------------------
 * 有的文档从 h1 起，有的直接从 h2 起（标题写在 frontmatter 里就是这样）。
 * 按绝对级别缩进的话，后者整份目录都会平白缩进一格 —— 看起来就是「没有层次」。
 * 这里统一成「谁在谁下面」，缩进才和文章结构对得上。侧栏目录与正文目录共用。
 */
function normalizeTocLevels(list) {
  var arr = Array.isArray(list) ? list : [];
  if (!arr.length) return [];
  var min = arr.reduce(function (m, e) {
    var lv = Number(e && e.level) || 1;
    return lv < m ? lv : m;
  }, 9);
  return arr.map(function (e) {
    var lv = (Number(e && e.level) || 1) - min + 1;
    return { level: lv < 1 ? 1 : (lv > 6 ? 6 : lv), id: e.id, text: e.text };
  });
}

/** 正文开头的目录（标记与 [[toc]] 一致；只有一个标题时返回空串） */
function buildTocFromHtml(html) {
  var list = normalizeTocLevels(tocEntries(html));
  if (list.length < 2) return '';
  return '<nav class="md-toc" aria-label="本页目录"><p class="md-toc-title">目录</p>' +
    list.map(function (e) {
      return '<a class="md-toc-lv' + e.level + '" href="#' + esc(e.id) + '">' + esc(e.text) + '</a>';
    }).join('') + '</nav>\n';
}

/** 解 HTML 实体（标题里可能有 &amp; &#39; 这类） */
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** 正文开头就是 `# 标题` 吗（有的话就不再另画一个标题） */
function hasLeadingH1(src) {
  return /^\s*#[ \t]+\S/.test(String(src == null ? '' : src));
}

/**
 * 正文开头那行 H1 和 frontmatter 的 title 一模一样时，把它去掉。
 * ---------------------------------------------------
 * 「标题写在 frontmatter 里」之后，正文里那行 `# 同样的标题` 就成了重复的 h1，
 * 页面上会出现两个标题。只在**文字完全相同**且**就在开头**时才动手，
 * 别的情况一个字都不碰。
 */
function stripDuplicateTitle(body, title) {
  var s = String(body == null ? '' : body);
  var t = String(title == null ? '' : title).trim();
  if (!t) return s;
  var m = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?=\r?\n|$)/.exec(s);
  if (!m || m[1].trim() !== t) return s;
  return s.slice(m[0].length).replace(/^[ \t]*\r?\n/, '');
}

/**
 * 用**指定实例**渲染一段 Markdown。
 * 单例 renderMarkdown 之外的实例都要走这里：它会先把标题计数清掉，
 * 否则同一实例连着渲染多篇时，第二篇的标题会莫名带上 -2、-3 后缀。
 *
 * 顶部有 frontmatter 时：这一段不会被当成正文画出来，而是渲染成
 * 开头的元数据卡片（`.md-fm`）；要自己接管这部分就传 `meta:false`，
 * 那时只剥掉 frontmatter，正文照常返回。
 *
 * @param {object} md
 * @param {string} src
 * @param {{meta?:boolean, heading?:boolean, title?:string}} [opts]
 *   title：frontmatter 没写 title 时拿来当标题的名字（一般是清单里的名字），
 *          正文自己已经有 H1 的话就不用它，免得一页两个标题
 */
function renderWith(md, src, opts) {
  if (!md || typeof md.render !== 'function') {
    throw new TypeError('renderWith：第一个参数得是 createRenderer() 出来的实例');
  }
  opts = opts || {};
  var fm = parseFrontmatter(src);
  var data = fm.ok ? fm.data : {};
  var fmTitle = data && (data.title || data.name) ? String(data.title || data.name) : '';
  var body = fm.ok ? fm.body : String(src == null ? '' : src);
  /* 标题写在头上、正文又写一遍的，去掉正文那一行 */
  if (fmTitle) body = stripDuplicateTitle(body, fmTitle);

  if (md.__slugify && typeof md.__slugify.reset === 'function') md.__slugify.reset();
  var html = md.render(body, {});

  /* ── 正文开头的目录（默认关，`toc: true` 才插）──
     阅读器和文章页都另有一份**侧栏目录**，正文里再塞一份通常是重复的，
     所以这里只在作者明确要的时候才画；正文里自己写了 [[toc]] 当然也照画。 */
  var tocOn = data && (data.toc === true || /^(true|yes|on|1)$/i.test(String(data.toc).trim()));
  var tocHtml = (tocOn && opts.toc !== false && !/\[\[toc\]\]/i.test(body))
    ? buildTocFromHtml(html)
    : '';

  if (fm.ok && opts.meta !== false) {
    html = renderFrontmatter(data, {
      body: body,
      heading: opts.heading,
      title: hasLeadingH1(body) ? '' : opts.title,
      defaultAuthor: opts.defaultAuthor,
    }) + tocHtml + html;
  } else if (tocHtml) {
    html = tocHtml + html;
  }
  return html;
}

/** Markdown 源码 → HTML 片段 */
function renderMarkdown(src, opts) {
  ensureEngines();
  if (!shared) shared = createRenderer();
  return renderWith(shared, src, opts);
}



/* ═══════════════════════════════════════════════════
   导出（CommonJS：Node 与自写打包器都能直接用）
   ═══════════════════════════════════════════════════ */
module.exports = {
  KATEX_OPTIONS: KATEX_OPTIONS,
  setEngines: setEngines,
  ensureEngines: ensureEngines,
  createSlugger: createSlugger,
  createRenderer: createRenderer,
  renderWith: renderWith,
  renderMarkdown: renderMarkdown,
  parseFrontmatter: parseFrontmatter,
  renderFrontmatter: renderFrontmatter,
  readingTime: fmReadingTime,
  tagAnchor: fmTagAnchor,
  buildTocFromHtml: buildTocFromHtml,
  tocEntries: tocEntries,
  normalizeTocLevels: normalizeTocLevels,
  decodeEntities: decodeEntities,
  DEFAULT_AUTHOR: FM_DEFAULT_AUTHOR,
  CONTROL_KEYS: FM_CONTROL_KEYS,
};