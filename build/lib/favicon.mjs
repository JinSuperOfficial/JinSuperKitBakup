/**
 * favicon 注入（唯一实现，各处共用）
 * ---------------------------------------------------
 * 图标是文件（favicon.png / apple-touch-icon.png），按平台规则用路径引用，
 * 不用 base64。
 *
 * 两处会用到：
 *   · build.mjs         —— 生成 docs.html 时替换 __FAVICON__ 占位符
 *   · add-favicon.mjs   —— 给站点里那些手写的页面补上标签
 * 逻辑写在这里，免得两边各写一份、哪天改了对不上。
 *
 * 路径按每个页面到网站根的深度算：
 *   /index.html        → ./favicon.png
 *   /p/docs.html       → ../favicon.png
 *   /Skills/tools/x.html → ../../favicon.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../paths.mjs';

/** 构建期占位符：模板里先写着它，生成时替换成真正的相对路径 */
export const FAVICON_PLACEHOLDER = '__FAVICON__';

/** 一个页面离网站根有几层，返回 './' 或 '../' 这样的前缀 */
export function relPrefix(fileAbs) {
  const rel = path.relative(siteRoot, fileAbs).split(path.sep).join('/');
  const depth = rel.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** 生成 favicon 的两行 <link>（pre 是 ./ 或 ../）
 *  用 SVG：矢量、体积小（1.9 KB）、任何 DPI 都清晰，现代浏览器都支持。 */
export function faviconTags(pre = './') {
  return `<link rel="icon" type="image/svg+xml" href="${pre}favicon.svg">\n` +
         `<link rel="apple-touch-icon" href="${pre}apple-touch-icon.svg">`;
}

/** 页面里是否已经用的是新版 SVG 图标 */
export function hasFavicon(html) {
  return /rel=["'](?:shortcut )?icon["'][^>]*href=["'][^"']*favicon\.svg/i.test(html);
}

/** 页面里是否还挂着旧的 PNG 图标（头像那版） */
export function hasLegacyFavicon(html) {
  return /rel=["'](?:shortcut )?icon["'][^>]*href=["'][^"']*favicon\.png/i.test(html) ||
         /rel=["']apple-touch-icon["'][^>]*href=["'][^"']*apple-touch-icon\.png/i.test(html);
}

/**
 * 把旧的 PNG 图标引用换成 SVG。
 * 先删掉那两行旧 link，再在 charset 后插入新的。
 * @returns {string|null} 换好了返回新 HTML；没旧引用返回 null
 */
export function upgradeFavicon(html, pre) {
  if (!hasLegacyFavicon(html)) return null;

  let out = html
    .replace(/^[ \t]*<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>[ \t]*\r?\n?/gim, '')
    .replace(/^[ \t]*<link[^>]*rel=["']apple-touch-icon["'][^>]*>[ \t]*\r?\n?/gim, '');

  const tags = faviconTags(pre);
  if (/<meta\s+charset[^>]*>/i.test(out)) {
    out = out.replace(/(<meta\s+charset[^>]*>)/i, `$1\n${tags}`);
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/(<head[^>]*>)/i, `$1\n${tags}`);
  } else {
    return null;
  }
  return out;
}

/** 不动的目录（归档层） */
export const SKIP_DIRS = new Set(['old', 'node_modules', '.git']);

/** 收集站点里的 html */
export function collectHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectHtml(path.join(dir, e.name), out);
    } else if (e.isFile() && /\.html?$/i.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}
