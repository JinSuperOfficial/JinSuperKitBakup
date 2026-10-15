#!/usr/bin/env node
/**
 * build/make-icon.mjs —— 生成桌面版的两个图标
 * ---------------------------------------------------------------
 *   build/icon.svg + icon.ico          班级百宝箱（暖橘，站点 favicon 的形状）
 *   build/icon-hwk.svg + icon-hwk.ico  作业编辑器（青绿，同一套线条）
 *
 * 图标不是另画一套：底色块 + 站点 favicon.svg 里那几根线条原样搬过来，
 * 只换主色，这样「811 套装」里两个快捷方式是同一个记号的两个身份。
 *
 * 依赖 ImageMagick（`magick` 或 `convert`）把 SVG 栅格化；
 * 换了 favicon 就重跑一次：`node build/make-icon.mjs`。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const favicon = path.join(root, 'jinsuper.rth1.xyz', 'favicon.svg');
const outSvg = path.join(here, 'icon.svg');
const outIco = path.join(here, 'icon.ico');
const tmpPng = path.join(here, '.icon-512.png');

const ACCENT = '#D97757';
const BG_TOP = '#241F19';
const BG = '#17140F';

const svg = fs.readFileSync(favicon, 'utf8');
const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/g)].map((m) => m[1]);
if (!paths.length) {
  console.error('favicon.svg 里没找到 <path>，图标没法生成');
  process.exit(1);
}

// favicon 是 1024 画布；搬到 512 的画布上，缩到 320 见方、居中。
const scale = 320 / 1024;
const offset = (512 - 320) / 2;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="JinSuper 百宝箱">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="rgba(237,231,223,.10)" stroke-width="3"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="${ACCENT}">
${paths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>
`;

function buildSvg(accent, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="rgba(237,231,223,.10)" stroke-width="3"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="${accent}">
${paths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>
`;
}

const ACCENT_HWK = '#5FA98C';

const targets = [
  { svg: path.join(here, 'icon.svg'), ico: path.join(here, 'icon.ico'), accent: ACCENT, label: 'JinSuper 百宝箱' },
  { svg: path.join(here, 'icon-hwk.svg'), ico: path.join(here, 'icon-hwk.ico'), accent: ACCENT_HWK, label: 'JinSuper 作业编辑器' },
];

for (const t of targets) {
  fs.writeFileSync(t.svg, buildSvg(t.accent, t.label), 'utf8');
  console.log('写出', path.relative(root, t.svg));
}

const magick = (() => {
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
})();

if (!magick) {
  console.warn('没找到 ImageMagick（magick / convert），只写了 svg；.ico 需要自己转。');
  process.exit(0);
}

for (const t of targets) {
  const tmp = tmpPng.replace(/\.png$/, '-' + path.basename(t.ico, '.ico') + '.png');
  execFileSync(magick, ['-background', 'none', '-density', '384', t.svg, '-resize', '512x512', tmp], { stdio: 'inherit' });
  execFileSync(magick, [tmp, '-define', 'icon:auto-resize=256,128,64,48,32,16', t.ico], { stdio: 'inherit' });
  fs.rmSync(tmp, { force: true });
  console.log('写出', path.relative(root, t.ico));
}
