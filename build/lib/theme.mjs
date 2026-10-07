/**
 * 主题 token 的搬运工
 * ---------------------------------------------------
 * 12 套配色定义在 build/template/docs.html 的 <style> 里（那是唯一的源文件）。
 * 静态文章页（/p/post/*.html）是独立页面，同样要跟着主题走，
 * 但绝不能把那 12 套色值再抄一遍 —— 抄一遍就意味着以后必然分叉。
 *
 * 所以：构建时从模板里**抠出**这些规则块，原样塞进文章页。
 * 抠不到（模板改了写法）就直接抛错，让构建当场失败 —— 悄悄生成一个
 * 配色全丢的文章页，比构建失败难查得多。
 */

/** 要搬的规则块：:root 的公共 token、12 套 data-theme、顶栏效果 data-glass */
const BLOCK_RE = /(^|\n)(:root\s*\{[^}]*\}|\[data-theme="[^"]*"\]\s*\{[^}]*\}|html\[data-glass="[^"]*"\]\s*\{[^}]*\})/g;

const THEME_COUNT = 12;

/**
 * @param {string} templateHtml build/template/docs.html 的原文
 * @returns {string} 可以直接嵌进 <style> 的 CSS
 */
export function extractThemeCss(templateHtml) {
  const found = [];
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(templateHtml)) !== null) found.push(m[2].trim());

  const roots = found.filter((b) => b.startsWith(':root'));
  const themes = found.filter((b) => b.startsWith('[data-theme='));
  const glass = found.filter((b) => b.startsWith('html[data-glass='));

  if (roots.length !== 1) {
    throw new Error(`模板里的 :root 规则块应该只有 1 个，实际 ${roots.length} 个（build/template/docs.html）`);
  }
  if (themes.length < THEME_COUNT) {
    throw new Error(`模板里只找到 ${themes.length} 套配色，少于 ${THEME_COUNT} 套 —— 主题块的写法是不是变了？`);
  }

  return [
    '/* 下面这一段是从 build/template/docs.html 里抠出来的（build/lib/theme.mjs），', 
    '   改配色请改模板，改完重新构建。 */',
    roots[0],
    '',
    ...themes,
    '',
    ...glass,
  ].join('\n');
}
