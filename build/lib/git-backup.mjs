/**
 * 项目根的「源码备份」仓库（把整个项目推到备份仓库）
 * ---------------------------------------------------
 * 和 build/lib/git-dist.mjs 是**两回事**，刻意不复用：
 *   · git-dist.mjs   —— dist/ 那个独立仓库，推的是**发布出去**的站点产物
 *   · 这一个         —— 项目根 `.git`，推的是**源码全量**（排除 node_modules/dist 等）
 *
 * 为什么不把两者合成一个：目标仓库、工作目录、排除规则、分支含义全都不一样，
 * 混在一起后「推备份」哪天手滑就会动到线上发布仓库。两边各写各的，改一个坏不了另一个。
 *
 * ⚠ git add -A 会把「带 .git 的子目录」记成 gitlink（160000）——
 *   那等于只存一个 commit 号，源码根本没进备份。而本机确实有这种目录
 *   （dist/.git、.agents/skills/theme-plus/.git），所以这里必须显式跳过，
 *   见 nestedRepos() / addAll()。
 *
 * 这里只做「仓库与 git 调用」这一层，不做业务判断，也不打印进度。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildDir } from '../paths.mjs';

/** 项目根（源码仓库就在这儿，不是 dist/） */
export const projectRoot = path.resolve(buildDir, '..');

/** 备份目标仓库 */
export const BACKUP_REPO = 'https://github.com/JinSuperOfficial/JinSuperKitBakup.git';

/** 备份用的分支名（仓库里已经有提交时以现有分支为准） */
export const BACKUP_BRANCH = 'main';

/**
 * github.com 直连不通、走代理可通（实测），git 不认 http_proxy 环境变量，
 * 得用 -c 显式传。优先用环境里已有的代理地址，没有就退回本机常见的 7890。
 * （与 git-dist.mjs 的那份同理，但各留一份：备份通道不该被发布通道的改动牵连。）
 */
export function proxyArgs() {
  const fromEnv = process.env.https_proxy || process.env.HTTPS_PROXY
               || process.env.http_proxy || process.env.HTTP_PROXY;
  const proxy = fromEnv || 'http://127.0.0.1:7890';
  return ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`];
}

/** 在项目根跑一条 git 命令（utf8 抓输出）。要原样透到终端就传 stdio:'inherit'。 */
export function git(args, opts = {}) {
  return spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    ...opts,
  });
}

/** stdout 末行（git 的很多命令只回一句话） */
export function lastLine(r) {
  const s = String((r && r.stdout) || '').trim();
  return s ? s.split(/\r?\n/).pop().trim() : '';
}

/** 一条命令的完整输出（stdout + stderr），用于错误提示 */
export function output(r) {
  return (String((r && r.stderr) || '') + String((r && r.stdout) || '')).trim();
}

/** 本机有没有 git 可执行文件 */
export function hasGit() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return !r.error;
}

/** 项目根是不是一个 git 仓库 */
export function hasRepo() {
  const r = git(['rev-parse', '--git-dir']);
  return r.status === 0;
}

/** 当前分支名；仓库还没有任何提交时返回 null（那时 HEAD 是「未出生」的） */
export function currentBranch() {
  const r = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return r.status === 0 ? String(r.stdout).trim() || null : null;
}

/** 仓库里有没有提交（没有的话第一次要 --set-upstream） */
export function hasCommits() {
  return git(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
}

/**
 * 确保项目根是个 git 仓库。
 * 已经有人建过（`git init` 过了）就原样用，绝不重置、绝不改分支。
 * @returns {{created:boolean, branch:string|null, note:string|null}}
 */
export function ensureRepo() {
  if (hasRepo()) return { created: false, branch: currentBranch(), note: null };

  /* -b 是 git 2.28+ 的写法；老版本不认，就退回 init + 改名 */
  let r = git(['init', '-b', BACKUP_BRANCH]);
  let note = null;
  if (r.status !== 0) {
    r = git(['init']);
    if (r.status !== 0) {
      const err = new Error('git init 失败：' + output(r));
      err.status = 500;
      throw err;
    }
    const rename = git(['branch', '-M', BACKUP_BRANCH]);
    note = rename.status === 0
      ? '本机 git 比较老（不认 init -b），已用 init + branch -M 建出 ' + BACKUP_BRANCH
      : '本机 git 比较老，分支名可能是 master（不影响备份，只是地址栏不一样）';
  }
  return { created: true, branch: BACKUP_BRANCH, note };
}

/** 远程 origin 的地址；没配过返回 null */
export function originUrl() {
  const r = git(['remote', 'get-url', 'origin']);
  return r.status === 0 ? String(r.stdout).trim() || null : null;
}

/**
 * 确保远程 origin 指向备份仓库。**不会**覆盖已有的 origin ——
 * 项目根哪天真的接了别的远程，这里只提醒，绝不擅自改（推送目标必须由人确认）。
 * @returns {{origin:string, url:string, added:boolean, mismatch:boolean}}
 */
export function ensureOrigin(url = BACKUP_REPO) {
  const cur = originUrl();
  if (!cur) {
    const r = git(['remote', 'add', 'origin', url]);
    if (r.status !== 0) {
      const err = new Error('git remote add 失败：' + output(r));
      err.status = 500;
      throw err;
    }
    return { origin: 'origin', url, added: true, mismatch: false };
  }
  return { origin: 'origin', url: cur, added: false, mismatch: cur !== url };
}

/** 备份要排除的目录名（.gitignore 已经管住的另算，这里只管「git 认不出」的） */
export const BACKUP_SKIP_DIRS = new Set([
  'node_modules', 'dist', '.deploy-logs', '.git',
]);

/**
 * 找出某个目录下**自带 .git 的子目录**。
 * 这些目录如果交给 git add -A，会被记成 gitlink —— 备份里只剩一个 commit 号，
 * 源码其实没进去。所以要么由调用方跳过，要么在 .gitmodules 里正经声明。
 * 另外会顺带把「索引里已经有、磁盘上却没了的」gitlink 报出来（那种残留会让 add -A 失败）。
 *
 * @param {string} rootAbs 从哪个目录开始找
 * @param {number} depth 往下检查到第几层（默认 3：
 *        dist/.git 在第 1 层，.agents/skills/theme-plus/.git 在第 3 层）
 * @returns {Array<{rel:string, empty:boolean}>} rel 相对 rootAbs
 */
export function nestedReposIn(rootAbs, depth = 3) {
  const found = new Map();

  /* level 是「当前正在看的这一层」：1 = 根的直接子目录。
     所以「是不是仓库」要在进到这一层时判，而不是递归之前判 ——
     否则 a/b/repo（嵌套两层）会差一层漏掉。depth 是**往下看几层**。 */
  const walk = (dirAbs, rel, level) => {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;                                   /* 权限之类的问题，跳过就好 */
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const childRel = rel ? rel + '/' + e.name : e.name;
      /* 注意：.git 不能按 BACKUP_SKIP_DIRS 跳过 —— 这一层的任务恰恰就是找到它 */
      if (e.name !== '.git' && BACKUP_SKIP_DIRS.has(e.name)) continue;
      const childAbs = path.join(dirAbs, e.name);
      /* .git 在 Windows 上可能是文件（worktree / submodule 的写法） */
      if (fs.existsSync(path.join(childAbs, '.git'))) { found.set(childRel, false); continue; }
      if (level < depth) walk(childAbs, childRel, level + 1);
    }
  };

  /* 以索引为准：磁盘上的自带 .git 目录 + 索引里残留的 gitlink，一次都捞出来。
     索引读不出来（不是仓库 / 没装 git）就只扫盘 —— 少一条规则总比整个功能挂掉好。 */
  const listed = git(['ls-files', '-s']);
  if (listed.status === 0) {
    for (const line of String(listed.stdout || '').split(/\r?\n/)) {
      const m = /^160000\s+[0-9a-f]+\s+\d+\t(.+)$/.exec(line);
      if (!m) continue;
      found.set(m[1], !fs.existsSync(path.join(rootAbs, m[1], '.git')));
    }
  }
  walk(rootAbs, '', 1);

  return [...found].map(([rel, empty]) => ({ rel, empty }));
}

/** 项目根那一份（调用方最常用的用法） */
export function nestedRepos(depth = 3) {
  return nestedReposIn(projectRoot, depth);
}

/**
 * 暂存全部改动（等价于 git add -A），但**不**把自带 .git 的子目录记成空壳：
 *   · 磁盘上还在的 → 用 pathspec 排除，git 就不会生成 gitlink
 *   · 索引里已有的 gitlink → 从索引里删掉（--cached，磁盘文件一个不动）。
 *     这里必须带 -f：gitlink 的索引项和 HEAD/工作区都对不上时，
 *     不带 -f 的 `git rm --cached` 会直接报错（「staged content different」）。
 * @param {Array<{rel:string, empty:boolean}>} nested
 * @returns {{status:number, out:string, skipped:string[], cleared:string[]}}
 */
export function addAll(nested = []) {
  const skipped = [];
  const cleared = [];
  const exclude = [];

  for (const n of nested) {
    if (n.empty) {
      /* 磁盘上已经没这个目录了，pathspec 也就无从谈起：清索引 */
      git(['rm', '-r', '-f', '--cached', '--quiet', '--ignore-unmatch', '--', n.rel]);
      cleared.push(n.rel);
    } else {
      /* 先清掉可能已经存在的 gitlink，再加排除（双保险：老 git 不认 :(exclude) 时靠这一步） */
      const rm = git(['rm', '-r', '-f', '--cached', '--quiet', '--ignore-unmatch', '--', n.rel]);
      if (rm.status === 0) cleared.push(n.rel);
      exclude.push(n.rel);
      skipped.push(n.rel);
    }
  }

  /* `:(exclude)` 是 pathspec 的魔法前缀，非常老的 git 不认；
     不认的话这一步会失败，上面的 rm 已经把空壳清掉了，不算白干 */
  const args = ['add', '-A'];
  if (exclude.length) args.push('--', '.', ...exclude.map((p) => ':(exclude)' + p));

  const r = git(args, { maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: output(r), skipped, cleared };
}

/** 已暂存的改动清单（空数组 = 没什么要提交的） */
export function stagedFiles() {
  const r = git(['diff', '--cached', '--name-only']);
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** 索引里被记成 gitlink（160000）的路径 —— 备份里就是「空壳」 */
export function gitlinks() {
  const r = git(['ls-files', '-s']);
  if (r.status !== 0) return [];
  const out = [];
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const m = /^160000\s+[0-9a-f]+\s+\d+\t(.+)$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 本地领先远程几个提交（远程还没有这个分支时按「全部」算） */
export function aheadCount(branch = BACKUP_BRANCH, remote = 'origin') {
  const r = git(['rev-list', '--count', `${remote}/${branch}..HEAD`]);
  if (r.status !== 0) return null;              /* 远程分支还不存在 */
  return parseInt(String(r.stdout).trim(), 10) || 0;
}

/** 远程有没有这个分支（要联网，返回值看 status） */
export function remoteHasBranch(branch = BACKUP_BRANCH, remote = 'origin') {
  const r = git([...proxyArgs(), 'ls-remote', '--heads', remote, branch]);
  return { ok: r.status === 0, has: r.status === 0 && /refs\/heads/.test(r.stdout || ''), error: output(r) };
}

/** 最近的提交标题（没有提交时返回 null） */
export function lastCommit() {
  const r = git(['log', '-1', '--format=%s']);
  return r.status === 0 ? String(r.stdout).trim() || null : null;
}

/** 仓库里一共几个提交 */
export function commitCount() {
  const r = git(['rev-list', '--count', 'HEAD']);
  return r.status === 0 ? parseInt(String(r.stdout).trim(), 10) || 0 : 0;
}

/** 提交身份：没配过就用一个中性的，避免 commit 直接失败（只写仓库级，不动全局） */
export function ensureCommitIdentity(label = 'JinSuper') {
  const name = git(['config', 'user.name']);
  if (name.status !== 0 || !name.stdout.trim()) {
    git(['config', 'user.name', label]);
    git(['config', 'user.email', 'noreply@github.com']);
    return true;
  }
  return false;
}

/**
 * 把错误文本里带 token 的远程地址抹掉再打印。
 * 认证失败时 git 会把它收到的完整 URL 回显出来，而那个 URL 里通常就带着 PAT。
 */
export function sanitize(text) {
  return String(text || '').replace(/https:\/\/[^\s/@]*@github\.com/gi, 'https://***@github.com');
}

/* ═══════════════════════════════════════════════════
   标签（tag）
   ---------------------------------------------------
   备份仓库里「哪个 commit 对应哪一版」靠 tag 认。
   注意 git push 默认**不推** tag，得显式 --tags（见 backup-github.mjs 第 6 步）。
   ═══════════════════════════════════════════════════ */

/** 本地已有的 tag（新的在前，git 自己按版本号排序） */
export function listTags() {
  const r = git(['tag', '-l', '--sort=-creatordate']);
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * tag 名合不合法。
 * 交给 git 自己判：`git check-ref-format` 是权威，别自己写正则慢慢长歪。
 * @returns {{ok:boolean, error:string|null}}
 */
export function checkTagName(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: 'tag 名不能为空' };
  const r = git(['check-ref-format', `refs/tags/${n}`]);
  if (r.status === 0) return { ok: true, error: null };
  return { ok: false, error: `不是合法的 tag 名：${output(r) || n}` };
}

export function tagExists(name) {
  return git(['rev-parse', '--verify', '--quiet', `refs/tags/${name}`]).status === 0;
}

/**
 * 给当前提交打一个**附注** tag（带说明、作者、日期 —— 轻量 tag 在 GitHub 上信息太少）。
 * @param {string} name
 * @param {string} message 说明（空的话 git 会自己写一句）
 * @returns {{ok:boolean, out:string}}
 */
export function createTag(name, message) {
  const args = ['tag', '-a', name, '-m', message || `备份 ${name}`];
  const r = git(args);
  return { ok: r.status === 0, out: output(r) };
}

/** 当前 HEAD 的短 sha（用来写 tag 说明 / 事后找回那一版） */
export function headShort() {
  const r = git(['rev-parse', '--short', 'HEAD']);
  return r.status === 0 ? String(r.stdout).trim() : '';
}

/** 某个 tag 指向哪个 commit（短 sha） */
export function tagTarget(name) {
  const r = git(['rev-parse', '--short', `${name}^{commit}`]);
  return r.status === 0 ? String(r.stdout).trim() : '';
}

/** 本地一共几个 tag */
export function tagCount() {
  return listTags().length;
}

/** 推到远程的 tag 数 / 失败信息（--tags 会把所有本地 tag 都推一遍） */
export function pushTags(remote = 'origin') {
  const r = git([...proxyArgs(), 'push', '--tags', remote], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: r.status === 0, out: output(r) };
}

/** 体积偏大、GitHub 会拒收的文件（100MB 是硬线，留点余量早点提醒） */
export const BIG_FILE_BYTES = 95 * 1024 * 1024;
