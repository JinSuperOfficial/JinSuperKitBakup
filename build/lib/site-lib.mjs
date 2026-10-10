/**
 * 在 Node 里加载站点自己的 /lib/manifest.js
 * ---------------------------------------------------
 * 站点那个文件是「经典脚本 + UMD 尾巴」：浏览器里挂 window.JSManifest，
 * 有 module.exports 时（就在下面这个 vm 沙箱里）走 CommonJS 分支。
 * 于是清单规则永远只有一份实现，构建脚本和页面不会走样。
 *
 * 用法：
 *   import { loadManifestLib } from './lib/site-lib.mjs';
 *   const M = loadManifestLib();      // { normalizeCollection, ICON_NAMES, … }
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { siteRoot } from '../paths.mjs';

export const manifestLibPath = path.join(siteRoot, 'lib', 'manifest.js');

let cached = null;

/** 加载并缓存站点运行时的导出对象 */
export function loadManifestLib() {
  if (cached) return cached;
  const src = fs.readFileSync(manifestLibPath, 'utf8');
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(src, sandbox, { filename: manifestLibPath });
  cached = sandbox.module.exports;
  return cached;
}

/**
 * 读一个清单文件并归一（Node 侧，不走 fetch）。
 * @param {string} relOrAbs '/class/tools.json' 或绝对路径
 * @returns {{ok:boolean, file:string, raw:any, error?:string} & ReturnType<loadManifestLib>['normalizeCollection']}
 */
export function readCollection(relOrAbs, opts = {}) {
  const M = loadManifestLib();
  /* 站点路径一律写成 '/class/tools.json'；Windows 上 '/' 开头会被 path 当成盘根，所以先判断 */
  const winAbs = /^[a-zA-Z]:[\\/]/.test(relOrAbs) || relOrAbs.startsWith('\\\\');
  const file = winAbs ? relOrAbs : path.join(siteRoot, String(relOrAbs).replace(/^\/+/, ''));
  const base = opts.base || dirOfSite(relOrAbs);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = M.normalizeCollection(raw, { base, collection: opts.collection, strict: opts.strict !== false });
    return { ok: true, file, raw, ...out };
  } catch (err) {
    const message = String((err && err.message) || err);
    return {
      ok: false,
      file,
      raw: null,
      error: message,
      collection: opts.collection || '',
      title: '',
      root: '',
      items: [],
      problems: [{ level: 'error', code: 'read-failed', message: `读不到 / 解析失败：${relOrAbs} —— ${message}` }],
    };
  }
}

/** '/class/tools.json' → '/class/' */
export function dirOfSite(p) {
  const s = String(p).split(/[?#]/)[0];
  const i = s.lastIndexOf('/');
  return i < 0 ? '/' : s.slice(0, i + 1);
}
