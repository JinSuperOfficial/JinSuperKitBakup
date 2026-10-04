/**
 * 对比度修复：求解 + 定向替换
 * ---------------------------------------------------
 * 思路：保持色相和饱和度不动，只调亮度，直到对比度达标。
 * 这样视觉性格不变（还是同一套配色），只是「看不清」的变「看得清」。
 *
 * 深背景 → 把前景调亮；浅背景 → 把前景调暗。方向自动判断。
 *
 * 为什么不做全局字符串替换：同一个色值可能在不同主题里含义不同
 * （p/docs.html 有 12 套主题，每套的 --faint 都不一样），
 * 所以替换是**按 selector 块定位**的，只动该块里的那一个变量。
 *
 * 跑法：
 *   node build/fix-contrast.mjs            # 只看方案（dry-run）
 *   node build/fix-contrast.mjs --apply    # 真的改
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot, buildDir } from './paths.mjs';
import { collectHtml } from './lib/favicon.mjs';

const APPLY = process.argv.includes('--apply');
/** 正文级目标。留一点余量，免得刚好卡在 4.5 被四舍五入打下来 */
const TARGET = 4.6;

/* ═══════════ 颜色工具 ═══════════ */

function lum(hex) {
  const c = String(hex).replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6);
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function hexToHsl(hex) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

/**
 * 求一个达标的前景色：保持色相/饱和度，只动亮度。
 * @param {string} bg     背景色
 * @param {string} fg     原前景色
 * @param {number} target 目标对比度
 */
function solve(bg, fg, target = TARGET) {
  if (ratio(fg, bg) >= target) return fg;

  const { h, s, l: l0 } = hexToHsl(fg);
  /* 背景暗 → 前景往亮调；背景亮 → 前景往暗调 */
  const dir = lum(bg) < 0.5 ? 1 : -1;

  let best = fg, bestRatio = ratio(fg, bg);
  for (let i = 1; i <= 100; i++) {
    const l = l0 + dir * i * 0.01;
    if (l < 0 || l > 1) break;
    const c = hslToHex(h, s, l);
    const r = ratio(c, bg);
    if (r > bestRatio) { best = c; bestRatio = r; }
    if (r >= target) return c;
  }
  /* 调亮度到顶还差一点：降一点饱和度再试（灰一点通常更亮/更暗） */
  for (let i = 1; i <= 60; i++) {
    const sv = Math.max(0, s - i * 0.01);
    const l = l0 + dir * Math.min(0.6, i * 0.01);
    if (l < 0 || l > 1) break;
    const c = hslToHex(h, sv, l);
    const r = ratio(c, bg);
    if (r > bestRatio) { best = c; bestRatio = r; }
    if (r >= target) return c;
  }
  return best;
}

/* ═══════════ 解析页面里的颜色块 ═══════════ */

const BG_NAMES = ['--bg', '--background', '--surface', '--surface-2', '--panel', '--raised', '--raised-2'];
const FG_NAMES = ['--ink', '--ink-strong', '--md-ink', '--dim', '--md-dim', '--faint', '--faint-2', '--muted', '--sub', '--note'];

/** 返回 [{ selector, bodyStart, bodyEnd, vars }] */
function findColorBlocks(styles, styleOffset) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(styles))) {
    const selector = m[1].trim().split('\n').pop().trim();
    if (!/^(:root|html|\[data-theme|\[data-mode)/.test(selector) && selector !== '') continue;
    const vars = {};
    for (const v of m[2].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
      vars[v[1]] = v[2];
    }
    if (Object.keys(vars).length < 3) continue;
    blocks.push({
      selector,
      bodyStart: styleOffset + m.index + m[1].length + 1,
      bodyEnd: styleOffset + m.index + m[0].length - 1,
      vars,
    });
  }
  return blocks;
}

/* ═══════════ 主流程 ═══════════ */

/* p/docs.html 是构建产物，真正要改的是模板；
   两个都扫，免得改了产物下次构建又被覆盖回去。 */
const files = [
  ...collectHtml(siteRoot),
  path.join(buildDir, 'template', 'docs.html'),
];

function label(f) {
  return f.startsWith(siteRoot)
    ? path.relative(siteRoot, f).split(path.sep).join('/')
    : 'build/template/' + path.basename(f);
}

const plan = [];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const rel = label(f);
  const html = fs.readFileSync(f, 'utf8');

  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  for (const st of styles) {
    const blocks = findColorBlocks(st[1], st.index + st[0].indexOf(st[1]));

    for (const b of blocks) {
      let bgs = BG_NAMES.filter((n) => b.vars[n]).map((n) => b.vars[n]);
      if (!bgs.length) continue;   /* 没有明确背景就不猜，避免误报 */

      for (const name of FG_NAMES) {
        const fg = b.vars[name];
        if (!fg) continue;

        let worst = Infinity, worstBg = '';
        for (const bg of bgs) {
          const r = ratio(fg, bg);
          if (r < worst) { worst = r; worstBg = bg; }
        }
        if (worst >= TARGET) continue;

        const fixed = solve(worstBg, fg, TARGET);
        if (fixed === fg) continue;
        plan.push({ file: f, rel, selector: b.selector, name, from: fg, to: fixed,
                    bg: worstBg, before: worst, after: ratio(fixed, worstBg),
                    bodyStart: b.bodyStart, bodyEnd: b.bodyEnd });
      }
    }
  }
}

/* ── 输出方案 ── */
console.log(`\n对比度修复方案（目标 ≥ ${TARGET}）\n`);
if (!plan.length) {
  console.log('  没有需要修的。\n');
  process.exit(0);
}

for (const p of plan) {
  console.log(`  ${p.rel}  ${p.selector}`);
  console.log(`    ${p.name}  ${p.from} → ${p.to}   对 ${p.bg}: ${p.before.toFixed(2)} → ${p.after.toFixed(2)}`);
}
console.log(`\n  共 ${plan.length} 处\n`);

if (!APPLY) {
  console.log('  （dry-run，加 --apply 才会真的改）\n');
  process.exit(0);
}

/* ── 应用：按文件分组，从后往前替换，避免偏移错乱 ── */
const byFile = {};
for (const p of plan) (byFile[p.file] = byFile[p.file] || []).push(p);

let changed = 0;
for (const [file, list] of Object.entries(byFile)) {
  let html = fs.readFileSync(file, 'utf8');
  /* 同一个块里可能有多个变量要改，按位置倒序替换 */
  const edits = [];
  for (const p of list) {
    const seg = html.slice(p.bodyStart, p.bodyEnd);
    const re = new RegExp(`(${p.name.replace(/[-]/g, '\\-')}\\s*:\\s*)${p.from}`, 'i');
    const m = re.exec(seg);
    if (m) edits.push({ at: p.bodyStart + m.index + m[1].length, len: p.from.length, to: p.to });
  }
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) {
    html = html.slice(0, e.at) + e.to + html.slice(e.at + e.len);
    changed++;
  }
  fs.writeFileSync(file, html, 'utf8');
}

console.log(`  已应用 ${changed} 处\n`);
