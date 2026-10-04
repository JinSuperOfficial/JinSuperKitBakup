/**
 * 部署作业（控制台里点「一键部署」背后跑的东西）
 * ---------------------------------------------------
 * 控制台自己是零依赖的本地工具，而部署要几十秒、要能中止、
 * 还要在控制台被关掉之后仍然可查，所以作业是**子进程**：
 *
 *   node build/run-pipeline.mjs --steps=full --json …
 *
 * 子进程用 JSON Lines 报进度（见 build/run-pipeline.mjs 的契约），
 * 这里负责：解析事件、写人类可读的日志文件、维护内存态 + jobs.json、
 * 支持按字节偏移增量读日志、支持中止（先 SIGINT，再强杀进程树）。
 *
 * 为什么不用管道之外的通道：管道抓不到就退到「日志文件当子进程 stdout」
 * 的 fd 模式 —— 受限沙箱里 Node 的 stdio 管道会 EPERM，但作业不能因此不可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildDir, stateDir, workspaceRoot } from './paths.mjs';

const LOG_DIR = path.join(stateDir, 'logs');
const JOBS_FILE = path.join(stateDir, 'jobs.json');
const KEEP_JOBS = 30;

/** 允许的管线与开关（前端只能传这些，脚本路径由服务端决定） */
export const PIPELINES = ['full', 'build', 'quickCheck', 'check', 'prep', 'rth', 'gh', 'diff'];
export const FLAGS = {
  noBuild: '--no-build',
  noCheck: '--no-check',
  noGh: '--no-gh',
  noRetry: '--no-retry',
  noVerify: '--no-verify',
};

const PIPELINE_LABEL = {
  full: '一键部署（构建 → 自检 → 组装 → 热铁盒 → GitHub）',
  build: '只构建产物',
  quickCheck: '快速自检',
  check: '完整自检（含 DOM）',
  prep: '只组装 dist/',
  rth: '传热铁盒',
  gh: '推 GitHub Pages',
  diff: '看会提交什么（不推）',
};

/* ── 内存态 ── */
let current = null;          /* 正在跑的作业（单飞） */
let jobs = [];               /* 最近若干条，新的在前 */
try {
  const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
} catch { jobs = []; }

/* 上次控制台退出时还在跑的作业：子进程可能还活着，但我们已经失去它的句柄 */
for (const j of jobs) {
  if (j.state === 'running') {
    j.state = 'unknown';
    j.note = '控制台重启过，这个作业的状态已经跟丢（子进程可能还在跑）';
  }
}

function persist() {
  fs.mkdirSync(stateDir, { recursive: true });
  const body = JSON.stringify({ jobs: jobs.slice(0, KEEP_JOBS) }, null, 2) + '\n';
  const tmp = JOBS_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, JOBS_FILE);
}

function newId() {
  return new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '-' + Math.random().toString(36).slice(2, 6);
}

/** 作业的日志文件（人类可读：步骤标记 + 子进程原样输出） */
export function logFileOf(id) { return path.join(LOG_DIR, id + '.log'); }

function appendLog(file, text) {
  try { fs.appendFileSync(file, text.endsWith('\n') ? text : text + '\n'); } catch { /* 日志写不进去不该让作业失败 */ }
}

/** flags → run-pipeline 的命令行参数；未知键直接拒绝 */
export function pipelineArgv(pipeline, flags = {}) {
  if (!PIPELINES.includes(pipeline)) {
    const e = new Error('不认识的管线：' + pipeline);
    e.status = 400;
    throw e;
  }
  const argv = [path.join(buildDir, 'run-pipeline.mjs'), `--steps=${pipeline}`, '--json'];
  for (const [k, v] of Object.entries(flags || {})) {
    if (!v) continue;
    if (!FLAGS[k]) {
      const e = new Error('不支持的开关：' + k);
      e.status = 400;
      throw e;
    }
    argv.push(FLAGS[k]);
  }
  return argv;
}

export function listJobs() {
  return jobs.slice(0, KEEP_JOBS).map((j) => ({
    id: j.id, label: j.label, pipeline: j.pipeline, state: j.state,
    startedAt: j.startedAt, endedAt: j.endedAt, ms: j.ms, exitCode: j.exitCode,
    ok: j.ok, logBytes: j.logBytes,
  }));
}

export function getJob(id) {
  const j = jobs.find((x) => x.id === id);
  if (!j) { const e = new Error('没有这个作业：' + id); e.status = 404; throw e; }
  return j;
}

export function isBusy() { return !!current; }

export function currentJob() {
  return current ? listJobs().find((j) => j.id === current.id) : null;
}

/**
 * 读日志的增量片段。
 * @param {string} id
 * @param {number} offset 上次读到的字节位置
 */
export function readLog(id, offset = 0) {
  const j = getJob(id);
  const file = logFileOf(id);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { size = 0; }
  const from = Math.max(0, Math.min(Number(offset) || 0, size));
  if (from >= size) return { chunk: '', nextOffset: size, eof: j.state !== 'running' };

  const len = size - from;
  const buf = Buffer.alloc(len);
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, from);
  } catch {
    return { chunk: '', nextOffset: from, eof: false };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
  return { chunk: buf.toString('utf8'), nextOffset: size, eof: j.state !== 'running' };
}

/**
 * 起一个作业。
 * @param {object} o
 * @param {string} o.pipeline   PIPELINES 之一
 * @param {object} [o.flags]    FLAGS 里的开关
 * @param {string} [o.label]    显示名（默认按管线给）
 * @param {object} [deps]       测试注入：{ spawn, argv }
 * @returns {{id:string}}
 */
export function startJob(o = {}, deps = {}) {
  if (current) {
    const e = new Error('已经有一个作业在跑：' + current.label + '（先等它结束或中止它）');
    e.status = 409;
    throw e;
  }
  const argv = deps.argv || pipelineArgv(o.pipeline, o.flags);
  const label = o.label || PIPELINE_LABEL[o.pipeline] || o.pipeline;

  const id = newId();
  const logFile = logFileOf(id);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(logFile, `# ${label}\n# ${new Date().toLocaleString()} · node build/run-pipeline.mjs ${argv.slice(1).join(' ')}\n\n`);

  const job = {
    id,
    label,
    pipeline: o.pipeline,
    flags: o.flags || {},
    state: 'running',
    startedAt: Date.now(),
    endedAt: null,
    ms: 0,
    exitCode: null,
    ok: null,
    steps: [],
    error: null,
    mode: 'pipe',
    pid: null,
    logFile,
    logBytes: 0,
  };
  jobs.unshift(job);
  if (jobs.length > KEEP_JOBS) jobs.length = KEEP_JOBS;
  current = job;
  persist();

  const spawnImpl = deps.spawn || spawn;
  const child = spawnImpl(process.execPath, argv, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.pid = child.pid || null;

  let stdoutBuf = '';
  let stderrBuf = '';

  const handleEvent = (ev) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.ev === 'start') {
      job.steps = (ev.steps || []).map((s) => ({ id: s.id, label: s.label, soft: !!s.soft, state: 'pending', ms: 0 }));
    } else if (ev.ev === 'step') {
      const step = job.steps.find((s) => s.id === ev.id);
      if (step) {
        step.state = ev.state === 'start' ? 'start' : ev.state;
        if (ev.ms) step.ms = ev.ms;
        if (ev.code != null) step.code = ev.code;
        if (ev.error) step.error = ev.error;
      }
      if (ev.state === 'start') appendLog(logFile, `▶ ${(step && step.label) || ev.id}`);
      else if (ev.state === 'ok') appendLog(logFile, `✓ ${(step && step.label) || ev.id} · ${((ev.ms || 0) / 1000).toFixed(1)}s`);
      else if (ev.state === 'fail') appendLog(logFile, `✗ ${(step && step.label) || ev.id} 失败（退出码 ${ev.code}）`);
      else if (ev.state === 'skipped') appendLog(logFile, `－ ${(step && step.label) || ev.id} 已跳过`);
      else if (ev.state === 'stopped') appendLog(logFile, `■ ${(step && step.label) || ev.id} 已停止`);
      persist();
    } else if (ev.ev === 'log') {
      appendLog(logFile, ev.line == null ? '' : String(ev.line));
    } else if (ev.ev === 'done') {
      job.ok = !!ev.ok;
      job.ms = ev.ms || 0;
      job.domains = ev.domains || [];
      job.changed = ev.changed || [];
    } else if (ev.ev === 'error') {
      job.error = ev.message || '未知错误';
    }
  };

  const drain = (which) => {
    const bufRef = which === 'out' ? () => stdoutBuf : () => stderrBuf;
    const setBuf = which === 'out' ? (v) => { stdoutBuf = v; } : (v) => { stderrBuf = v; };
    let text = bufRef();
    let i;
    while ((i = text.indexOf('\n')) >= 0) {
      const line = text.slice(0, i).replace(/\r$/, '');
      text = text.slice(i + 1);
      if (which === 'out') {
        /* stdout 是协议通道：JSON Lines。解析不了的行当普通日志 */
        let parsed = null;
        if (line.trim().startsWith('{')) { try { parsed = JSON.parse(line); } catch { parsed = null; } }
        if (parsed) handleEvent(parsed);
        else if (line.trim()) appendLog(logFile, line);
      } else if (line.trim()) {
        appendLog(logFile, line);
      }
    }
    setBuf(text);
  };

  if (child.stdout) child.stdout.on('data', (c) => { stdoutBuf += String(c); drain('out'); });
  if (child.stderr) child.stderr.on('data', (c) => { stderrBuf += String(c); drain('err'); });

  const finish = (code, err) => {
    if (job.state !== 'running') return;
    drain('out');
    drain('err');
    job.endedAt = Date.now();
    job.ms = job.ms || (job.endedAt - job.startedAt);
    job.exitCode = code == null ? 1 : code;
    if (err) job.error = err;
    job.state = job.ok === null ? (job.exitCode === 0 ? 'done' : 'failed') : (job.ok ? 'done' : 'failed');
    if (job.state === 'done' && job.exitCode !== 0) job.state = 'failed';
    appendLog(logFile, '');
    appendLog(logFile, job.state === 'done' ? '── 全部完成' : `── 结束（退出码 ${job.exitCode}）${job.error ? '：' + job.error : ''}`);
    try { job.logBytes = fs.statSync(logFile).size; } catch { job.logBytes = 0; }
    current = null;
    persist();
  };

  child.on('error', (e) => {
    job.error = '起不来子进程：' + e.message;
    job.mode = 'failed-spawn';
    finish(1, job.error);
  });
  child.on('close', (code) => finish(code));

  return { id };
}

/** 中止：先 SIGINT（让管线把当前步骤收尾），800ms 还没退就强杀进程树 */
export function stopJob(id) {
  const job = getJob(id);
  if (job.state !== 'running') return { ok: true, state: job.state, note: '它已经不在跑了' };
  if (!current || current.id !== id) return { ok: false, state: job.state, note: '这个作业不是当前进程在跑（可能控制台重启过）' };

  const pid = job.pid;
  try { if (pid) process.kill(pid, 'SIGINT'); } catch { /* 可能已经没了 */ }
  setTimeout(() => {
    if (job.state !== 'running' || !pid) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch { /* 忽略 */ }
  }, 800).unref?.();

  return { ok: true, state: 'stopping' };
}

/** 测试用：把内存态清空（每个测试用例之间） */
export function _resetForTest() {
  current = null;
  jobs = [];
  persist();
}

/** 测试用：等一个作业结束 */
export function _waitFor(id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const j = jobs.find((x) => x.id === id);
      if (!j) { clearInterval(timer); reject(new Error('作业没了')); return; }
      if (j.state !== 'running') { clearInterval(timer); resolve(j); return; }
      if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('等作业超时')); }
    }, 50);
  });
}
