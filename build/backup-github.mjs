/**
 * 把**整个项目源码**备份到 GitHub 备份仓库
 * ---------------------------------------------------
 * 和 push-github.mjs 的分工（两者互不干涉）：
 *   · push-github.mjs   —— 推的是 dist/ 里那份**发布出去的网页产物**（GitHub Pages）
 *   · 这一个            —— 推的是项目根的**源码全量**，目标是备份仓库
 *
 * 为什么是独立功能：备份是「怕丢代码」，发布是「把网站弄上线」，
 * 触发时机、失败后果都不一样。所以它不挂进任何部署管线（full 里没有它），
 * 只从 `部署.cmd bakup` / 菜单第 10 项进来，失败了也不影响部署那条线。
 *
 * 遵守项目根的 .gitignore：
 *   node_modules / dist / .env / .npm-cache / .deno-cache / *.log 这些都不会进备份，
 *   另外自带 .git 的子目录（dist/.git、.agents/skills/theme-plus/.git）会**跳过** ——
 *   交给 git 的话它们会变成空壳 gitlink，源码其实没备进去（见 lib/git-backup.mjs）。
 *
 * 跑法：
 *   node build/backup-github.mjs           提交并推送
 *   node build/backup-github.mjs --check   只看会备份什么，不提交也不推
 *   node build/backup-github.mjs -m "..."  自定义提交信息
 *
 * 认证（第一次需要，和 push-github 同一套）：
 *   本机装了 GitHub CLI 且已 `gh auth login` 的话，git 会直接借它的凭据，不用配；
 *   否则用 Personal Access Token（勾 repo 权限）：
 *     git remote set-url origin https://<token>@github.com/JinSuperOfficial/JinSuperKitBakup.git
 *   ⚠ 别把带 token 的地址写进任何会被提交的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKUP_BRANCH, BACKUP_REPO, BIG_FILE_BYTES,
  addAll, aheadCount, commitCount, currentBranch, ensureCommitIdentity, ensureOrigin, ensureRepo,
  git, gitlinks, hasCommits, hasGit, nestedRepos, output, proxyArgs,
  remoteHasBranch, sanitize, stagedFiles,
} from './lib/git-backup.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const argOf = (name) => {
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('-') ? process.argv[i + 1] : null;
};
const CUSTOM_MSG = argOf('--message') || argOf('-m');

if (process.argv.some((a) => a === '--help' || a === '-h' || a === '/?')) {
  console.log(`
  用法：node build/backup-github.mjs [选项]

    把整个项目源码按 .gitignore 的规则推到备份仓库
    ${BACKUP_REPO}
    （和推 dist/ 到 GitHub Pages 的 push-github.mjs 互不影响）

  选项
    --check              只看会备份什么，不提交也不推
    -m, --message "说明" 自定义提交信息
    -h, --help           这条帮助
`);
  process.exit(0);
}

/* GitHub 单文件硬线是 100MB，超了整次推送会被拒 —— 早点说，别等传完 */
const MIN_FREE_FILES = 3;

function log(...a) { console.log(' ', ...a); }
function ok(...a) { console.log('  ✓', ...a); }
function warn(...a) { console.log('  !', ...a); }
function bad(...a) { console.log('  ✗', ...a); }
function die(msg) { console.error('\n' + msg + '\n'); process.exit(1); }

/** 把 git 的错误原文打出来（抹掉可能带 token 的 URL） */
function showGitError(r) {
  const text = sanitize(output(r));
  if (text) for (const line of text.split(/\r?\n/)) console.error('  | ' + line);
}

/** 按扩展名/名字归类，用来给出「备份里有什么」的概览 */
function kindOf(rel) {
  const base = rel.split('/').pop();
  if (base.startsWith('.')) return '配置/隐藏';
  const ext = (path.extname(rel) || '').toLowerCase();
  const MAP = {
    '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.json': 'json',
    '.html': 'html', '.htm': 'html', '.css': 'css',
    '.md': 'md', '.txt': '文本',
    '.png': '图片', '.jpg': '图片', '.jpeg': '图片', '.gif': '图片', '.svg': '图片',
    '.webp': '图片', '.ico': '图片', '.avif': '图片',
    '.woff': '字体', '.woff2': '字体', '.ttf': '字体', '.otf': '字体', '.eot': '字体',
    '.mp3': '音频', '.wav': '音频', '.m4a': '音频',
    '.mp4': '视频', '.webm': '视频',
    '.zip': '压缩包', '.gz': '压缩包',
    '.php': 'php', '.xml': 'xml', '.yml': 'yaml', '.yaml': 'yaml',
  };
  return MAP[ext] || (ext ? ext.slice(1) : '其它');
}

/** 暂存内容的体检报告：文件数、体积、大头、超大文件 */
function inspect(files) {
  let bytes = 0;
  const big = [];
  const byKind = new Map();
  const byTop = new Map();

  for (const f of files) {
    let size = 0;
    try { size = fs.statSync(path.join(process.cwd(), f)).size; } catch { /* 文件刚被删/改名，忽略 */ }
    bytes += size;
    if (size >= BIG_FILE_BYTES) big.push({ f, size });
    const k = kindOf(f);
    byKind.set(k, (byKind.get(k) || 0) + 1);
    const top = f.includes('/') ? f.split('/')[0] : '(根目录文件)';
    byTop.set(top, (byTop.get(top) || 0) + 1);
  }

  const top = [...byTop].sort((a, b) => b[1] - a[1]);
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { count: files.length, bytes, big, top, kinds };
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

/* ══════════════════════════════════════════════════
   0. 前提
   ══════════════════════════════════════════════════ */

if (!hasGit()) {
  console.error('\n找不到 git 命令。装一个 Git for Windows 再试：https://git-scm.com/');
  console.error('（或者直接用 GitHub Desktop / 网页版上传，但那样就没有自动备份了。）\n');
  process.exit(1);
}

console.log('\n[1/6] 检查仓库状态');

/* ── 1. 仓库 ── */
const repo = ensureRepo();
if (repo.created) {
  ok('项目根已初始化 git 仓库（现在不是 git 仓库，刚刚建好）');
  if (repo.note) log(repo.note);
} else {
  const b = currentBranch();
  ok(`项目根已经是 git 仓库${b ? `（分支 ${b}）` : '（还没有提交）'}`);
}

const branch = currentBranch();
if (!branch) {
  /* 仓库存是存在、但 HEAD 指不到具体分支（很少见），按默认分支继续 */
  warn(`读不到当前分支名，按 ${BACKUP_BRANCH} 处理`);
}

/* 自带 .git 的子目录：交给 git 会变成空壳 gitlink，源码等于没备份，所以跳过。
   （磁盘上还在的那些，这一步也会把索引里可能已有的空壳清掉，磁盘文件不动。） */
const nested = nestedRepos();
const nestedLive = nested.filter((n) => !n.empty);
if (nestedLive.length) {
  warn(`${nestedLive.length} 个子目录自带 .git，不进本次备份（记成空壳的话只存一个 commit 号，源码其实没进去）：`);
  for (const n of nestedLive) log('  ' + n.rel);
  log('要连它们的内容一起备，就先删掉里面那个 .git（或在 .gitmodules 里声明成正经的 submodule）。');
}

/* ── 2. 远程 ── */
console.log('\n[2/6] 准备远程仓库');
const origin = ensureOrigin();
if (origin.added) {
  ok(`已添加远程 origin → ${BACKUP_REPO}`);
} else if (origin.mismatch) {
  warn(`远程 origin 现在指向：${origin.url}`);
  warn(`备份仓库本该是：       ${BACKUP_REPO}`);
  if (!CHECK_ONLY) {
    die('远程不是备份仓库，已停下（不会擅自改掉你配好的 remote）。\n'
      + '  想改成备份仓库：git remote set-url origin ' + BACKUP_REPO + '\n'
      + '  想推到现在这个远程：那是另一回事，用 git push 自己来。');
  }
} else {
  ok(`远程 origin → ${origin.url}`);
}

/* ══════════════════════════════════════════════════
   3. 暂存
   ══════════════════════════════════════════════════ */

console.log('\n[3/6] 暂存改动（遵守 .gitignore）');
const add = addAll(nested);
if (add.status !== 0) {
  bad('git add 失败');
  showGitError({ stderr: add.out });
  process.exit(1);
}
for (const rel of add.cleared) {
  if (!nestedLive.some((n) => n.rel === rel)) {
    warn(`索引里残留的「空壳」条目已清掉：${rel}（磁盘上已经没这个目录了）`);
  }
}

const files = stagedFiles();
const stuck = gitlinks();
if (stuck.length) {
  warn(`${stuck.length} 个路径仍被记成空壳（gitlink），备份里只有 commit 号、没有文件内容：`);
  for (const s of stuck.slice(0, 5)) log('  ' + s);
  log('想连内容一起备，就去掉那个目录里的 .git 再跑一次。');
}

if (!files.length) {
  const ahead = hasCommits() && branch ? aheadCount(branch) : null;
  if (ahead === null || ahead > 0) {
    log('没有新的改动要提交。');
    if (!CHECK_ONLY && ahead) {
      log(`不过本地领先远程 ${ahead} 个提交，仍然推一次。`);
    } else if (!CHECK_ONLY && branch === null) {
      /* 空仓库 + 没有可暂存的文件：下面照样会建一个空提交，把分支推上去 */
      log('这是一个还没有提交的空仓库，接下来会建一个初始提交。');
    } else {
      console.log('');
      ok('备份仓库已经是最新的，什么都不用做');
      console.log('');
      process.exit(0);
    }
  }
}

const info = inspect(files);
if (info.count) {
  log(`${info.count} 个文件将要备份（约 ${mb(info.bytes)}）`);
  log('  大头：' + info.top.slice(0, 6).map(([k, n]) => `${k} ${n}`).join('  ·  '));
  log('  类型：' + info.kinds.map(([k, n]) => `${k} ${n}`).join('  ·  '));

  if (info.count <= MIN_FREE_FILES) {
    warn(`只暂存到 ${info.count} 个文件，看着不太对 —— 先核对一下 .gitignore 是不是写太宽了。`);
  }
}

if (info.big.length) {
  console.log('');
  bad(`${info.big.length} 个文件超过 ${mb(BIG_FILE_BYTES)}，GitHub 会拒绝（单文件上限 100MB）：`);
  for (const b of info.big) log(`  ${b.f}  ${mb(b.size)}`);
  die('把这些文件加进 .gitignore 或改用 Git LFS 之后再来。');
}

if (CHECK_ONLY) {
  console.log('');
  log('(--check 模式：只看会备份什么，没有提交、也没有推送)');
  console.log('');
  process.exit(0);
}

/* ══════════════════════════════════════════════════
   4. 提交
   ══════════════════════════════════════════════════ */

console.log('\n[4/6] 提交');
const noCommitNeeded = !files.length;
if (ensureCommitIdentity()) log('设置了仓库级提交身份（不影响全局 git 配置）');

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const msg = CUSTOM_MSG || `备份源码 · ${stamp}`;

if (noCommitNeeded) {
  /* 没有可提交的文件，但仓库里一个提交都没有 —— 建一个空的初始提交，
     否则后面 push 会以「没有 HEAD」失败。 */
  const empty = git(['commit', '--allow-empty', '-m', msg]);
  if (empty.status !== 0) {
    bad('创建初始提交失败');
    showGitError(empty);
    process.exit(1);
  }
  ok(msg + '（空提交）');
} else {
  const commit = git(['commit', '-m', msg]);
  if (commit.status !== 0) {
    const out = output(commit);
    if (/nothing to commit|no changes added/i.test(out)) {
      log('没有可提交的内容，继续推送已有提交。');
    } else {
      bad('提交失败');
      showGitError(commit);
      log('常见原因：用户名/邮箱没配。修一下再跑：');
      log('  git -C . config user.name "你的名字"');
      log('  git -C . config user.email "你的邮箱"');
      process.exit(1);
    }
  } else {
    ok(msg);
  }
}

/* ══════════════════════════════════════════════════
   5. 与远程对齐
   ══════════════════════════════════════════════════ */

console.log('\n[5/6] 与远程对齐');
const head = branch || BACKUP_BRANCH;
const probe = remoteHasBranch(head);
if (!probe.ok) {
  bad('连不上备份仓库（读远程分支失败）');
  console.error('');
  for (const line of probe.error.split(/\r?\n/)) console.error('  | ' + line);
  console.error('');
  log('提交已经做好了，网络通了直接再跑一次「部署.cmd bakup」就会推上去。');
  log('连不上 github.com 通常是代理问题：脚本已默认试 http://127.0.0.1:7890，');
  log('端口不一样就设一下环境变量再跑：');
  log('  $env:https_proxy="http://127.0.0.1:<你的端口>"');
  process.exit(1);
}

if (!probe.has) {
  ok('远程还是空的（第一次备份），直接推');
} else {
  const fetch = git([...proxyArgs(), 'fetch', 'origin', head], { maxBuffer: 64 * 1024 * 1024 });
  if (fetch.status !== 0) {
    bad('拉取远程失败');
    showGitError(fetch);
    process.exit(1);
  }

  const behind = parseInt(String(git(['rev-list', '--count', `HEAD..origin/${head}`]).stdout || '0').trim(), 10) || 0;
  const ahead = parseInt(String(git(['rev-list', '--count', `origin/${head}..HEAD`]).stdout || '0').trim(), 10) || 0;

  if (behind === 0) {
    ok(`与远程同步（本地领先 ${ahead} 个提交）`);
  } else if (!hasCommits() || ahead === 0) {
    /* 本地还没有自己的提交（或者本来就一样）→ 直接把分支对到远程，不会丢东西 */
    log(`远程有 ${behind} 个提交本地没有，本地没有自己的提交 —— 对齐到远程`);
    const reset = git(['reset', '--soft', `origin/${head}`]);
    if (reset.status !== 0) {
      bad('对齐远程失败');
      showGitError(reset);
      process.exit(1);
    }
    const recommit = git(['commit', '-m', msg]);
    if (recommit.status !== 0 && !/nothing to commit|no changes added/i.test(output(recommit))) {
      bad('重新提交失败');
      showGitError(recommit);
      process.exit(1);
    }
    ok('已基于远程内容重新提交');
  } else {
    log(`远程有 ${behind} 个提交本地没有（本地领先 ${ahead} 个）—— 先合并`);
    const merge = git([
      '-c', 'user.name=JinSuper', '-c', 'user.email=noreply@github.com',
      'merge', '--no-edit', `origin/${head}`,
    ]);
    if (merge.status !== 0) {
      console.error('\n自动合并没成功，需要你手动处理：\n');
      showGitError(merge);
      console.error('\n在项目根解决冲突后再跑一次「部署.cmd bakup」。');
      console.error('（合并已经把两边都留在工作区里了，不会有东西丢）\n');
      process.exit(1);
    }
    ok('合并完成');
  }
}

/* ══════════════════════════════════════════════════
   6. 推送
   ══════════════════════════════════════════════════ */

console.log('\n[6/6] 推送');
log(`origin/${head}  ←  ${BACKUP_REPO}`);

/* GIT_TERMINAL_PROMPT=0：认证不行就当场失败，不要挂在那儿等人输密码
   （部署工具经常在管道/无人值守里跑，挂住比报错更难查） */
const push = git([...proxyArgs(), 'push', '-u', 'origin', `HEAD:${head}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});

if (push.status === 0) {
  const n = commitCount();
  console.log('');
  ok(`备份完成（仓库共 ${n} 个提交）`);
  log('仓库地址：' + BACKUP_REPO.replace(/\.git$/, ''));
  log('只看会备份什么：部署.cmd bakup --check');
  console.log('');
  process.exit(0);
}

const err = sanitize(output(push));
console.error('\n推送失败。原样输出：\n');
for (const line of err.split(/\r?\n/)) console.error('  | ' + line);

const lower = err.toLowerCase();
if (/non-fast-forward|fetch first|\[rejected\]|behind/.test(lower)) {
  console.error('\n原因：远程有你这边没有的提交（分叉），被「非快进」拒绝了。');
  console.error('常见于你在 GitHub 网页上动过那个仓库（加 README、改设置等）。');
  console.error('正常情况下上面的「与远程对齐」那步应该已经处理掉；如果还报这个，手动来：');
  console.error('    git fetch origin ' + head);
  console.error('    git merge origin/' + head + '     # 解决冲突后 部署.cmd bakup');
} else if (/authentication|403|401|permission denied|could not read username|terminal prompts disabled|invalid username/.test(lower)) {
  console.error('\n原因：认证没过。两种办法：');
  console.error('  1) 装 GitHub CLI 并登录一次（git 会自动借它的凭据）：gh auth login');
  console.error('  2) 用 Personal Access Token（勾 repo 权限）：');
  console.error('     git remote set-url origin https://<你的TOKEN>@github.com/JinSuperOfficial/JinSuperKitBakup.git');
  console.error('  也可以换成 SSH 地址：git@github.com:JinSuperOfficial/JinSuperKitBakup.git');
  console.error('  ⚠ 别把带 token 的地址写进任何会被提交的文件。');
} else if (/could not resolve|failed to connect|timed out|network|proxy|unable to access/.test(lower)) {
  console.error('\n原因：网络连不上 github.com。');
  console.error('  脚本已默认走 http://127.0.0.1:7890，端口不一样就设一下环境变量：');
  console.error('    $env:https_proxy="http://127.0.0.1:<你的端口>"');
  console.error('  然后重跑「部署.cmd bakup」。');
} else if (/exceeds|too large|large file|gh001|gh002/.test(lower)) {
  console.error('\n原因：仓库里有超过 100MB 的文件，GitHub 拒收。');
  console.error('  加进 .gitignore，或改用 Git LFS。');
} else {
  console.error('\n没识别出具体原因，把上面那段原始输出发我。');
}

console.error('\n提交已经做好了，问题解决后直接再跑一次「部署.cmd bakup」就会推上去。\n');
process.exit(1);
