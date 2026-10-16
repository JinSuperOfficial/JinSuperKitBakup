/**
 * 跨网同步（家里那一侧）
 * ---------------------------------------------------
 * 「网站发布」和「跨网同步」是两件事，所以实现也不混在一起：
 *   发布  = `部署.cmd full`  → 热铁盒（Deno CLI）+ GitHub Pages
 *   同步  = `部署.cmd sync …` → Gitee 镜像（学校取件口）+ 收件箱
 *
 * 四个方向：
 *   家里 → 学校：`sync push`   把 dist/ 推到 Gitee 镜像分支，并写一份
 *                              `_sync.json`（每个文件的 sha256），学校那边
 *                              只下变化的文件。
 *   学校 → 家里：`sync pull`   把收件箱（tar.gz + 清单）拉到 sync/inbox/；
 *                `sync apply`  按 roots 映射落进仓库（默认先 dry-run）。
 *   一条龙：     `sync home`   pull → apply（确认）→ `部署.cmd full`
 *   探路：       `sync check` / `sync status` —— 学校第一次用之前先跑这个
 *
 * 只管一件事实：令牌从 `.env`（`JINS_GITEE_TOKEN`）来，不写进任何仓库文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, describeConfig, PROJECT_ROOT, MANIFEST_NAME, INBOX_DIR, INBOX_ROOTS } from '../sync/lib/config.mjs';
import { createTransport } from '../sync/lib/transport.mjs';
import { buildManifest, writeManifestFile, scanDir, diffManifests, describeDiff } from '../sync/lib/manifest.mjs';
import { pushInbox, listInbox, pullInbox, applyInbox, collectDir, defaultStamp } from '../sync/lib/inbox.mjs';
import { collectState, cloudManifest, localSiteManifest, versionOf } from '../sync/lib/state.mjs';
import {
  git, ensureRepo, ensureCommitIdentity, ensureRemote, remoteHeads, pushTo, fetchFrom, authedUrl, GITEE_REMOTE,
  directArgs, proxyArgsFor,
} from './lib/git-dist.mjs';

const projectRoot = PROJECT_ROOT;
const distDir = path.join(projectRoot, 'dist');
const inboxDir = path.join(projectRoot, 'sync', 'inbox');
const buildDir = path.join(projectRoot, 'build');

/* ── 输出：和部署脚本一个风格（✓ ! ✗ 前缀） ── */
const log = (...a) => console.log(' ', ...a);
const ok = (...a) => console.log('  ✓', ...a);
const warn = (...a) => console.log('  !', ...a);
const bad = (...a) => console.log('  ✗', ...a);
const note = (...a) => console.log('  ·', ...a);

const USAGE = `
  用法：部署.cmd sync <子命令> [选项]

  子命令
    check                探通道：连得上吗、云端是什么版本、本地要传多少
    status               本地 / 云端版本、收件箱里有几份、仓库有多少改动
    push                 组装 dist/ + 写 _sync.json + 推 GitHub Pages 与 Gitee 镜像
    pull                 拉收件箱（学校传上来的）到 sync/inbox/
    apply                把已拉下来的收件箱落进仓库（默认只预览）
    upload <路径…>       把文件/目录传进收件箱（桌面版与控制台共用）
    home                 到家一条龙：pull → apply（确认）→ 部署.cmd full
    init                 第一次用：检查权限、把镜像和收件箱分支建好

  选项
    --dry-run            只算不写（push / apply 都支持）
    --write              apply 时真的写（默认只预览）
    --no-github          push 时不推 GitHub Pages，只推 Gitee 镜像
    --no-prep            push 时跳过重新组装 dist/
    --stamp <时间戳>     指定收件箱里哪一份（默认最新）
    --only <关键字>      apply 时只处理路径里含这个关键字的文件
    --root <名字>        upload 时放哪个 root（${INBOX_ROOTS.join(' | ')}，默认 misc）
    --to <路径>          走本地目录 / U 盘通道（provider=gitee 也能用）
    --json               以 JSON 输出（给控制台用）
    -y, --yes            不再确认
`;

/* ═══════════════════════════════════════════════════
   参数
   ═══════════════════════════════════════════════════ */

export function parseArgs(argv) {
  const flags = { _: [] };
  const takesValue = new Set(['--stamp', '--only', '--root', '--to', '--message']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (takesValue.has(a)) { flags[a.slice(2)] = argv[++i] || ''; continue; }
      flags[a.slice(2)] = true;
      continue;
    }
    if (a === '-y') { flags.yes = true; continue; }
    flags._.push(a);
  }
  return flags;
}

function context(flags) {
  const { config, problems, sources } = loadConfig({ root: projectRoot });
  if (flags.to) {
    config.provider = 'local';
    config.local.dir = flags.to;
  }
  if (problems.length && !flags.to) {
    bad(problems.join('\n     '));
    note('先在 sync.json 里填 gitee.owner / gitee.repo，把令牌写进 .env（JINS_GITEE_TOKEN=…）。');
    note('细节见 sync/README.md。');
    return { error: '配置不全' };
  }
  const transport = createTransport(config, { log });
  return { config, transport, sources };
}

/* ═══════════════════════════════════════════════════
   子命令
   ═══════════════════════════════════════════════════ */

/** check：通道通不通、云端什么版本、本地要传多少 */
export async function cmdCheck({ json = false, to = '' } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  const version = versionOf(projectRoot);
  const local = localSiteManifest(distDir, { version });

  let cloud = null;
  let reachable = true;
  let error = '';
  try {
    cloud = await cloudManifest(transport, transport.branch || config.gitee.branch);
  } catch (e) {
    reachable = false;
    error = e.message;
  }
  const diff = cloud ? diffManifests(local.files, cloud.files) : null;

  if (json) {
    console.log(JSON.stringify({ ok: reachable, channel: describeConfig(config), version, local: local.count, cloud, diff, error }, null, 2));
    return reachable ? 0 : 1;
  }

  log('');
  log('通道：' + describeConfig(config));
  log('');
  if (!reachable) {
    bad('连不上通道：' + error);
    note('学校能上的站有限 —— 先确认 gitee.com 能打开；实在不行用 `--to <U 盘目录>` 走本地通道。');
    return 1;
  }
  ok('通道可用');
  if (cloud) {
    ok(`云端镜像：${cloud.count} 个文件 · ${cloud.version || '未标注版本'} · ${cloud.builtAt || ''}`);
    log('  ' + describeDiff(diff, cloud));
  } else {
    warn('云端还没有镜像清单（_sync.json）—— 第一次跑 `部署.cmd sync push` 就有了');
  }
  log('');
  log(`  本地 dist/：${local.count} 个文件（版本 ${version}）`);
  log('');
  return 0;
}

/** status：一眼看全 */
export async function cmdStatus({ json = false, to = '' } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  const state = await collectState({
    transport,
    branch: transport.branch || config.gitee.branch,
    distDir,
    projectRoot,
    inboxDir,
    version: versionOf(projectRoot),
  });
  if (json) {
    console.log(JSON.stringify({ channel: describeConfig(config), ...state }, null, 2));
    return state.ok ? 0 : 1;
  }
  log('');
  log('通道：' + describeConfig(config));
  log('');
  if (!state.ok) {
    bad('通道有问题：' + state.error);
  } else if (state.cloud) {
    ok(`云端镜像：${state.cloud.count} 个文件 · ${state.cloud.version || '未标注版本'}`);
    log('  ' + describeDiff(state.diff, state.cloud));
  } else {
    warn('云端还没有镜像（先跑一次 sync push）');
  }
  ok(`本地 dist/：${state.local.count} 个文件`);
  const remote = state.inbox.remote || [];
  ok(`收件箱：云端 ${remote.filter((x) => x.complete).length} 份完整 · 本地已拉 ${state.inbox.local.length} 份`);
  if (state.inbox.pending.length) warn(`还没拉的：${state.inbox.pending.join('、')}（跑 sync pull）`);
  ok(`仓库：${state.git.dirty ? state.git.dirty + ' 个文件没提交' : '干净'} · 最后一次提交「${state.git.last}」`);
  log('');
  return state.ok ? 0 : 1;
}

/** push：组装 → 写清单 → 推 GitHub Pages + Gitee 镜像 */
export async function cmdPush({ dryRun = false, noGithub = false, noPrep = false, to = '', message = '' } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  const version = versionOf(projectRoot);

  if (!noPrep) {
    log('\n[1/4] 组装 dist/');
    const prep = spawnSync(process.execPath, [path.join(buildDir, 'prep-deploy.mjs')], { stdio: 'inherit', cwd: projectRoot });
    if (prep.status !== 0) { bad('组装失败，已中止'); return 1; }
  } else {
    log('\n[1/4] 跳过组装（--no-prep）');
  }

  log('\n[2/4] 写镜像清单 ' + MANIFEST_NAME);
  const manifest = buildManifest(distDir, { version });
  log(`   ${manifest.count} 个文件 · ${(manifest.bytes / 1048576).toFixed(1)}MB`);
  if (dryRun) {
    note('--dry-run：不写文件、不推送');
    return 0;
  }
  writeManifestFile(path.join(distDir, MANIFEST_NAME), manifest);
  ok('清单已写入 dist/' + MANIFEST_NAME);

  /* ── 本地目录 / U 盘通道：直接镜像过去 ── */
  if (config.provider === 'local') {
    log('\n[3/4] 镜像到本地目录');
    const target = config.local.dir;
    fs.mkdirSync(target, { recursive: true });
    let copied = 0;
    let removed = 0;
    const want = new Set(Object.keys(manifest.files));
    for (const rel of want) {
      const src = path.join(distDir, rel.split('/').join(path.sep));
      const dst = path.join(target, rel.split('/').join(path.sep));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    }
    /* 清单自己不在 manifest.files 里（它是账本不是内容），但取件方要靠它做增量，
       所以单独拷一份过去 —— prune 那边也特意跳过了它 */
    fs.copyFileSync(path.join(distDir, MANIFEST_NAME), path.join(target, MANIFEST_NAME));
    for (const rel of Object.keys(scanDir(target).files)) {
      if (want.has(rel) || rel === MANIFEST_NAME) continue;
      fs.unlinkSync(path.join(target, rel.split('/').join(path.sep)));
      removed++;
    }
    ok(`镜像完成：复制 ${copied} 个 · 清理 ${removed} 个 → ${target}`);
    log('\n[4/4] 完成（本地通道没有网络推送这一步）\n');
    return 0;
  }

  /* ── Gitee 镜像分支 ── */
  log('\n[3/4] 推送');
  const repoUrl = `https://gitee.com/${config.gitee.owner}/${config.gitee.repo}.git`;
  ensureRepo();
  ensureCommitIdentity('JinSuper 同步');
  ensureRemote(GITEE_REMOTE, repoUrl);

  if (!noGithub) {
    const r = spawnSync(process.execPath, [path.join(buildDir, 'push-github.mjs')], { stdio: 'inherit', cwd: projectRoot });
    if (r.status !== 0) warn('GitHub Pages 那一步没成功（Gitee 镜像继续推）');
  } else {
    note('--no-github：只推 Gitee');
    /* 至少把 dist 提交了，否则推上去的还是上一版 */
    git(['add', '-A']);
    const staged = git(['diff', '--cached', '--name-only']);
    if (staged.status === 0 && (staged.stdout || '').trim()) {
      git(['commit', '-m', message || `同步镜像 ${version}`]);
      ok('已提交 dist/');
    }
  }

  const authUrl = authedUrl(repoUrl, { owner: config.gitee.owner, token: config.gitee.token });
  const branch = config.gitee.branch;
  const heads = probeGitee(authUrl, branch);
  if (!heads.ok) {
    bad('连不上 Gitee 仓库：' + heads.error);
    note(`确认仓库存在、令牌有写权限：https://gitee.com/${config.gitee.owner}/${config.gitee.repo}`);
    note('直连和本机代理都试过了 —— 检查网络，或者再跑一次（DNS 有时会抽）。');
    return 1;
  }
  const gargs = heads.args;
  if (heads.exists) {
    const fetched = fetchFrom(authUrl, branch, { args: gargs });
    if (fetched.status === 0) {
      const behind = git(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD']);
      if (behind.status !== 0) {
        warn('镜像分支上有别处的提交，先合一下');
        const merged = git(['merge', '--no-edit', 'FETCH_HEAD']);
        if (merged.status !== 0) {
          bad('合并失败（可能有冲突）：dist/ 里手动处理后再 push');
          return 1;
        }
      }
    }
  }
  let push = pushTo(authUrl, `HEAD:refs/heads/${branch}`, { args: gargs });
  if (push.status !== 0) {
    warn('第一次推被拒，fetch 后重试一次');
    fetchFrom(authUrl, branch, { args: gargs });
    push = pushTo(authUrl, `HEAD:refs/heads/${branch}`, { args: gargs });
  }
  if (push.status !== 0) {
    bad('推 Gitee 镜像失败：' + ((push.stderr || '') + (push.stdout || '')).trim().slice(0, 500));
    note('常见原因：仓库容量超 500MB、单文件超 50MB、令牌没写权限。');
    return 1;
  }
  ok(`Gitee 镜像已更新：https://gitee.com/${config.gitee.owner}/${config.gitee.repo}/tree/${branch}`);

  log('\n[4/4] 完成');
  log(`   学校那边刷新「班级百宝箱」（或点检查更新）即可拿到这一版\n`);
  return 0;
}

/** pull：把收件箱拉到本地 */
export async function cmdPull({ list = false, stamp = '', to = '', json = false } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  const branch = transport.inboxBranch || config.gitee.inboxBranch;

  if (list) {
    const items = await listInbox(transport, { branch });
    if (json) { console.log(JSON.stringify(items, null, 2)); return 0; }
    log('');
    if (!items.length) warn('收件箱是空的');
    for (const it of items) {
      if (!it.complete) { warn(`${it.stamp}（${it.reason}）`); continue; }
      ok(`${it.stamp} · ${it.root} · ${it.files.length} 个文件 · ${it.from || ''}`);
    }
    log('');
    return 0;
  }

  fs.mkdirSync(inboxDir, { recursive: true });
  const done = await pullInbox(transport, { into: inboxDir, stamp, branch, log: (m) => warn(m) });
  if (json) { console.log(JSON.stringify(done, null, 2)); return done.length ? 0 : 1; }
  log('');
  if (!done.length) {
    warn('没有新东西可拉');
    note('看看云端有什么：部署.cmd sync pull --list');
    return 0;
  }
  for (const d of done) ok(`${d.stamp}：${d.count} 个文件 → ${path.relative(projectRoot, d.dir)}`);
  log('');
  log('  下一步：部署.cmd sync apply --dry-run    （先看会改哪些文件）\n');
  return 0;
}

/** apply：按 roots 映射落进仓库 */
export async function cmdApply({ dryRun = true, stamp = '', only = '', to = '', json = false } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config } = ctx;

  const stamps = fs.existsSync(inboxDir)
    ? fs.readdirSync(inboxDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => b.localeCompare(a))
    : [];
  const pick = stamp || stamps[0];
  if (!pick) {
    bad('sync/inbox/ 里还没有东西 —— 先跑 `部署.cmd sync pull`');
    return 1;
  }
  const stampDir = path.join(inboxDir, pick);
  const { actions, counts } = applyInbox({
    stampDir,
    roots: config.roots,
    repoRoot: projectRoot,
    dryRun,
    only: only || null,
  });

  if (json) { console.log(JSON.stringify({ stamp: pick, dryRun, counts, actions: actions.map((a) => ({ root: a.root, rel: a.rel, state: a.state, to: path.relative(projectRoot, a.to) })) }, null, 2)); return 0; }

  log('');
  log(`收件箱 ${pick}：新增 ${counts.added} · 覆盖 ${counts.updated} · 一样 ${counts.identical}`);
  for (const a of actions.filter((x) => x.state !== 'identical').slice(0, 40)) {
    log(`   ${a.state === 'added' ? '＋' : '±'} [${a.root}] ${path.relative(projectRoot, a.to)}`);
  }
  if (actions.filter((x) => x.state !== 'identical').length > 40) note('（只列了前 40 条）');

  const touchedHwk = actions.some((a) => a.root === 'hwk' && a.state !== 'identical');
  if (dryRun) {
    log('');
    warn('这是预览（dry-run），仓库一个字都没改');
    if (counts.added + counts.updated === 0) return 0;
    log('  确认没问题再跑：部署.cmd sync apply --write\n');
    return 0;
  }
  ok('已写进仓库');
  if (touchedHwk) {
    note('作业清单要重建：node build/gen-hwk-index.mjs');
    const r = spawnSync(process.execPath, [path.join(buildDir, 'gen-hwk-index.mjs')], { stdio: 'inherit', cwd: projectRoot });
    if (r.status === 0) ok('作业清单已重建');
    else warn('作业清单没建成，手动跑：node build/gen-hwk-index.mjs');
  }
  log('  接着发布：部署.cmd full\n');
  return 0;
}

/** upload：把文件/目录传进收件箱（桌面版和控制台也用这份） */
export async function cmdUpload(paths, { root = 'misc', to = '', stamp = '', json = false, from = '' } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  if (!paths.length) { bad('要传什么？用法：部署.cmd sync upload <文件或目录…> [--root hwk]'); return 1; }

  const entries = [];
  for (const p of paths) {
    const abs = path.resolve(projectRoot, p);
    if (!fs.existsSync(abs)) { warn(`没有这个路径：${p}`); continue; }
    if (fs.statSync(abs).isDirectory()) entries.push(...collectDir(abs));
    else entries.push({ name: path.basename(abs), data: fs.readFileSync(abs) });
  }
  if (!entries.length) { bad('没有可传的文件'); return 1; }

  const branch = transport.inboxBranch || config.gitee.inboxBranch;
  const res = await pushInbox(transport, {
    root,
    entries,
    stamp: stamp || defaultStamp(),
    branch,
    from: from || hostName(),
  });
  if (json) { console.log(JSON.stringify(res, null, 2)); return 0; }
  log('');
  ok(`已上传 ${res.count} 个文件（${(res.size / 1024).toFixed(1)}KB，${res.parts} 个分卷）→ ${res.dir}/`);
  note('家里那边：部署.cmd sync pull → sync apply\n');
  return 0;
}

/**
 * 探一次 Gitee 仓库：先直连，连不上（本地 DNS 解不出 gitee.com 之类的）再退本机代理。
 * 返回 {ok, exists, args, error}，args 是这次能用的那组 git 参数，后面 push/fetch 沿用同一组。
 */
function probeGitee(url, branch) {
  let lastError = '';
  for (const args of [directArgs(), proxyArgsFor(url)]) {
    const r = remoteHeads(url, branch, { args });
    if (r.ok) return { ok: true, exists: r.exists, args, error: '' };
    lastError = r.error || '';
  }
  return { ok: false, exists: false, args: directArgs(), error: lastError };
}

function hostName() {
  try {
    return `${process.env.COMPUTERNAME || process.env.HOSTNAME || '设备'}`;
  } catch {
    return '设备';
  }
}

/** init：第一次用，确认权限 + 建收件箱分支 */
export async function cmdInit({ to = '' } = {}) {
  const ctx = context({ to });
  if (ctx.error) return 2;
  const { config, transport } = ctx;
  if (config.provider === 'local') {
    fs.mkdirSync(path.join(config.local.dir, INBOX_DIR), { recursive: true });
    ok(`本地通道已就绪：${config.local.dir}`);
    return 0;
  }
  const repoUrl = `https://gitee.com/${config.gitee.owner}/${config.gitee.repo}.git`;
  const authUrl = authedUrl(repoUrl, { owner: config.gitee.owner, token: config.gitee.token });
  const main = probeGitee(authUrl, config.gitee.branch);
  if (!main.ok) {
    bad('连不上仓库：' + main.error);
    note(`先在 Gitee 建一个仓库：https://gitee.com/projects/new （建议私有），名字 ${config.gitee.repo}`);
    return 1;
  }
  ok('仓库可达');
  const inbox = probeGitee(authUrl, config.gitee.inboxBranch);
  if (!inbox.exists) {
    if (!main.exists) {
      warn('镜像分支还没有内容 —— 先跑 `部署.cmd sync push`，它会把两个分支都建好');
      return 0;
    }
    const r = pushTo(authUrl, `refs/remotes/gitee/${config.gitee.branch}:refs/heads/${config.gitee.inboxBranch}`, { args: main.args });
    if (r.status !== 0) {
      /* 本地可能还没有那个 ref，退回用 HEAD 建分支 */
      const r2 = pushTo(authUrl, `HEAD:refs/heads/${config.gitee.inboxBranch}`, { args: main.args });
      if (r2.status !== 0) { bad('建收件箱分支失败：' + ((r2.stderr || '') + (r2.stdout || '')).trim().slice(0, 300)); return 1; }
    }
    ok(`已建收件箱分支 ${config.gitee.inboxBranch}`);
  } else {
    ok(`收件箱分支已存在（${config.gitee.inboxBranch}）`);
  }
  log('');
  log('  下一步：部署.cmd sync push     （把站点镜像推上去，学校那边就能取了）\n');
  return 0;
}

/** home：到家一条龙 */
export async function cmdHome({ yes = false, stamp = '', to = '' } = {}) {
  const pulled = await cmdPull({ stamp, to });
  if (pulled !== 0) return pulled;

  const ctx = context({ to });
  if (ctx.error) return 2;
  const stamps = fs.existsSync(inboxDir)
    ? fs.readdirSync(inboxDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => b.localeCompare(a))
    : [];
  if (!stamps.length) { warn('没有收件箱内容，直接去发布'); }
  else {
    await cmdApply({ dryRun: true, stamp: stamp || stamps[0], to });
    if (!yes) {
      if (!process.stdin.isTTY) {
        warn('不是交互终端：确认无误后加 -y 重跑，或分步 `sync apply --write`');
        return 1;
      }
      const answer = await ask('  按上面这份改动落进仓库并发布？[y/N] ');
      if (!/^y(es)?$/i.test(answer.trim())) { warn('已取消，什么都没改'); return 0; }
    }
    const applied = await cmdApply({ dryRun: false, stamp: stamp || stamps[0], to });
    if (applied !== 0) return applied;
  }

  log('\n发布（部署.cmd full）');
  const r = spawnSync(process.execPath, [path.join(buildDir, 'deploy-cli.mjs'), 'full', '--plain'], { stdio: 'inherit', cwd: projectRoot });
  return r.status === 0 ? 0 : 1;
}

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => resolve(String(d)));
    process.stdin.resume();
  });
}

/* ═══════════════════════════════════════════════════
   入口
   ═══════════════════════════════════════════════════ */

export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  const cmd = flags._[0] || 'status';
  const rest = flags._.slice(1);
  const common = { to: flags.to || '' };

  switch (cmd) {
    case 'check': return cmdCheck({ json: !!flags.json, ...common });
    case 'status': return cmdStatus({ json: !!flags.json, ...common });
    case 'push': return cmdPush({ dryRun: !!flags['dry-run'], noGithub: !!flags['no-github'], noPrep: !!flags['no-prep'], message: flags.message || '', ...common });
    case 'pull': return cmdPull({ list: !!flags.list, stamp: flags.stamp || '', json: !!flags.json, ...common });
    case 'apply': return cmdApply({ dryRun: !flags.write, stamp: flags.stamp || '', only: flags.only || '', json: !!flags.json, ...common });
    case 'upload': return cmdUpload(rest, { root: flags.root || 'misc', stamp: flags.stamp || '', json: !!flags.json, ...common });
    case 'init': return cmdInit(common);
    case 'home': return cmdHome({ yes: !!flags.yes, stamp: flags.stamp || '', ...common });
    case 'help': case '--help': console.log(USAGE); return 0;
    default:
      bad('没有这个子命令：' + cmd);
      console.log(USAGE);
      return 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => { process.exitCode = Number.isFinite(code) ? code : 0; })
    .catch((e) => { bad(e && e.stack ? e.stack : String(e)); process.exitCode = 1; });
}
