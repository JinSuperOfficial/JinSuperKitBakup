/**
 * 极简 CommonJS 打包器（零依赖，不启子进程）
 * ---------------------------------------------------
 * 为什么不用 esbuild / rollup / webpack：
 *   这个沙箱不允许程序创建命名管道，esbuild 的任何 API
 *   （连 transform）都要 spawn 一个服务进程，直接 EPERM。
 *   Rollup / webpack 同理（worker 线程 / 子进程）。
 *
 *   而我们真正要打的东西非常简单：markdown-it 全家桶全是
 *   普通 CJS，没有动态 require、没有 JSON import、没有循环依赖。
 *   所以自己拼一遍最省事，也最可控。
 *
 * 做什么：
 *   · 从入口出发做深度优先，把每个模块包成函数
 *   · 相对路径按所在目录解析；裸模块名按 node_modules 向上解析
 *   · 剥掉 shebang 和 "use strict" 之外没别的特殊处理
 *   · Node 内置模块（fs / path / crypto…）统一塞一个空壳，
 *     这些包在浏览器里本来就只走另一条分支
 *
 * 产出：一个 IIFE，挂到指定的全局名下。
 */

import fs from 'node:fs';
import path from 'node:path';

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'stream',
  'string_decoder', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

/** 从 fromDir 开始向上找 node_modules/<name> */
function resolveBare(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    const hit = resolveAsFileOrDir(candidate);
    if (hit) return hit;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveAsFileOrDir(p) {
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;

  /* 目录：看 package.json 的 main */
  const asDir = p;
  if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
    const pkgPath = path.join(asDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main) {
          const hit = resolveAsFileOrDir(path.join(asDir, pkg.main));
          if (hit) return hit;
        }
      } catch { /* 坏 package.json 就当没有 */ }
    }
    const idx = path.join(asDir, 'index.js');
    if (fs.existsSync(idx)) return idx;
  }

  for (const ext of ['.js', '.cjs', '.json']) {
    if (fs.existsSync(p + ext)) return p + ext;
  }
  return null;
}

/**
 * 打包
 * @param {object} o
 * @param {string} o.entry      入口文件绝对路径
 * @param {string} o.globalName 产物挂到的全局变量名
 * @param {string} [o.banner]   产物顶部注释
 * @param {string[]} [o.externals] 只做空壳、不打进产物的模块名/路径片段
 * @returns {{ code:string, modules:number, bytes:number, warnings:string[], skipped:string[] }}
 */
export function bundleCjs({ entry, globalName, banner = '', externals = [] }) {
  const modules = new Map();   /* absPath -> { id, source, deps:Map } */
  const stubs = new Set();
  const skipped = new Set();
  const warnings = [];
  let nextId = 0;

  const REQURE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g;

  /** 命中 externals 就不打进去。'x/y' 匹配 'x/y' 本身及其子路径 */
  function isExternal(spec) {
    return externals.some((e) => spec === e || spec.startsWith(e + '/'));
  }

  function addModule(absPath) {
    const real = fs.realpathSync(absPath);
    if (modules.has(real)) return modules.get(real).id;

    const id = nextId++;
    /* 先占位，避免循环依赖递归爆栈 */
    const rec = { id, path: real, source: '', deps: new Map() };
    modules.set(real, rec);

    let src = fs.readFileSync(real, 'utf8');
    /* JSON 模块：直接包成 module.exports = {...} */
    if (real.endsWith('.json')) {
      rec.source = `module.exports = ${src.trim()};`;
      return id;
    }

    src = src.replace(/^#!.*\n/, '');

    rec.source = src.replace(REQURE_RE, (m, q, spec) => {
      const dir = path.dirname(real);

      if (isExternal(spec)) {
        skipped.add(spec);
        return `__stub(${JSON.stringify(spec)})`;
      }

      if (NODE_BUILTINS.has(spec) || spec.startsWith('node:')) {
        const bare = spec.replace(/^node:/, '');
        stubs.add(bare);
        return `__stub(${JSON.stringify(bare)})`;
      }

      let target = null;
      if (spec.startsWith('.') || spec.startsWith('/')) {
        target = resolveAsFileOrDir(path.resolve(dir, spec));
      } else {
        target = resolveBare(spec, dir);
      }

      if (!target) {
        warnings.push(`未解析的依赖：${spec}（来自 ${path.relative(process.cwd(), real)}）`);
        stubs.add(spec);
        return `__stub(${JSON.stringify(spec)})`;
      }

      /* 解析出来的真实路径若命中 externals，也跳过 */
      if (externals.some((e) => target.replace(/\\/g, '/').includes('/' + e + '/'))) {
        skipped.add(spec);
        return `__stub(${JSON.stringify(spec)})`;
      }

      const depId = addModule(target);
      rec.deps.set(depId, target);
      return `__req(${depId})`;
    });

    return id;
  }

  const entryId = addModule(entry);

  /* ── 组装 ── */
  const parts = [];
  parts.push(banner);
  parts.push('(function(){');
  parts.push("'use strict';");
  parts.push('var __defs = {}, __cache = {};');
  parts.push('var __stubCache = {};');
  parts.push('function __stub(name){');
  parts.push('  if (!__stubCache[name]) {');
  parts.push('    if (typeof console !== "undefined" && console.warn) console.warn("[bundle] 浏览器里没有 " + name + "，已用空对象兜底");');
  parts.push('    __stubCache[name] = {};');
  parts.push('  }');
  parts.push('  return __stubCache[name];');
  parts.push('}');
  parts.push('function __req(id){');
  parts.push('  if (__cache[id]) return __cache[id].exports;');
  parts.push('  var m = __cache[id] = { exports: {} };');
  parts.push('  var fn = __defs[id];');
  parts.push('  if (!fn) throw new Error("模块缺失: " + id);');
  parts.push('  fn(m, m.exports, __req);');
  parts.push('  return m.exports;');
  parts.push('}');

  for (const rec of modules.values()) {
    parts.push(`__defs[${rec.id}] = function(module, exports, require){`);
    parts.push(rec.source);
    parts.push('};');
  }

  /* 收尾：把入口的导出挂到全局。
     但如果入口自己已经设过这个全局（比如它在内部就写了 window.DocsMd = {...}），
     就不要用 module.exports 去覆盖它 —— 入口没写 module.exports 时那个值是空的，
     覆盖过去会让整个包变成 {}，页面上所有方法全部变成 undefined。 */
  parts.push('var __entryExports = __req(' + entryId + ');');
  parts.push(
    'if (typeof window !== "undefined" && window[' + JSON.stringify(globalName) + '] === undefined) {' +
    '  window[' + JSON.stringify(globalName) + '] = __entryExports;' +
    '}',
  );
  parts.push('})();');
  const code = parts.join('\n');
  return {
    code,
    modules: modules.size,
    bytes: Buffer.byteLength(code, 'utf8'),
    warnings,
    skipped: [...skipped],
  };
}
