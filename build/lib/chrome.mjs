/**
 * 文章外壳（顶栏 / 两列布局 / 侧栏目录 / 页脚）
 * ---------------------------------------------------
 * 「构建出来的静态文章页」和「控制台烘的归档稿」长得必须一模一样，
 * 所以这些零件只做一份，两边都从这里拿：
 *
 *   build/build.mjs            → /p/post/*.html（构建期注入模板）
 *   console/lib/render.mjs     → /p/archive/*.html（控制台烘成品）
 *
 * 分成三块，各归各的源文件：
 *   · 样式  build/template/post-chrome.css（build.mjs 注入 `<style>`，控制台内联）
 *   · 脚本  build/template/post-script.js（同上）
 *   · 骨架  chromeBody()（下面这个函数）
 *
 * 别把 CSS / 导航项 / 目录标记在这些地方各抄一份 —— 一抄就分叉。
 * 配色 token 也不在这儿：从 build/template/docs.html 抠（build/lib/theme.mjs）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractThemeCss } from './theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(here, '..', 'template');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 文章外壳的样式（原样返回，交给调用方塞进 <style>） */
export function chromeCss() {
  return fs.readFileSync(path.join(templateDir, 'post-chrome.css'), 'utf8');
}

/** 文章外壳的脚本（原样返回，交给调用方塞进 <script>） */
export function chromeScript() {
  return fs.readFileSync(path.join(templateDir, 'post-script.js'), 'utf8');
}

/** 主题 token：从阅读器模板里抠，避免 12 套配色抄第二遍 */
export function chromeThemeCss() {
  return extractThemeCss(fs.readFileSync(path.join(templateDir, 'docs.html'), 'utf8'));
}

/**
 * 站点顶栏的导航项。
 * ---------------------------------------------------
 * 阅读器 / 博客首页 / 文章页 / 归档稿共用这一份：改导航只动这里。
 * 当前项只留「百宝箱」这一个站点总入口（工具站不再单列）。
 *
 * @param {string} [current] 当前页的 id（home / timeline / tags / reader / rss / site）
 * @param {{blogHome?:string, feedUrl?:string}} [opts] 地址（默认就是本站的写法）
 */
export function siteNavHtml(current, opts = {}) {
  const blogHome = opts.blogHome || '/p/';
  const feedUrl = opts.feedUrl || blogHome + 'feed.xml';
  const items = [
    { id: 'home', label: '博客', href: blogHome },
    { id: 'timeline', label: '时间线', href: blogHome + '#timeline' },
    { id: 'tags', label: '标签', href: blogHome + '#tags' },
    { id: 'reader', label: '阅读器', href: blogHome + 'docs.html' },
    { id: 'rss', label: 'RSS', href: feedUrl },
    { id: 'site', label: '百宝箱', href: '/', wide: 1 },
  ];
  return items.map((it) => {
    const cls = [it.id === current ? 'on' : '', it.wide ? 'wide' : ''].filter(Boolean).join(' ');
    return `<a href="${esc(it.href)}"${cls ? ` class="${cls}"` : ''}` +
      `${it.id === current ? ' aria-current="page"' : ''}>${esc(it.label)}</a>`;
  }).join('');
}

/** 目录列表项（层级由 normalizeTocLevels 归一：最浅的一级就是 lv-1） */
export function tocListHtml(items) {
  return (items || []).map((e) =>
    `<li class="lv-${e.level}"><a href="#${esc(e.id)}" data-target="${esc(e.id)}"` +
    ` title="${esc(e.text)}">${esc(e.text)}</a></li>`).join('\n      ');
}

/**
 * 侧栏目录整块。
 * ---------------------------------------------------
 * 规则只有一条：**有东西可列就画**（一节也算）。正文里一个小节都没有时
 * 退回「文章标题 → #post」这一条 —— 短文（随笔那种通篇没有小标题的）也得有
 * 「本页目录」，页面形状才和别的文章一致；真的什么都没有才不画
 * （`.wrap` 于是保持单列铺满，不然文章会被挤进 212px 的目录列里）。
 *
 * @param {Array} items 目录项（level / id / text，层级已归一）
 * @param {{title?:string, id?:string, listId?:string, fallbackTitle?:string, fallbackId?:string}} [opts]
 */
export function tocAsideHtml(items, opts = {}) {
  const list = tocListWithFallback(items, opts);
  if (!list.length) return '';
  const id = opts.id || 'ptoc';
  const listId = opts.listId || 'ptocList';
  const title = opts.title || '本页目录';
  return `<aside class="ptoc" id="${esc(id)}" aria-label="${esc(title)}">\n` +
    `    <p class="ptoc-title">${esc(title)}</p>\n` +
    `    <ul id="${esc(listId)}">\n      ${tocListHtml(list)}\n    </ul>\n` +
    '  </aside>';
}

/**
 * 目录项，含「没有小节时的兜底条目」。
 * 兜底条目指向正文容器本身（文章页 / 归档稿都是 `id="post"`），
 * 点它是回到文章开头 —— 比摆一个空的目录框诚实。
 */
export function tocListWithFallback(items, opts = {}) {
  const list = (items || []).slice();
  if (list.length) return list;
  const text = opts.fallbackTitle ? String(opts.fallbackTitle).trim() : '';
  if (!text) return [];
  return [{ level: 1, id: opts.fallbackId || 'post', text }];
}

/** 正文区的类名：有目录才是两列网格 */
export function wrapClassOf(tocHtml) {
  return tocHtml ? 'wrap has-toc' : 'wrap';
}

/**
 * 整页骨架：顶栏 + 正文区（侧栏目录 / 文章 / 附加块 / 页脚）。
 *
 * 调用方负责给内容：导航项、目录项、正文 HTML、上下篇、页脚。
 * 骨架本身不认「文章页还是归档稿」，两边共用同一份标记，
 * CSS 与脚本才可能真的通用。
 */
export function chromeBody(opts = {}) {
  const {
    brandHref = './',
    brandTitle = '',
    brandSubHtml = '',
    logoHtml = '',
    navHtml = '',
    tocHtml = '',
    articleHtml = '',
    afterHtml = '',
    footerHtml = '',
  } = opts;

  const out = [];
  out.push('<header class="top">');
  out.push(`  <a class="brand" href="${esc(brandHref)}">`);
  if (logoHtml) out.push('    ' + logoHtml);
  out.push(`    <span>${esc(brandTitle)}</span>`);
  if (brandSubHtml) out.push('    ' + brandSubHtml);
  out.push('  </a>');
  out.push('  <nav class="top-nav" aria-label="站点导航">');
  out.push('    ' + navHtml);
  out.push('  </nav>');
  out.push('</header>');
  out.push('');
  out.push(`<main class="${wrapClassOf(tocHtml)}">`);
  out.push('');
  if (tocHtml) {
    out.push('  <!-- 侧栏目录：目录项由正文章节生成（不足两条整块不出现） -->');
    out.push('  ' + tocHtml);
    out.push('');
  }
  out.push('  <article class="md" id="post">');
  out.push(articleHtml);
  out.push('  </article>');
  if (afterHtml) {
    out.push('');
    out.push(afterHtml);
  }
  if (footerHtml) {
    out.push('');
    out.push('  <footer class="foot">');
    out.push(footerHtml);
    out.push('  </footer>');
  }
  out.push('</main>');
  return out.join('\n');
}

/** 页脚里那一行链接（`.foot-row` 的内容） */
export function footRowHtml(parts) {
  return '    <div class="foot-row">\n' +
    (parts || []).map((p) => '      ' + p).join('\n') + '\n    </div>';
}
