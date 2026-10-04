/**
 * 站点 logo（唯一来源：asset/icon/logo.svg）
 * ---------------------------------------------------
 * 页面里需要的是**内联 SVG**，不是 <img src>：
 *   · 内联才能用 fill:currentColor 跟着主题色走（12 套主题都能适配）
 *   · 少一次请求
 *
 * favicon 那份是独立的 svg 文件（make-favicon.mjs 生成），
 * 因为 favicon 必须是文件路径、不能内联。
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../paths.mjs';

const SRC = path.join(siteRoot, 'asset', 'icon', 'logo.svg');

/** 读 logo.svg，取出 viewBox 和所有 path 的 d */
export function readLogo() {
  if (!fs.existsSync(SRC)) return null;
  const svg = fs.readFileSync(SRC, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] || '0 0 1024 1024';
  const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) return null;
  return { viewBox, ds };
}

/**
 * 生成可内联的 logo SVG。
 * @param {object} [o]
 * @param {string} [o.fill]  填充色，默认 currentColor（跟主题走）
 * @param {string} [o.className]
 * @param {string} [o.label]  aria-label；给了才加 role/aria
 */
export function inlineLogo({ fill = 'currentColor', className = '', label = '' } = {}) {
  const logo = readLogo();
  if (!logo) return '';

  const cls = className ? ` class="${className}"` : '';
  const aria = label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true" focusable="false"';
  const paths = logo.ds.map((d) => `<path fill="${fill}" d="${d}"/>`).join('');

  return `<svg${cls} viewBox="${logo.viewBox}" xmlns="http://www.w3.org/2000/svg"${aria}>${paths}</svg>`;
}

/** 构建期占位符：模板里写着它，build 时换成真的内联 logo */
export const LOGO_PLACEHOLDER = '__LOGO__';
