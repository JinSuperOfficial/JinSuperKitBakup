/**
 * 预渲染器（控制台专用）
 * ---------------------------------------------------
 * 职责：Markdown → 可以直接当正文用的 HTML，外加一个能独立打开的整页外壳。
 *
 * 它**复用构建期的服务端渲染核心** `build/lib/markdown.cjs`，而不是另写一套。
 * 为什么这样满足约束：
 *   · 约束说的是「别改网页版渲染器 docs-md.js」——这里一个字节都没碰它；
 *   · 「能力覆盖全部现代语法插件」——markdown.cjs 与 docs-md.js 语法一一对应
 *     （KaTeX / highlight.js / 告示 / 提示框 / 选项卡 / 代码组 / 剧透 / 脚注 /
 *      卡片 / 目录 / 注音 / 任务列表 / 定义列表 / 上下标 / 标记 / emoji …）；
 *   · 「不要和已有的重叠」——重叠的是**同一份实现**，不是第二份。
 *     两份渲染装配代码并行维护才是真风险（改一处漏一处），这里刻意避免。
 *
 * 拿不到渲染核心时（比如 build/node_modules 没装）会给出可读错误，
 * 由 API 层转成 500 并把原因回给界面，而不是静默产出半成品。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDir, isFile } from './paths.mjs';

/* build/lib 下的文件按 CJS 加载；它自己的 require('markdown-it') 等会从
   build/node_modules 解析 —— 所以控制台不需要再装一遍依赖。 */
const buildRequire = createRequire(path.join(buildDir, 'package.json'));

let core = null;
let coreError = null;

/** 懒加载渲染核心；只加载一次 */
export function getCore() {
  if (core || coreError) return core;
  try {
    core = buildRequire('./lib/markdown.cjs');
    return core;
  } catch (e) {
    coreError = e;
    const err = new Error(
      '读不到预渲染核心 build/lib/markdown.cjs：' + (e && e.message ? e.message : e) +
      '\n（它依赖 build/node_modules，先在 build/ 里跑一次 npm install）',
    );
    err.status = 500;
    throw err;
  }
}

/** 渲染核心是否就绪（界面用来自检） */
export function coreStatus() {
  try {
    getCore();
    return { ok: true, file: path.join(buildDir, 'lib', 'markdown.cjs') };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/** Markdown 源码 → HTML 片段（就是阅读器注入正文的那一段） */
export function renderFragment(md) {
  return getCore().renderMarkdown(String(md == null ? '' : md));
}

/**
 * 从站点根相对路径（如 p/archive/idea/1.html）算出回到站点根需要几级 ../
 * ---------------------------------------------------
 * 段数 − 1 = 该文件所在目录的深度（`p/archive/idea/1.html` → 3 级），
 * 也就是要往上走几次才到站点根。
 */
export function rootPrefixFor(siteRelPath) {
  const segs = String(siteRelPath).split('/').filter(Boolean);
  return '../'.repeat(Math.max(0, segs.length - 1));
}

/**
 * 从站点根相对路径算出回到 /p/ 目录需要几级 ../
 * ---------------------------------------------------
 * 归档产物在 /p/archive/…，而 docs-md.css 与 docs-card.js 住在 /p/ 下。
 * 这两个前缀不一样，混用会写出死链：
 *   p/archive/x.html        → 站点根 ../../ 、 /p ../
 *   p/archive/idea/x.html   → 站点根 ../../../ 、 /p ../../
 * （早先把 CSS 也接在站点根前缀上，产物里就成了 /docs-md.css → 404，
 *   独立打开产物时没有样式；2026-10 的死链检查把它抓出来了。）
 */
export function pDirPrefixFor(siteRelPath) {
  const segs = String(siteRelPath).split('/').filter(Boolean);
  return '../'.repeat(Math.max(0, segs.length - 2));
}

const ESC = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 组装归档产物的整页外壳。
 *
 * 结构要点：
 *   · 正文固定包在 `<div class="md">` 里 —— 阅读器 SPA 内联这段 HTML 时，
 *     CSS 与后续脚本（代码组、选项卡、复制按钮、card 兜底）都按这个类名接管；
 *   · 样式表用相对前缀指回站点根的 docs-md.css，所以这个文件**单独打开也是完整的**；
 *   · 会执行脚本（代码组标签、选项卡、复制按钮、卡片），但不带任何 CDN。
 */
export function renderArticleHtml(md, opts = {}) {
  const title = opts.title || '归档文档';
  const siteRel = opts.siteRel || 'p/archive/doc.html';
  const prefix = rootPrefixFor(siteRel);
  const pPrefix = pDirPrefixFor(siteRel);
  const html = renderFragment(md);

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${ESC(opts.theme || 'obsidian')}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${ESC(title)} · 归档预渲染稿">
<title>${ESC(title)} · JinSuper</title>
<!-- 由发布控制台预渲染：源 Markdown 在项目根 para\\ 留底，这里是成品 -->
<link rel="stylesheet" href="${pPrefix}docs-md.css">
<style>
  /* 独立打开时的最小外壳：阅读器内联这份片段时用不到这些规则 */
  html,body{margin:0;background:#0E1214;color:#DCE0DE}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .doc-wrap{max-width:820px;margin:0 auto;padding:40px 24px 96px}
  .doc-foot{margin-top:56px;padding-top:16px;border-top:1px solid #232C31;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#869298}
  .doc-foot a{color:#D97757}
</style>
</head>
<body>
<div class="doc-wrap">
<div class="md">
${html}
</div>
<div class="doc-foot">这是归档预渲染稿 · 原文留底在项目工作空间 · <a href="${prefix}p/docs.html">回到文档站</a></div>
</div>
<script src="${prefix}p/docs-card.js"></script>
<script src="${prefix}p/docs-md.js"></script>
</body>
</html>
`;
}

/* ── 版本备份：归档产物覆盖前先留一份 ── */

/** 版本目录（放在归档目录下，点开头，扫描时会跳过） */
export function versionsDirOf(archiveDir) {
  return path.join(archiveDir, '.versions');
}

/**
 * 把现有产物存进 .versions，并裁到最近 keep 份。
 * @returns {string[]} 被清掉的旧版本绝对路径
 */
export function backupVersion(fileAbs, archiveDir, keep = 2) {
  if (!isFile(fileAbs)) return [];
  const dir = path.join(versionsDirOf(archiveDir), path.relative(archiveDir, path.dirname(fileAbs)));
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(fileAbs);
  fs.copyFileSync(fileAbs, path.join(dir, base + '.' + stamp + '.bak'));

  /* 只留最近 keep 份 */
  const all = fs.readdirSync(dir)
    .filter((n) => n.startsWith(base + '.') && n.endsWith('.bak'))
    .sort();
  const removed = [];
  while (all.length > keep) {
    const victim = path.join(dir, all.shift());
    try { fs.unlinkSync(victim); removed.push(victim); } catch { /* 删不掉不影响归档 */ }
  }
  return removed;
}

/** 列出某个产物已有的版本（新的在前） */
export function listVersions(fileAbs, archiveDir) {
  const dir = path.join(versionsDirOf(archiveDir), path.relative(archiveDir, path.dirname(fileAbs)));
  const base = path.basename(fileAbs);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.startsWith(base + '.') && n.endsWith('.bak'))
    .sort()
    .reverse()
    .map((n) => ({ name: n, abs: path.join(dir, n) }));
}
