/**
 * 给站点里手写的页面补 favicon 标签
 * ---------------------------------------------------
 * docs.html 由 build.mjs 管（模板里有 __FAVICON__ 占位符），
 * 这个脚本管其余那些直接手写的页面。
 *
 * 幂等：已有图标就跳过。跳过 old/（归档层不动）。
 *
 * 跑法：node add-favicon.mjs
 *      node add-favicon.mjs --check   只看会改哪些
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './paths.mjs';
import { collectHtml, faviconTags, hasFavicon, relPrefix, upgradeFavicon } from './lib/favicon.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const files = collectHtml(siteRoot);

let changed = 0, skipped = 0, noHead = 0, upgraded = 0;

console.log('\n注入 favicon\n');

for (const f of files) {
  const rel = path.relative(siteRoot, f).split(path.sep).join('/');
  const html = fs.readFileSync(f, 'utf8');

  /* 已经是新版 SVG 图标 → 跳过 */
  if (hasFavicon(html)) { skipped++; continue; }

  const pre = relPrefix(f);

  /* 还挂着旧的头像 PNG → 换成 SVG */
  const up = upgradeFavicon(html, pre);
  if (up) {
    if (CHECK_ONLY) console.log(`  升级 ${rel}   PNG → SVG`);
    else fs.writeFileSync(f, up, 'utf8');
    changed++; upgraded++;
    continue;
  }

  /* 完全没有 → 插进去 */
  const tags = faviconTags(pre);
  let out = null;
  if (/<meta\s+charset[^>]*>/i.test(html)) {
    out = html.replace(/(<meta\s+charset[^>]*>)/i, `$1\n${tags}`);
  } else if (/<head[^>]*>/i.test(html)) {
    out = html.replace(/(<head[^>]*>)/i, `$1\n${tags}`);
  }

  if (!out) { noHead++; continue; }

  if (CHECK_ONLY) {
    console.log(`  新增 ${rel}   → ${pre}favicon.svg`);
  } else {
    fs.writeFileSync(f, out, 'utf8');
  }
  changed++;
}

console.log(`  ${CHECK_ONLY ? '待处理' : '已注入'} ${changed} 个页面` + (upgraded ? `（其中 ${upgraded} 个是从旧 PNG 升级）` : ''));
if (skipped) console.log(`  已是 SVG 图标，跳过 ${skipped} 个`);
if (noHead) console.log(`  ⚠ 没有 <head>，跳过 ${noHead} 个`);
console.log('');
