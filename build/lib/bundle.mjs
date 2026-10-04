/**
 * 浏览器端渲染器打包
 * ---------------------------------------------------
 * 用自写的 CJS 打包器（见 bundler.mjs）把渲染器打进一个 IIFE，
 * 挂到 window.DocsMd，供 p/docs.html 在浏览器里现场渲染 Markdown。
 *
 * 功能必须是完整的 —— 公式、代码高亮、脚注、任务列表、告示框……
 * 一个都不能少。所以 KaTeX 和 highlight.js 都在这里打进去。
 *
 * 产物不含任何外链、不含 Mermaid（Mermaid 已按决定下线）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { bundleCjs } from './bundler.mjs';

/**
 * 入口脚本。
 *
 * 三件事：
 *   1. 注入 KaTeX 与 highlight.js —— createRenderer 用它们排版公式和高亮代码
 *   2. 建好渲染器实例
 *   3. 暴露 window.DocsMd 给页面用
 *
 * 注意 highlight.js 这里只要 core + 语言子集，
 * 全量 common 包有 36 种语言、接近 1MB，太重了。
 */
const ENTRY = `'use strict';
var M = require('./lib/markdown.cjs');
var katex = require('katex');
var hljs = require('highlight.js/lib/core');

/* 只注册常用的语言。要加语言就在这里加一行，然后重新构建。
   （拿不准就用 require('highlight.js/lib/common')，代价是 +800KB） */
require('highlight.js/lib/languages/xml')(hljs);
require('highlight.js/lib/languages/css')(hljs);
require('highlight.js/lib/languages/javascript')(hljs);
require('highlight.js/lib/languages/typescript')(hljs);
require('highlight.js/lib/languages/json')(hljs);
require('highlight.js/lib/languages/yaml')(hljs);
require('highlight.js/lib/languages/bash')(hljs);
require('highlight.js/lib/languages/shell')(hljs);
require('highlight.js/lib/languages/python')(hljs);
require('highlight.js/lib/languages/php')(hljs);
require('highlight.js/lib/languages/sql')(hljs);
require('highlight.js/lib/languages/markdown')(hljs);
require('highlight.js/lib/languages/diff')(hljs);
require('highlight.js/lib/languages/ini')(hljs);
require('highlight.js/lib/languages/plaintext')(hljs);

M.setEngines({ katex: katex, hljs: hljs });

var md = M.createRenderer();

window.DocsMd = {
  ready: function(){ return true; },
  full: function(){ return true; },
  missing: function(){ return []; },

  /* Markdown 源码 → HTML 字符串 */
  render: function(src){ return md.render(String(src == null ? '' : src), {}); },

  /* 渲染进指定元素 */
  renderInto: function(el, src){
    if (!el) return '';
    var html = window.DocsMd.render(src);
    el.innerHTML = html;
    return html;
  },

  version: 'local',
};

/* 也走 module.exports，这样打包器无论按哪条路取都能拿到真东西 */
module.exports = window.DocsMd;
`;

/** 什么都不排除：公式和高亮都要 */
const EXTERNALS = [];

export function buildBrowserBundle({ root, siteRoot }) {
  const entryFile = path.join(root, '.entry-browser.cjs');
  fs.writeFileSync(entryFile, ENTRY, 'utf8');

  try {
    const result = bundleCjs({
      entry: entryFile,
      globalName: 'DocsMd',
      banner: '/* 文档站渲染器 · 本地打包，无 CDN · 由 build/lib/bundle.mjs 生成，请勿手改 */',
      externals: EXTERNALS,
    });

    const outPath = path.join(siteRoot, 'p', 'docs-md.js');
    fs.writeFileSync(outPath, result.code, 'utf8');

    return {
      file: 'docs-md.js',
      bytes: result.bytes,
      modules: result.modules,
      warnings: result.warnings,
      skipped: result.skipped,
    };
  } finally {
    fs.rmSync(entryFile, { force: true });
  }
}
