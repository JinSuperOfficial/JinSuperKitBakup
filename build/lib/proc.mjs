/**
 * 跑一个步骤（子进程）
 * ---------------------------------------------------
 * 两种模式，按需要挑：
 *   · inherit —— 直接接到当前终端（spawnSync，stdio:'inherit'）。
 *                命令行里跑部署就用它：子进程的颜色、进度、热铁盒 CLI 的提示
 *                全都原样保留，输出一个字都不经过我们手里。
 *   · pipe    —— 抓 stdout/stderr 按行回调，同时 tee 到日志文件。
 *                ink TUI 与控制台作业用它：能实时显示，也不会丢掉日志。
 *
 * 为什么还要 fd 模式：某些受限沙箱里，Node 用管道抓子进程输出会 EPERM。
 * 那就退到「把日志文件当子进程的标准输出」（stdio:['ignore',fd,fd]），
 * 全程不碰命名管道，界面改成读文件 tail。部署通道不能因为显示方式而挂。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/**
 * @typedef {object} Step
 * @property {string} id
 * @property {string} label
 * @property {string} script   build/ 下的脚本名（相对 buildDir）
 * @property {string[]} [args] 追加在脚本路径后面的参数
 * @property {boolean} [soft]  退出码非 0 也算「已停止」而不是「失败」（比如 serve 被 Ctrl+C）
 */

/** 把 args 数组按选项拼好（追加式参数在这层统一处理） */
export function stepArgv(step, buildDirAbs) {
  return [path.join(buildDirAbs, step.script), ...(step.args || [])];
}

/** 追加参数（不重复添加） */
export function withArgs(step, extra = []) {
  const args = [...(step.args || [])];
  for (const a of extra) if (!args.includes(a)) args.push(a);
  return { ...step, args };
}

function now() { return Date.now(); }

/**
 * inherit 模式：spawnSync + stdio:'inherit'
 * @returns {{code:number, ms:number, error?:string, mode:'inherit'}}
 */
export function runStepInherit(step, { buildDirAbs, cwd, env = process.env }) {
  const t0 = now();
  const r = spawnSync(process.execPath, stepArgv(step, buildDirAbs), {
    stdio: 'inherit',
    cwd,
    env,
  });
  const ms = now() - t0;
  if (r.error) return { code: 1, ms, error: r.error.message, mode: 'inherit' };
  return { code: r.status == null ? 1 : r.status, ms, mode: 'inherit' };
}

/** 行分割器：把流切成完整行（保留不完整的尾巴） */
function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        onLine(line);
      }
      /* 单行超长（比如压缩过的 JS）时别把内存吃光 */
      if (buf.length > 64 * 1024) { onLine(buf); buf = ''; }
    },
    flush() { if (buf) { onLine(buf); buf = ''; } },
  };
}

/**
 * pipe 模式：抓输出按行回调 + tee 到日志文件。
 * spawn 失败（EPERM 等）自动退到 fd 模式重跑一次。
 *
 * @param {Step} step
 * @param {object} o
 * @param {string} o.buildDirAbs
 * @param {string} o.cwd
 * @param {object} [o.env]
 * @param {string} [o.logFile]   日志文件绝对路径（父目录会自动建）
 * @param {(line:string, stream:'out'|'err')=>void} [o.onLine]
 * @param {AbortSignal} [o.signal] 中止信号（第一次 SIGINT 用）
 * @param {(child:import('node:child_process').ChildProcess)=>void} [o.onSpawn] 拿到子进程（用于强杀）
 * @returns {Promise<{code:number, ms:number, mode:'pipe'|'fd', error?:string}>}
 */
export function runStepPiped(step, {
  buildDirAbs, cwd, env = process.env, logFile = null, onLine = null, signal = null, onSpawn = null,
}) {
  const argv = stepArgv(step, buildDirAbs);
  if (logFile) fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const tee = (text) => { if (logFile) { try { fs.appendFileSync(logFile, text + '\n'); } catch { /* 日志写不进去不该让部署失败 */ } } };

  const attempt = (mode) => new Promise((resolve) => {
    const t0 = now();

    if (mode === 'fd') {
      let out = 'ignore';
      let fd = null;
      if (logFile) {
        try { fd = fs.openSync(logFile, 'a'); out = fd; } catch { out = 'ignore'; }
      }
      const child = spawn(process.execPath, argv, { cwd, env, stdio: ['ignore', out, out] });
      if (onSpawn) onSpawn(child);
      const finish = (code, error) => {
        if (fd != null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
        resolve({ code, ms: now() - t0, mode: 'fd', error });
      };
      child.on('error', (e) => finish(1, e.message));
      child.on('close', (code) => finish(code == null ? 1 : code));
      if (signal) signal.addEventListener('abort', () => { try { child.kill('SIGINT'); } catch { /* 忽略 */ } }, { once: true });
      return;
    }

    const child = spawn(process.execPath, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(child);
    const spill = [];
    const make = (stream) => lineSplitter((line) => {
      tee(line);
      if (onLine) onLine(line, stream);
      else if (spill.length < 200) spill.push(line);
    });
    const so = make('out');
    const se = make('err');
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      so.flush(); se.flush();
      resolve({ code, ms: now() - t0, mode: 'pipe', error });
    };

    child.stdout.on('data', (c) => so.push(String(c)));
    child.stderr.on('data', (c) => se.push(String(c)));
    child.on('error', (e) => {
      /* 管道起不来 → 用 fd 模式再试一次（沙箱里会走到这里） */
      if (mode === 'pipe' && /EPERM|ENOTSUP|ENOSYS|EACCES/.test(String(e && e.code))) {
        settled = true;
        attempt('fd').then(resolve);
        return;
      }
      finish(1, e.message);
    });
    child.on('close', (code) => finish(code == null ? 1 : code));
    if (signal) signal.addEventListener('abort', () => { try { child.kill('SIGINT'); } catch { /* 忽略 */ } }, { once: true });
  });

  return attempt('pipe');
}

/** 硬杀进程树（Windows 上 SIGINT 有时不够，第二次 Ctrl+C 用这个） */
export function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* 进程可能已经没了 */ }
}
