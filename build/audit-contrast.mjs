/**
 * 全站对比度审计
 * ---------------------------------------------------
 * 把每个页面里定义的颜色变量抽出来，按 WCAG 算对比度，
 * 列出不达标的地方。改颜色之前先跑它，改完再跑一次对比。
 *
 * 判定基准（theme-plus 的硬规则）：
 *   正文级 ≥ 4.5:1
 *   大文本 ≥ 3:1
 *   纯装饰（序号、分隔标记）可以不到 4.5，但至少要看得见
 *
 * 背景取哪个：页面里最深的那几个（bg / surface / panel / raised），
 * 对每个前景色取「最差情况」，这样不会漏掉某个主题组合。
 *
 * 跑法：node build/audit-contrast.mjs
 *      node build/audit-contrast.mjs --all   连通过的行也列出来
 */
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './paths.mjs';
import { collectHtml } from './lib/favicon.mjs';

const SHOW_ALL = process.argv.includes('--all');

/* ── WCAG 对比度 ── */
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

/* ── 从 CSS 文本里抽变量（按块分组，兼容多主题） ── */
function extractVarGroups(css) {
  const groups = [];

  /* 每个 { ... } 块里的变量收集成一组 */
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const selector = m[1].trim().split('\n').pop().trim();
    const body = m[2];
    const vars = {};
    for (const v of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
      vars[v[1]] = v[2];
    }
    if (Object.keys(vars).length >= 3) {
      /* 只看像颜色定义的块（:root、data-theme 等） */
      if (/^(:root|html|\[data-theme|\[data-mode|\.theme)/.test(selector) || selector === '') {
        groups.push({ selector: selector || '(anonymous)', vars });
      }
    }
  }
  return groups;
}

/** 哪些变量名算「背景」 */
const BG_NAMES = ['--bg', '--background', '--surface', '--surface-2', '--panel', '--raised', '--raised-2', '--card-bg'];
/** 哪些变量名算「前景文字」 */
const FG_NAMES = ['--ink', '--ink-strong', '--md-ink', '--text', '--fg',
                  '--dim', '--md-dim', '--faint', '--faint-2', '--muted', '--sub', '--note'];

const files = collectHtml(siteRoot);
const problems = [];
let checked = 0;

for (const f of files) {
  const rel = path.relative(siteRoot, f).split(path.sep).join('/');
  const html = fs.readFileSync(f, 'utf8');

  /* 把 <style> 里的内容抠出来 */
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join('\n');
  if (!styles) continue;

  const groups = extractVarGroups(styles);
  for (const g of groups) {
    /* 背景候选：必须有明确的 bg 类变量。没有就不猜 ——
       否则会把 --ink 自己当背景，算出 1.00 这种假问题。 */
    const bgs = BG_NAMES.filter((n) => g.vars[n]).map((n) => g.vars[n]);
    if (!bgs.length) continue;

    for (const name of FG_NAMES) {
      const fg = g.vars[name];
      if (!fg) continue;
      checked++;
      /* 取最差情况 */
      let worst = Infinity, worstBg = '';
      for (const bg of bgs) {
        const r = ratio(fg, bg);
        if (r < worst) { worst = r; worstBg = bg; }
      }
      const isDeco = /faint|muted|sub|note/.test(name);
      const need = isDeco ? 4.5 : 4.5;
      if (worst < need) {
        problems.push({ rel, selector: g.selector, name, fg, bg: worstBg, ratio: worst, need });
      } else if (SHOW_ALL) {
        console.log(`  ok   ${rel} ${g.selector} ${name} ${worst.toFixed(2)}`);
      }
    }
  }
}

/* ── 报告 ── */
console.log('\n全站对比度审计（正文要求 ≥ 4.5:1）\n');
if (!problems.length) {
  console.log(`  检查了 ${checked} 个前景色组合，全部达标。\n`);
} else {
  const byFile = {};
  for (const p of problems) (byFile[p.rel] = byFile[p.rel] || []).push(p);

  for (const [rel, list] of Object.entries(byFile).sort()) {
    console.log(`  ${rel}`);
    for (const p of list.sort((a, b) => a.ratio - b.ratio)) {
      console.log(`    ${p.ratio.toFixed(2).padStart(5)}  ${p.name.padEnd(12)} ${p.fg}  对 ${p.bg}   ${p.selector}`);
    }
  }
  console.log(`\n  共 ${problems.length} 处不达标（检查了 ${checked} 个组合）\n`);
}
process.exit(problems.length ? 1 : 0);
