/**
 * 把 dist/ 推送到 GitHub
 * ---------------------------------------------------
 * 热铁盒用 CLI 上传 dist/，GitHub 用 git 推同一个 dist/，
 * 两个平台的网站内容因此完全一致。
 *
 * 为什么仓库根放在 dist/ 而不是项目根：
 *   GitHub Pages 会把仓库里的文件原样发布。如果推项目根，
 *   那 build/、node_modules/、.Skills/ 之类都会跟着公开。
 *   而 dist/ 恰好就是「该公开的那一份」，和热铁盒上传的完全相同。
 *
 * 跑法：
 *   npm run push          # 提交并推送
 *   npm run push:check    # 只看会提交什么，不推
 *
 * 认证（第一次需要）：
 *   用 Personal Access Token 最省事（勾 repo 权限）：
 *     git remote set-url origin https://<token>@github.com/JinSuperOfficial/JinSuper.github.io.git
 *   或者在本机配好 SSH 后换成 git@github.com:... 的地址。
 *   ⚠ 别把带 token 的地址写进任何会被提交的文件。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildDir } from './paths.mjs';
import {
  BRANCH, REPO, distDir, ensureCommitIdentity, ensureRepo, git, proxyArgs,
} from './lib/git-dist.mjs';

const projectRoot = path.resolve(buildDir, '..');

const CHECK_ONLY = process.argv.includes('--check');

function log(...a) { console.log(' ', ...a); }

if (!fs.existsSync(distDir)) {
  console.error('\n没有 dist/。先跑 npm run deploy:prep 组装产物。\n');
  process.exit(1);
}

/* ── 1. 确保 dist/ 是个 git 仓库 ── */
console.log('\n[1/4] 准备仓库');

const repo = ensureRepo();
if (repo.created) {
  log('已初始化 dist/.git');
  log('已添加远程 origin → ' + REPO);
} else {
  log('dist/.git 已存在');
  log('远程 origin：' + (repo.origin || '(未设置，稍后会自动补)'));
  if (repo.added) log('已补上 origin → ' + REPO);
}

/* 先跟远程对一下。你在 GitHub 网页上动过仓库（比如加过 CNAME、改过设置）
   的话，本地和远程就分叉了，直接 push 会被「非快进」拒绝。
   这里先 fetch + merge，避免那种失败。 */
function syncWithRemote() {
  const hasRemote = git([...proxyArgs(), 'ls-remote', '--heads', 'origin', BRANCH]);
  if (hasRemote.status !== 0 || !/refs\/heads/.test(hasRemote.stdout || '')) {
    log('远程还没有 main 分支（首次推送），跳过同步');
    return;
  }
  git([...proxyArgs(), 'fetch', 'origin', BRANCH]);

  const behind = git(['rev-list', '--count', `HEAD..origin/${BRANCH}`]);
  const ahead = git(['rev-list', '--count', `origin/${BRANCH}..HEAD`]);
  const nBehind = parseInt((behind.stdout || '0').trim(), 10) || 0;
  const nAhead = parseInt((ahead.stdout || '0').trim(), 10) || 0;

  if (nBehind === 0) {
    log(`与远程同步（本地领先 ${nAhead} 个提交）`);
    return;
  }

  log(`远程有 ${nBehind} 个提交本地没有（本地领先 ${nAhead} 个）——先合并`);
  const merge = git([
    '-c', 'user.name=JinSuper', '-c', 'user.email=noreply@github.com',
    'merge', '--no-edit', `origin/${BRANCH}`,
  ]);
  const out = (merge.stdout || '') + (merge.stderr || '');

  if (merge.status !== 0) {
    console.error('\n自动合并没成功，需要你手动处理：\n');
    console.error(out.trim());
    console.error('\n在 dist/ 里手动解决冲突后再跑一次 npm run push。');
    console.error('（如果你在 GitHub 网页上加过 CNAME 之类的文件，保留它就行）\n');
    process.exit(1);
  }
  log('合并完成');
}

syncWithRemote();

/* dist/.gitignore：热铁盒不在乎它，但发布到 GitHub 就别带这些 */
const distIgnore = path.join(distDir, '.gitignore');
if (!fs.existsSync(distIgnore)) {
  fs.writeFileSync(distIgnore, '*.log\n.deploy-changed.txt\n', 'utf8');
}

/* 提交身份：没配过就用一个中性的，避免 commit 直接失败 */
if (ensureCommitIdentity()) log('设置了仓库级提交身份（不影响全局 git 配置）');

/* ── 2. 暂存 ── */
console.log('\n[2/4] 暂存改动');

/* git add 要挨个哈希 dist 里七百多个文件，偶尔会踩到文件系统层的抖动：
   Windows 通过 UNC（\\wsl.localhost\...）访问 WSL 里的项目时，会冒出一句
   `error: open("asset/homework/xxx.jpg"): No such file or directory` ——
   文件其实好好在着，重跑一次就过去了。所以这里重试，别让一次抖动打断整条发布。
   （重试时把输出压住，只有真失败了才把最后一份原样打出来。） */
const ADD_TRIES = 3;
let add = git(['add', '-A']);
for (let n = 2; n <= ADD_TRIES && add.status !== 0; n++) {
  log(`git add 失败了，第 ${n}/${ADD_TRIES} 次重试…`);
  add = git(['add', '-A']);
}
if (add.status !== 0) {
  console.error('git add 失败（试了 ' + ADD_TRIES + ' 次）：' + (add.stderr || add.stdout));
  console.error('  上面如果是 open(...): No such file or directory，多半只是文件系统抖动；');
  console.error('  文件真不在就重跑一次组装：npm run deploy:prep');
  process.exit(1);
}

const staged = git(['diff', '--cached', '--name-only']);
const files = (staged.stdout || '').trim().split('\n').filter(Boolean);

if (!files.length) {
  /* 没有新内容可提交，但本地可能仍领先远程（比如刚刚 merge 出一个提交），
     那就还有东西要推，不能直接退出。 */
  const ahead = git(['rev-list', '--count', `origin/${BRANCH}..HEAD`]);
  const nAhead = parseInt((ahead.stdout || '0').trim(), 10);

  if (!nAhead) {
    log('没有新改动，仓库已是最新。');
    if (CHECK_ONLY) process.exit(0);
    console.log('');
    process.exit(0);
  }

  log(`没有新内容要提交，但本地领先远程 ${nAhead} 个提交 —— 直接推送`);
  if (CHECK_ONLY) {
    console.log('\n(--check 模式，未推送)\n');
    process.exit(0);
  }
} else {
  log(`${files.length} 个文件有变化：`);
  for (const f of files.slice(0, 25)) log('  ' + f);
  if (files.length > 25) log(`  …另外 ${files.length - 25} 个`);

  if (CHECK_ONLY) {
    console.log('\n(--check 模式，未提交也未推送)\n');
    process.exit(0);
  }
}

/* ── 3. 提交 ── */
console.log('\n[3/4] 提交');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const msg = `更新站点内容 · ${stamp}`;
const commit = git(['commit', '-m', msg]);
if (commit.status !== 0) {
  const out = (commit.stdout || '') + (commit.stderr || '');
  if (/nothing to commit/i.test(out)) {
    /* 没有新内容要提交是正常情况（比如刚 merge 完、或内容本来就没变）。
       但**不能在这里退出** —— 本地可能仍领先远程，还需要推送。 */
    log('没有可提交的内容，继续推送已有提交。');
  } else {
    console.error('提交失败：' + out);
    process.exit(1);
  }
} else {
  log(msg);
}

/* ── 4. 推送 ── */
console.log('\n[4/4] 推送到 GitHub');

/* 沙箱或本机可能连不上 github.com，这里给出明确的可操作提示 */
const push = git([...proxyArgs(), 'push', '-u', 'origin', BRANCH], { stdio: ['ignore', 'pipe', 'pipe'] });

if (push.status === 0) {
  log('推送成功');
  log('网站：https://jinsuperofficial.github.io/');
  console.log('');
  process.exit(0);
}

const err = ((push.stderr || '') + (push.stdout || '')).trim();
console.error('\n推送失败。原样输出：\n');
console.error(err);

/* 按真实原因给提示。
   以前这里不管什么原因都写「可能连不上 github.com」，
   结果「远程分叉被拒」也被说成网络问题，白排查半天。 */
const lower = err.toLowerCase();

if (/non-fast-forward|fetch first|behind|rejected/.test(lower)) {
  console.error('\n原因：远程有你这边没有的提交（分叉），被「非快进」拒绝了。');
  console.error('常见于你在 GitHub 网页上改过仓库（加 CNAME、改设置等）。');
  console.error('正常情况下上面的「同步远程」那步应该已经处理掉；如果还报这个，手动来：');
  console.error('    git -C dist fetch origin main');
  console.error('    git -C dist merge origin/main     # 解决冲突后 npm run push');
} else if (/authentication|403|401|permission denied|could not read username|terminal prompts disabled/.test(lower)) {
  console.error('\n原因：认证没过。配一次即可：');
  console.error('    git -C dist remote set-url origin https://<你的TOKEN>@github.com/JinSuperOfficial/JinSuper.github.io.git');
  console.error('  或者换成 SSH 地址：git@github.com:JinSuperOfficial/JinSuper.github.io.git');
  console.error('  ⚠ 别把带 token 的地址写进任何会被提交的文件。');
} else if (/could not resolve|failed to connect|timed out|network|proxy/.test(lower)) {
  console.error('\n原因：网络连不上 github.com。');
  console.error('  这个沙箱直连不通、走代理才行；脚本已默认试 http://127.0.0.1:7890。');
  console.error('  代理端口不是 7890 的话，设一下环境变量再跑：');
  console.error('    $env:https_proxy="http://127.0.0.1:<你的端口>"');
} else {
  console.error('\n没识别出具体原因，把上面那段原始输出发我。');
}

console.error('\n提交已经做好了，问题解决后直接再跑一次 npm run push 就会推上去。\n');
process.exit(1);
