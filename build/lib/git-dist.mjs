/**
 * dist/ 那个独立 git 仓库（GitHub Pages 的发布仓库）
 * ---------------------------------------------------
 * 从 push-github.mjs 抽出来，给三处共用：
 *   · push-github.mjs      —— 提交并推送
 *   · 控制台「与云端合并」  —— 把 origin/main 的内容当成「GitHub 上的线上版本」
 *   · 部署前预检           —— 读远程文件清单/内容做比对
 *
 * 这里只做「仓库与 git 调用」这一层，不做业务判断，也不打印进度。
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildDir } from '../paths.mjs';

export const projectRoot = path.resolve(buildDir, '..');
export const distDir = path.join(projectRoot, 'dist');
export const REPO = 'https://github.com/JinSuperOfficial/JinSuper.github.io.git';
export const BRANCH = 'main';

/**
 * github.com 直连不通、走代理可通（实测）。
 * git 自己不认 http_proxy/https_proxy 环境变量，得用 -c 显式传。
 * 优先用环境里已有的代理地址，没有就退回本机常见的 7890。
 */
export function proxyArgs() {
  const fromEnv = process.env.https_proxy || process.env.HTTPS_PROXY
               || process.env.http_proxy || process.env.HTTP_PROXY;
  const proxy = fromEnv || 'http://127.0.0.1:7890';
  return ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`];
}

/** git 调用（默认在 dist/ 里跑、utf8 抓输出） */
export function git(args, opts = {}) {
  return spawnSync('git', args, {
    cwd: distDir,
    encoding: 'utf8',
    ...opts,
  });
}

export function hasRepo() {
  return fs.existsSync(path.join(distDir, '.git'));
}

/**
 * 确保 dist/ 是个指向发布仓库的 git 仓库。
 * @returns {{created:boolean, origin:string|null, added:boolean}}
 */
export function ensureRepo() {
  fs.mkdirSync(distDir, { recursive: true });
  let created = false;

  if (!hasRepo()) {
    const r = git(['init', '-b', BRANCH]);
    if (r.status !== 0) {
      const err = new Error('git init 失败：' + (r.stderr || r.stdout));
      err.status = 500;
      throw err;
    }
    created = true;
  }

  const url = git(['remote', 'get-url', 'origin']);
  let origin = url.status === 0 ? url.stdout.trim() : null;
  let added = false;
  if (!origin) {
    git(['remote', 'add', 'origin', REPO]);
    origin = REPO;
    added = true;
  }
  return { created, origin, added };
}

/** 提交身份：没配过就用一个中性的，避免 commit 直接失败 */
export function ensureCommitIdentity(label = 'JinSuper') {
  const name = git(['config', 'user.name']);
  if (name.status !== 0 || !name.stdout.trim()) {
    git(['config', 'user.name', label]);
    git(['config', 'user.email', 'noreply@github.com']);
    return true;
  }
  return false;
}

export function branchInfo() {
  return {
    branch: (git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim() || null,
    dirty: (git(['status', '--porcelain']).stdout || '').split(/\r?\n/).filter(Boolean).length,
    last: (git(['log', '-1', '--format=%s']).stdout || '').trim() || null,
  };
}

/* ═══════════════════════════════════════════════════
   远程内容读取（控制台的云端比对用）
   ═══════════════════════════════════════════════════ */

/** 远程有没有 main 分支 */
export function remoteHasBranch() {
  const r = git([...proxyArgs(), 'ls-remote', '--heads', 'origin', BRANCH]);
  return r.status === 0 && /refs\/heads/.test(r.stdout || '');
}

/**
 * fetch 远程（只取 main），返回 {ok, error}
 * 需要代理，可能慢 —— 调用方自己控制超时/提示。
 */
export function fetchRemote() {
  if (!remoteHasBranch()) return { ok: false, error: '远程还没有 main 分支' };
  const r = git([...proxyArgs(), 'fetch', 'origin', BRANCH]);
  if (r.status !== 0) {
    return { ok: false, error: ((r.stderr || '') + (r.stdout || '')).trim() || 'git fetch 失败' };
  }
  return { ok: true };
}

/**
 * 远程文件清单：路径 → 内容哈希（git blob SHA-1）
 * ---------------------------------------------------
 * `git ls-tree -r origin/main` 一条命令拿全，700 个文件也不慢；
 * 本地用同样的算法（blob 头 + sha1）自己算，就能免掉一堆 git 子进程。
 * @returns {Map<string, {hash:string, size:number}>}
 */
export function remoteTree(ref = `origin/${BRANCH}`) {
  const r = git(['ls-tree', '-r', '-l', ref]);
  if (r.status !== 0) {
    const err = new Error(((r.stderr || '') + (r.stdout || '')).trim() || '读不到远程清单');
    err.status = 502;
    throw err;
  }
  const out = new Map();
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    /* 100644 blob a1b2c3…  1234\tpath/to/file */
    const m = /^\d+\s+blob\s+([0-9a-f]{7,64})\s+(\d+)\t(.*)$/.exec(line);
    if (!m) continue;
    out.set(m[3], { hash: m[1], size: Number(m[2]) });
  }
  return out;
}

/** 读远程某个文件的内容（二进制安全：走 buffer） */
export function remoteFile(relPath, ref = `origin/${BRANCH}`) {
  const r = git(['show', `${ref}:${relPath}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = new Error('远程没有这个文件：' + relPath);
    err.status = 404;
    throw err;
  }
  return r.stdout;
}

/**
 * 历史上被删除过的路径（曾经部署过、后来从 dist 里没了）。
 * 控制台用它当「云端可能还留着」的候选去做探测。
 */
export function everDeletedPaths(limit = 400) {
  const r = git(['log', '--diff-filter=D', '--name-only', '--pretty=format:', `-${limit}`]);
  if (r.status !== 0) return [];
  return [...new Set(String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
}

/** git blob 的 SHA-1（与 ls-tree 里的哈希同一种算法），用来和远程比对 */
export function blobHash(buf) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buf.length}\0`, 'utf8')
    .update(buf)
    .digest('hex');
}
