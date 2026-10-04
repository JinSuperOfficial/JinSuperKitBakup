/**
 * 从 logo.svg 生成网站图标
 * ---------------------------------------------------
 * 图形来源：asset/icon/logo.svg（矢量，viewBox 0 0 1024 1024）
 *
 * 产出（站点根，用文件路径引用，不用 base64）：
 *   favicon.svg           浏览器标签页
 *   apple-touch-icon.svg  iOS 主屏 / 分享
 *
 * 为什么用 SVG 而不是 PNG：
 *   不需要 SVG 渲染器（我们只动 fill 和 viewBox），矢量在任何 DPI 下都清晰，
 *   而且体积小得多。现代浏览器都支持 SVG favicon。
 *
 * 颜色：用品牌强调色 Claude 橙 #D97757。
 *   原图 fill 是 #231815（近黑）——那是给浅色底设计的，
 *   放到深色标签栏上基本看不见。
 *
 * 跑法：node build/make-favicon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './paths.mjs';

const SRC = path.join(siteRoot, 'asset', 'icon', 'logo.svg');
const ACCENT = '#D97757';

/** 从 logo.svg 里抠出 viewBox 和所有 path 的 d */
function readLogo(svg) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] || '0 0 1024 1024';
  const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!ds.length) throw new Error('logo.svg 里没找到 <path d="…">');
  return { viewBox, ds };
}

/** 拼一个干净的 SVG：只有 viewBox + 路径，fill 统一成品牌色 */
function buildSvg(viewBox, ds, fill, size) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"` +
               (size ? ` width="${size}" height="${size}"` : '') +
               ` role="img" aria-label="JinSuper">`;
  const body = ds.map((d) => `<path fill="${fill}" d="${d}"/>`).join('');
  return head + body + '</svg>\n';
}

if (!fs.existsSync(SRC)) {
  console.error('找不到 ' + SRC);
  process.exit(1);
}

const svg = fs.readFileSync(SRC, 'utf8');
const { viewBox, ds } = readLogo(svg);

console.log('\n生成网站图标\n');
console.log(`  源图 asset/icon/logo.svg  viewBox=${viewBox}  ${ds.length} 条路径`);

const jobs = [
  { out: 'favicon.svg', size: 0 },              /* 不写死尺寸，交给浏览器 */
  { out: 'apple-touch-icon.svg', size: 180 },
];

for (const job of jobs) {
  const out = buildSvg(viewBox, ds, ACCENT, job.size);
  const dest = path.join(siteRoot, job.out);
  fs.writeFileSync(dest, out, 'utf8');
  console.log(`  ${job.out.padEnd(22)} ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`);
}

/* 旧的头像图标：不再引用它们，但保留文件不动（author.png 你可能还有别的用途） */
for (const stale of ['favicon.png', 'apple-touch-icon.png']) {
  const p = path.join(siteRoot, stale);
  if (fs.existsSync(p)) {
    console.log(`  ⚠ ${stale} 还在（旧头像版，已不再引用；确认不需要可以删掉）`);
  }
}
console.log('');
