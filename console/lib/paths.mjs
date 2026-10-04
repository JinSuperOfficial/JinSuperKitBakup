/**
 * 控制台的路径定义（唯一来源）
 * ---------------------------------------------------
 * 控制台住在项目根下、和站点平行，所以路径全部显式写，不靠 `..` 反推。
 *
 * 目录关系：
 *   F:\@Project\node\                 ← 项目工作空间（workspace）
 *   ├── jinsuper.rth1.xyz\            ← 站点本体（会被整体上传）
 *   │   └── p\                        ← 文档站：文章都在这儿
 *   ├── para\                         ← 归档原文留底（站点之外，不上传）
 *   ├── console\                      ← 这个工具自己（不上传）
 *   └── build\                        ← 构建与测试工具（不上传）
 *
 * 测试要能在临时目录里整套跑一遍，所以根目录支持用环境变量覆盖：
 *   DSH_CONSOLE_ROOT=<临时目录>   → 所有路径跟着这个根走
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** console/ 目录本身 */
export const consoleDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 项目工作空间根（测试里可覆盖） */
export const workspaceRoot = process.env.DSH_CONSOLE_ROOT
  ? path.resolve(process.env.DSH_CONSOLE_ROOT)
  : path.resolve(consoleDir, '..');

/** 站点根 */
export const siteRoot = path.join(workspaceRoot, 'jinsuper.rth1.xyz');

/** 文档站目录：文章都在这里 */
export const pDir = path.join(siteRoot, 'p');

/** 构建工具目录（预渲染核心在那儿） */
export const buildDir = path.join(workspaceRoot, 'build');

/** 前端静态资源 */
export const webDir = path.join(consoleDir, 'web');

/**
 * 控制台状态文件的**所在目录**（设置 + 归档元数据 + 草稿标记）。
 * ---------------------------------------------------
 * 默认就是 console/；测试会把它设成临时目录 ——
 * 否则跑一次测试就会把 fixture 的归档元数据写进真设置里，
 * 而且测试里改的字号/主题会留在人用的那份上（这个真踩过）。
 * 状态文件本身仍然叫 state.json，不进 dist、不会上传。
 */
export const stateDir = process.env.DSH_CONSOLE_STATE_DIR
  ? path.resolve(process.env.DSH_CONSOLE_STATE_DIR)
  : consoleDir;

export const stateFile = path.join(stateDir, 'state.json');

/** 默认的原文留底目录（设置里可改） */
export const defaultParaDir = path.join(workspaceRoot, 'para');

/** 允许读写的根（越界的路径一律拒绝） */
export const ALLOWED_ROOTS = [siteRoot, workspaceRoot];

/* ── 默认设置 ── */

export const DEFAULT_SETTINGS = {
  /** 归档 HTML 的 data-theme：沿用阅读器那 12 套 */
  theme: 'obsidian',
  /** 控制台自己的外观：dark / light（刻意不跟着归档主题变） */
  uiTheme: 'dark',
  editorFontSize: 14,
  autosaveMs: 1500,
  /** 归档产物写到哪儿（站点绝对路径） */
  archiveDir: 'p/archive',
  /** 归档原文留底（工作空间相对路径） */
  paraDir: 'para',
  /** 文档站清单（站点绝对路径） */
  skPath: 'sk.json',
  /** 危险操作（删除 / 覆盖 / 回滚）要不要二次确认 */
  confirmDanger: true,
};

/* ── 路径解析 ── */

/** 「站点绝对路径」或相对写法 → 磁盘绝对路径（只做字符串归一） */
export function resolveSitePath(p) {
  return path.resolve(siteRoot, String(p || '').replace(/^[/\\]+/, ''));
}

/** 磁盘路径 → 站点绝对路径（形如 /p/x.md） */
export function toSiteHref(absOrRel) {
  const abs = path.resolve(siteRoot, String(absOrRel || '').replace(/^[/\\]+/, ''));
  return '/' + path.relative(siteRoot, abs).split(path.sep).join('/');
}

/** p/ 内的相对路径（形如 idea/x.md）；不在 p 下就返回 null */
export function toPRelative(abs) {
  const rel = path.relative(pDir, path.resolve(abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** 统一的路径校验：必须落在允许的根里，且不能穿到根外面 */
export function assertInside(target, root = null) {
  const abs = path.resolve(target);
  const roots = root ? [path.resolve(root)] : ALLOWED_ROOTS;
  const hit = roots.some((r) => {
    const rel = path.relative(r, abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  if (!hit) {
    const err = new Error('路径越界，已拒绝：' + abs);
    err.status = 403;
    throw err;
  }
  return abs;
}

/** sk.json 的绝对路径（设置里可改） */
export function skFile(settings) {
  const rel = (settings && settings.skPath) || DEFAULT_SETTINGS.skPath;
  return assertInside(resolveSitePath(rel), siteRoot);
}

/** 归档产物目录 */
export function archiveDirOf(settings) {
  const rel = (settings && settings.archiveDir) || DEFAULT_SETTINGS.archiveDir;
  return assertInside(resolveSitePath(rel), pDir);
}

/** 原文留底目录 */
export function paraDirOf(settings) {
  const rel = (settings && settings.paraDir) || DEFAULT_SETTINGS.paraDir;
  return assertInside(path.resolve(workspaceRoot, rel), workspaceRoot);
}

export function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * 递归列文件（相对 base 的 posix 路径）。
 * 默认跳过一切点开头的目录（`.versions` 版本备份也算），需要时用 allowDirs 打开。
 */
export function walk(dir, { base = dir, skipDirs = new Set(), allowDirs = new Set() } = {}) {
  const out = [];
  if (!isDir(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue;
      if (e.name.startsWith('.') && !allowDirs.has(e.name)) continue;
      out.push(...walk(abs, { base, skipDirs, allowDirs }));
      continue;
    }
    if (!e.isFile()) continue;
    out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}
