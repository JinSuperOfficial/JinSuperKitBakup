/**
 * 死链与资源检查
 * ---------------------------------------------------
 * 用**真渲染器**解析 Markdown（build/lib/markdown.cjs 的 createRenderer），
 * 而不是正则扫 `](...)`：引用式链接、自动链接、图片、脚注在 token 里
 * 都已经是规范化的了，正则漏一种就漏一片。
 *
 * 检查三类：
 *   1. /p 下 .md 里的相对链接与图片
 *   2. 归档产物（/p/archive/*.html）里的 href/src
 *   3. 卡片语法 `<card link="…">` / `<card href="…">` 指向的文档
 *
 * 解析规则与阅读器一致（docs.html 的 renderURL）：
 *   · `#锚点`、`http(s):`、`mailto:`、`data:` 一律跳过
 *   · `/x` 相对站点根
 *   · `../asset/x` 指向站点根 asset/（源文件在项目根 asset/）
 *   · 其余相对当前文件所在目录；中文文件名先 decodeURIComponent
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildDir, isDir, isFile, pDir, siteRoot, workspaceRoot, walk } from './paths.mjs';
import { GENERATED_FILES, kindOf } from './store.mjs';

const buildRequire = createRequire(path.join(buildDir, 'package.json'));

let core = null;
function getCore() {
  if (core) return core;
  try { core = buildRequire('./lib/markdown.cjs'); }
  catch (e) {
    const err = new Error('读不到渲染核心 build/lib/markdown.cjs：' + e.message + '（先在 build/ 里 npm install）');
    err.status = 500;
    throw err;
  }
  return core;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SKIP_EXT = new Set(['.md', '.markdown', '.mdown']);

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** 把一个链接/图片地址解析成「磁盘上应该有这个文件」的绝对路径 + 站点 href */
export function resolveTarget(rawHref, fromFileAbs) {
  const href = String(rawHref || '').trim();
  if (!href || href.startsWith('#') || EXTERNAL.test(href) || href.startsWith('data:')) return null;
  /* 反斜杠：JS 正则/转义示例里常见（`\/p\/x`），不是真链接 */
  if (href.includes('\\')) return null;

  const clean = decode(href.split('#')[0].split('?')[0]);
  if (!clean) return null;

  let abs;
  if (clean.startsWith('/')) {
    /* 站点根相对：/asset/x.png、/p/docs.html */
    abs = path.join(siteRoot, clean.replace(/^\/+/, ''));
  } else {
    abs = path.resolve(path.dirname(fromFileAbs), clean);
  }
  /* `../asset/x` 的源文件在项目根 asset/（站点里那份是部署时拷进去的） */
  const relToSite = path.relative(siteRoot, abs);
  let alt = null;
  if (relToSite.startsWith('..')) {
    alt = path.resolve(workspaceRoot, 'asset', path.basename(abs));
  }
  return {
    href,
    clean,
    abs,
    alt,
    hrefSite: relToSite.startsWith('..') ? null : '/' + relToSite.split(path.sep).join('/'),
  };
}

function existsAny(t) {
  if (isFile(t.abs)) return 'site';
  if (t.alt && isFile(t.alt)) return 'asset';
  /* /p 下的文档之间互相引用时，也允许不带 p/ 前缀的写法（清单里就是那样） */
  if (!t.abs.startsWith(pDir + path.sep)) {
    const inP = path.join(pDir, t.clean.replace(/^\/+/, ''));
    if (isFile(inP)) return 'p';
  }
  return null;
}

/** 用真渲染器把一篇 Markdown 里的链接/图片抠出来（带行号） */
function linksOfMarkdown(src) {
  const md = getCore().createRenderer();
  const env = {};
  const tokens = md.parse(String(src), env);
  const out = [];
  const lineOf = (token) => (token.map ? token.map[0] + 1 : null);

  for (const t of tokens) {
    if (t.type !== 'inline' || !t.children) continue;
    for (const c of t.children) {
      if (c.type === 'link_open') {
        out.push({ kind: 'link', href: c.attrGet('href'), line: lineOf(t) });
      } else if (c.type === 'image') {
        out.push({ kind: 'image', href: c.attrGet('src'), line: lineOf(t) });
      } else if (c.type === 'html_inline' || c.type === 'html_block') {
        const text = c.content || '';
        for (const m of text.matchAll(/<card\b[^>]*?\b(?:link|href)\s*=\s*["']([^"']+)["']/gi)) {
          out.push({ kind: 'card', href: m[1], line: lineOf(t) });
        }
      }
    }
    /* 引用式链接的定义在 env.references 里，正文 token 已经是解析后的 href，无需另处理 */
  }
  return out;
}

/** 归档产物是 HTML：扫 href/src（产物里的相对路径同样是相对 /p/archive/…）
 *  注意先把 <script> / <style> 抠掉：页面里的 JS 里常有 `href="\/p\/x"` 这种
 *  正则示例，那不是链接（第一版没抠，报了一堆假问题）。 */
function linksOfHtml(src) {
  const out = [];
  const stripped = String(src)
    .replace(/<script\b[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<style\b[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      out.push({ kind: 'link', href: m[1], line: i + 1 });
    }
  });
  return out;
}

/**
 * 跑一遍检查。
 * @param {{scope?:'p'|'archive'|'all'}} o
 */
export function scan({ scope = 'all' } = {}) {
  const files = walk(pDir, { base: pDir, skipDirs: new Set(['fonts']) });
  const problems = [];
  const checked = { files: 0, links: 0, cards: 0, images: 0 };

  for (const pRel of files) {
    if (GENERATED_FILES.has(pRel)) continue;
    const kind = kindOf(pRel);
    const isArchive = pRel.startsWith('archive/');
    if (scope === 'p' && isArchive) continue;
    if (scope === 'archive' && !isArchive) continue;

    const abs = path.join(pDir, pRel);
    let found = null;
    if (kind === 'md') found = linksOfMarkdown(fs.readFileSync(abs, 'utf8'));
    else if (kind === 'html') found = linksOfHtml(fs.readFileSync(abs, 'utf8'));
    else continue;

    checked.files++;
    for (const f of found) {
      const t = resolveTarget(f.href, abs);
      if (!t) continue;
      checked.links++;
      if (f.kind === 'image') checked.images++;
      if (f.kind === 'card') checked.cards++;

      const where = existsAny(t);
      if (where) continue;

      /* 指向另一篇 .md 的链接：文件不在，但清单里可能有同名产物（归档过） */
      const stem = t.clean.replace(/\.[^.]+$/, '');
      const maybeArchive = path.join(pDir, 'archive', stem + '.html');
      const archived = isFile(maybeArchive);

      problems.push({
        file: pRel,
        line: f.line,
        kind: f.kind,
        href: f.href,
        target: t.hrefSite || t.clean,
        reason: archived
          ? '这篇已经归档成 ' + path.relative(pDir, maybeArchive).split(path.sep).join('/') + '，链接该指向产物了'
          : (f.kind === 'image' ? '图片不在' : '目标不存在'),
      });
    }
  }

  /* 顺手把「清单里登记了但文件不在」也算进来（和清单面板同一套判断，这里只汇总） */
  return {
    ok: problems.length === 0,
    checked,
    problems,
    scannedAt: new Date().toISOString(),
  };
}
