/* ═══════════════════════════════════════════════════
   卡片插件 · docs-card.js（无依赖）
   ---------------------------------------------------
   在 Markdown 里写：

     <card link="idea/1.归途且慢.md">归途，且慢</card>
     <card link="idea/1.归途且慢.md" date="2026.9.27">归途，且慢</card>

   渲染成：

     <a href="/p/docs.html#idea%2F1.%E5%BD%92%E9%80%94%E4%B8%94%E6%85%A2.md" class="card">
       <span class="card-title">归途，且慢</span>
       <span class="card-date">2026.9.27</span>
     </a>

   规则：
     · link 必填 —— 写文件路径（按网站根算），点开时自动交给文档站：
       /p/docs.html#<encodeURIComponent(路径)>，文档站会当场切到这一篇。
       http(s)/mailto 这类外链原样跳转；已经带 #锚点或指向某个 .html 的也不动。
     · date 选填 —— 有才渲染 .card-date 那行小字
     · 标签内的文字就是标题
     · 标签名 card 大小写不敏感；同一段里可以写好几张，互不影响

   两个入口：
     · DocsCard.plugin(md)   行内规则，真正接管 <card> 语法（正常路径）
                             markdown-it 的写法：md.use(DocsCard.plugin)
     · DocsCard.enhance(el)  兜底：把已经是 HTML 的稿件里残留的 <card>
                             元素换成同一套结构
                             （构建期预渲染稿、平台直接渲染的稿件走这条）

   文档站页面路径默认 /p/docs.html，换目录时用 DocsCard.setViewer('/x/docs.html')。

   样式由本文件自己注入 <head>（id="card-plugin-style"，只注入一次），
   不需要在页面里手写 <style> 或 <link>。
   Node 里 require 也不会报错：没有 document 就静默跳过注入。
   ═══════════════════════════════════════════════════ */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DocsCard = api;
})(function () {
  'use strict';

  const STYLE_ID = 'card-plugin-style';

  /* ─────────── 1. 样式（色值与原参数是设计定稿，照抄不改） ───────────
     左边那条 3px 的 Claude 橙竖条（#D97757）是签名元素：
     默认藏起来，hover / 键盘 focus 时才立起来。
     颜色全部走 CSS 变量，暗色亮色都能跟着站点主题走。 */
  const CARD_CSS = `
.card {
  display: block;
  position: relative;
  padding: 18px 22px 18px 26px;
  background: var(--panel, #13181B);
  border: 1px solid var(--line, #232C31);
  border-radius: 8px;
  color: var(--ink, #E7E9E6);
  text-decoration: none;
  overflow: hidden;
  transition: background .18s ease, border-color .18s ease, transform .18s ease;
}

.card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  background: #D97757;
  opacity: 0;
  transform: scaleY(.4);
  transition: opacity .18s ease, transform .18s ease;
}

.card:hover {
  background: var(--raised, #191F23);
  border-color: rgba(217, 119, 87, .36);
  transform: translateY(-2px);
}

.card:hover::before {
  opacity: 1;
  transform: scaleY(1);
}

.card:focus-visible {
  outline: 2px solid #D97757;
  outline-offset: 3px;
  border-color: rgba(217, 119, 87, .36);
}

.card-title {
  display: block;
  font-size: 1.05em;
  font-weight: 600;
  letter-spacing: -.005em;
}

.card-date {
  display: block;
  margin-top: 4px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: .78em;
  color: var(--dim, #7E8A90);
}
`;

  /* ─────────── 2. 站点适配层 ───────────
     docs 页面的正文样式里有一条 .md a{ color:var(--accent); border-bottom:1px solid … }，
     它的优先级比单个 .card 高，会把卡片染成链接色、底下还压一条线。
     这里只是把优先级提上去，色值一律沿用上面的定义 —— 没有新增颜色。 */
  const SITE_CSS = `
.md a.card,
.md a.card:hover,
.md a.card:focus-visible {
  color: var(--ink, #E7E9E6);
  text-decoration: none;
  border-bottom: 0;
}
`;

  const FULL_CSS = CARD_CSS + SITE_CSS;

  /* ─────────── 3. 转义 ───────────
     渲染器直接拼 HTML 字符串，凡是来自 Markdown 的内容都要过一遍。 */

  /** 文本转义：标题用（<script> 之类会变成字面量） */
  const escText = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  /** 属性转义：link / date 用（多转引号，防止 " 逃出属性） */
  const escAttr = (value) =>
    escText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** 标题里多余的空格、换行收成一个空格 */
  const collapse = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

  /* ─────────── 4. link → 文档站深链接 ───────────
     卡片点开时不该直接开 .md 文件：平台会把 .md 渲染成一张没有站点外壳的
     页面，看的还是同一篇东西，却没了侧栏、目录和上一页下一页。
     所以统一交给文档站的深链接：

       link="idea/1.归途且慢.md"
       → /p/docs.html#idea%2F1.%E5%BD%92%E9%80%94%E4%B8%94%E6%85%A2.md

     hash 里的路径按网站根算，文档站打开后会用 # 找到清单里的那一篇。 */

  let viewerPage = '/p/docs.html'; /* 站点挪目录时用 setViewer 换掉 */

  const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/; /* http: mailto: data: … */
  const IS_PAGE = /\.html?$/i;

  /** 交出去的就是这个地址：外链原样，其余都绕文档站 */
  const cardHref = (link) => {
    const raw = String(link == null ? '' : link).trim();
    if (!raw) return raw;
    if (raw.charAt(0) === '#') return raw; /* 页内锚点 */
    if (HAS_SCHEME.test(raw)) return raw; /* 外链：原样跳 */
    if (raw.indexOf('#') >= 0) return raw; /* 自己带了锚点，多半已经是文档站链接 */
    if (IS_PAGE.test(raw.split('?')[0])) return raw; /* 指向某个页面，不用绕 */
    /* 文件路径：去掉开头的斜杠（清单里都是网站根相对路径），整段编码进 hash */
    return viewerPage + '#' + encodeURIComponent(raw.replace(/^\/+/, ''));
  };

  /* ─────────── 5. 标签与属性解析 ─────────── */

  /* 开标签：属性部分按 CommonMark 的 HTML 属性写法匹配，
     引号里的 > 不会把它提前截断。标签名大小写不敏感。 */
  const OPEN_RE = /^<card((?:\s+[^\s"'=<>`]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/i;
  const CLOSE_RE = /<\/card\s*>/i;

  /** 把 link="x" date='y' 这串文本读成对象 */
  const parseAttrs = (raw) => {
    const out = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const name = m[1].toLowerCase();
      out[name] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
    }
    return out;
  };

  /* ─────────── 6. 生成卡片 HTML ─────────── */

  /**
   * 卡片长这样（属性顺序与文档里写的一致）：
   *   <a href="…" class="card">
   *     <span class="card-title">标题</span>
   *   </a>
   * date 为空时整个 .card-date 不出现。
   * link 先过 cardHref 变成文档站深链接，再转义。
   */
  const buildCardHTML = (link, date, title) => {
    let html = `<a href="${escAttr(cardHref(link))}" class="card">\n`;
    html += `  <span class="card-title">${escText(collapse(title))}</span>\n`;
    if (date) html += `  <span class="card-date">${escText(collapse(date))}</span>\n`;
    html += '</a>';
    return html;
  };

  /* ─────────── 7. 样式注入（幂等 + Node 安全） ─────────── */

  /** 往 <head> 塞一次样式；已经塞过就跳过；没有 document（Node）就静默返回 */
  const injectStyle = () => {
    if (typeof document === 'undefined' || !document.head) return false;
    if (document.getElementById(STYLE_ID)) return false;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = FULL_CSS;
    document.head.appendChild(style);
    return true;
  };

  /* ─────────── 8. 行内规则 ─────────── */

  /**
   * <card link="…" date="…">标题</card>
   *
   * 只匹配「一段里从 < 开始的这一小截」，不碰别的 Markdown。
   * 匹配不到（没写 link、没有闭合标签）就返回 false，
   * 让后面的规则接着处理 —— html_inline 照旧能用。
   */
  const cardRule = (state, silent) => {
    const src = state.src;
    if (src.charCodeAt(state.pos) !== 0x3C /* < */) return false;

    const open = OPEN_RE.exec(src.slice(state.pos, state.posMax));
    if (!open) return false;

    const attrs = parseAttrs(open[1] || '');
    const link = attrs.link || attrs.href || '';
    if (!link) return false; /* link 必填，没写就当普通 HTML 放过 */

    const selfClose = open[0].charAt(open[0].length - 2) === '/';
    let end = state.pos + open[0].length;
    let title = '';

    if (!selfClose) {
      const rest = src.slice(end, state.posMax);
      const close = CLOSE_RE.exec(rest);
      if (!close) return false; /* 没有 </card>，交给 html_inline 原样输出 */
      title = rest.slice(0, close.index);
      end += close.index + close[0].length;
    }

    if (!silent) {
      const token = state.push('card', 'a', 0);
      token.attrSet('href', link);
      token.content = title;
      token.meta = { date: attrs.date || '', title: collapse(title) };
    }

    state.pos = end;
    return true;
  };

  /** 渲染成 a.card；token 里的东西都经过转义 */
  const cardRender = (tokens, idx) => {
    const token = tokens[idx];
    const meta = token.meta || {};
    return buildCardHTML(token.attrGet('href') || '', meta.date, meta.title != null ? meta.title : token.content);
  };

  /* ─────────── 9. 插件本体 ─────────── */

  /**
   * md.use(cardPlugin)
   * 幂等：同一个实例上重复 use 也只注册一次。
   */
  const cardPlugin = (md) => {
    if (!md || !md.inline || !md.inline.ruler || !md.renderer) return md;

    injectStyle();

    if (md.__docsCardPlugin) return md;
    md.__docsCardPlugin = true;

    try {
      /* 关键：排在 html_inline 之前，否则 <card> 会被当成普通 HTML 原样吐出来 */
      md.inline.ruler.before('html_inline', 'docs_card', cardRule);
    } catch (err) {
      /* 万一把 html_inline 关了，就抢在兜底的 text 规则前面 */
      try {
        md.inline.ruler.before('text', 'docs_card', cardRule);
      } catch (err2) {
        md.inline.ruler.push('docs_card', cardRule);
      }
    }

    md.renderer.rules.card = cardRender;
    return md;
  };

  /* ─────────── 10. 兜底：收拾已经渲染好的 HTML ─────────── */

  const buildCardEl = (doc, link, date, title) => {
    const a = doc.createElement('a');
    a.setAttribute('href', cardHref(link)); /* 和渲染器同一个地址：文档站深链接 */
    a.className = 'card';

    const t = doc.createElement('span');
    t.className = 'card-title';
    t.textContent = collapse(title);
    a.appendChild(t);

    if (date) {
      const d = doc.createElement('span');
      d.className = 'card-date';
      d.textContent = collapse(date);
      a.appendChild(d);
    }
    return a;
  };

  /**
   * DocsCard.enhance(root)
   * 预渲染稿（构建期渲染好的 HTML）和平台自己渲染的稿子没走行内规则，
   * 里面的 <card …>…</card> 会以未知元素的样子躺在页面上。
   * 这里把它们换成和渲染器完全一样的 a.card 结构。
   * 返回收拾掉的数量。
   */
  const enhance = (root) => {
    if (typeof document === 'undefined' || !root || !root.querySelectorAll) return 0;
    const nodes = root.querySelectorAll('card');
    let count = 0;

    Array.prototype.slice.call(nodes).forEach((node) => {
      if (!node.tagName || node.tagName.toLowerCase() !== 'card') return;
      const link = node.getAttribute('link') || node.getAttribute('href') || '';
      if (!link) return; /* 没写 link 的不动它 */
      const date = node.getAttribute('date') || '';
      const title = node.textContent || '';
      if (!node.parentNode) return;
      node.parentNode.replaceChild(buildCardEl(document, link, date, title), node);
      count++;
    });

    return count;
  };

  /* 页面（浏览器）一加载就先把样式备好 —— 预渲染稿里的卡片也就能立刻上色；
     真正渲染时 cardPlugin 里那次注入会因为 id 已存在直接跳过。 */
  injectStyle();

  return {
    name: 'docs-card',
    plugin: cardPlugin,
    cardPlugin: cardPlugin,
    enhance: enhance,
    inject: injectStyle,
    css: FULL_CSS,
    /** 文档站页面路径，默认 /p/docs.html（站点挪目录时用它换掉） */
    setViewer: (page) => { if (page) viewerPage = String(page); },
    viewer: () => viewerPage,
    /** link → 真正写进 href 的地址（文档站深链接），外部拼同一套结构时用 */
    href: cardHref,
    /** 只转义、不渲染的辅助函数 */
    buildCardHTML: buildCardHTML,
    escAttr: escAttr,
    escText: escText,
  };
});
