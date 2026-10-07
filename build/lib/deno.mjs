/**
 * 找 Deno
 * ---------------------------------------------------
 * 部署脚本要起 Deno 去上传，但两个平台「Deno 在哪」完全不一样：
 *
 *   Windows      node_modules/.bin/deno.cmd   （批处理包装，得经 cmd /c 起）
 *   Linux / macOS  node_modules/.bin/deno      （sh 软链到 node_modules/deno/deno）
 *
 * deno 这个 npm 包是**按平台分发二进制**的（可选依赖 @deno/win32-x64、
 * @deno/linux-x64-glibc …）。所以从别的系统搬过来的 node_modules，里面那份
 * 二进制在本机是跑不起来的；要是再把 .cmd 当可执行文件挑出来，bash 会拿它
 * 当脚本执行，报一屏 `@ECHO: not found` —— 部署那边就是这么挂的。
 *
 * 所以这里统一按**本平台**找，顺序：
 *   1. node_modules/@deno/<本平台>/deno(.exe)   真二进制，最省事
 *   2. node_modules/deno/deno(.exe)             包装包首次运行时硬链出来的那份
 *   3. node_modules/.bin/deno(.cmd)             npm 生成的包装脚本，兜底
 *
 * 顺带补可执行位：从 Windows / 压缩包搬过来的文件常常没有 x 位，而 POSIX 下
 * 没有 x 位就起不来（.cmd 不需要，也不该补）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';

/* deno npm 包的可选依赖名，按「平台-架构」排；musl 那份没装也无所谓 */
const TARGETS = {
  'linux-x64':    ['linux-x64-glibc', 'linux-x64-musl'],
  'linux-arm64':  ['linux-arm64-glibc', 'linux-arm64-musl'],
  'darwin-x64':   ['darwin-x64'],
  'darwin-arm64': ['darwin-arm64'],
  'win32-x64':    ['win32-x64'],
  'win32-arm64':  ['win32-arm64'],
};

/** POSIX 下补上可执行位（搬过来的文件经常没有 x 位），失败不抛。 */
function ensureExec(p) {
  try {
    if (!(fs.statSync(p).mode & 0o111)) fs.chmodSync(p, 0o755);
  } catch (_e) {
    /* 只读文件系统之类：真起不来时调用方会报错，这里不抢戏 */
  }
}

/**
 * 项目内找 Deno 可执行文件。
 * @param {string} root       项目根（去它下面的 node_modules 里找）
 * @param {string[]} [extra]  额外再找几个目录（比如 build/ 自己的 node_modules）
 * @returns {string|null}     找到的绝对路径；没有就是 null
 */
export function findLocalDeno(root, extra = []) {
  const roots = [root, ...extra];
  const cands = [];

  for (const r of roots) {
    for (const t of TARGETS[`${process.platform}-${process.arch}`] || []) {
      cands.push(path.join(r, 'node_modules', '@deno', t, 'deno' + EXE));
    }
    cands.push(path.join(r, 'node_modules', 'deno', 'deno' + EXE));
  }
  /* 包装脚本垫底：它本身是 sh / cmd，平台不对就跑不起来 */
  for (const r of roots) {
    cands.push(path.join(r, 'node_modules', '.bin', WIN ? 'deno.cmd' : 'deno'));
  }

  for (const c of cands) {
    if (!fs.existsSync(c)) continue;
    if (!WIN && !c.endsWith('.cmd')) ensureExec(c);
    return c;
  }
  return null;
}

/**
 * 系统 PATH 里那个 deno。
 * 只看到文件不算数，得真能跑出 --version —— PATH 上放个 .cmd 之类的坑太多。
 * @returns {string|null} 能用的命令名；没有就是 null
 */
export function systemDeno() {
  for (const c of ['deno', 'deno.exe']) {
    const r = spawnSync(c, ['--version'], { stdio: 'ignore' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}
