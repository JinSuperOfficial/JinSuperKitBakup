/**
 * 管线 / 进程 / 部署文件规则 的单元测试
 * ---------------------------------------------------
 * 这一层是三个前端（命令行、ink TUI、发布控制台）共用的地基，
 * 它坏了会以「部署少跑一步」的形式悄悄出问题，所以必须钉住：
 *   · 每条管线的**步骤顺序与 id**（控制台和 TUI 都按 id 认步骤）
 *   · 开关（--no-build 等）到底过滤掉了什么
 *   · 遇错停 / soft 步骤 / 事件序列
 *   · 哪些文件会被上传（EXCLUDE 在任意层级都要生效、asset/ 后写入覆盖）
 *   · 部署.cmd 必须保持纯 ASCII（cmd.exe 逐字节解码的坑，见 project.md §10.4）
 *
 * 跑法：node --test build/test-pipeline.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PIPELINES, QUICK_CHECK, JOB_PIPELINES, JOB_FLAGS, resolveSteps, runPipeline } from './lib/pipeline.mjs';
import { uploadSet, EXCLUDE, mirrorInto, countFiles } from './lib/deploy-files.mjs';
import { BACKUP_REPO, BACKUP_BRANCH, nestedReposIn, sanitize, checkTagName } from './lib/git-backup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

/* ═══════════ 管线定义 ═══════════ */

test('full 的顺序：构建 → 五个快速自检 → 组装 → 热铁盒 → GitHub', () => {
  const ids = PIPELINES.full.map((s) => s.id);
  assert.deepEqual(ids, [
    'build',
    'check-manifests', 'check-manifest-render', 'check-function', 'check-render', 'check-artifacts',
    'prep', 'rth', 'gh',
  ]);
});

test('每个步骤都有 id / label / script，id 不重复', () => {
  const seen = new Set();
  for (const [name, steps] of Object.entries(PIPELINES)) {
    for (const s of steps) {
      assert.ok(s.id && s.label && s.script, `${name} 里的步骤缺字段`);
      assert.ok(!seen.has(`${name}:${s.id}`), `${name} 里 ${s.id} 重复`);
      assert.ok(/^[\w.-]+\.mjs$/.test(s.script), `${s.script} 不像 build/ 下的脚本`);
    }
  }
});

test('check = 快速自检 + DOM 那套（顺序上 DOM 在最后）', () => {
  assert.deepEqual(PIPELINES.check.map((s) => s.id), [...QUICK_CHECK.map((s) => s.id), 'check-dom']);
});

test('热铁盒步骤带 --no-github（否则 deploy.mjs 会自己再推一次 GitHub）', () => {
  const rth = PIPELINES.rth[0];
  assert.ok(rth.args.includes('--no-github'));
});

test('控制台白名单只放开已知管线与开关', () => {
  assert.deepEqual(JOB_PIPELINES.slice().sort(), ['build', 'check', 'diff', 'full', 'gh', 'prep', 'quickCheck', 'rth']);
  assert.deepEqual(JOB_FLAGS, ['noBuild', 'noCheck', 'noGh', 'noRetry', 'noVerify']);
});

test('diff 管线 = push-github --check（只看不推）', () => {
  const [step] = PIPELINES.diff;
  assert.equal(step.script, 'push-github.mjs');
  assert.deepEqual(step.args, ['--check']);
});

/* ═══════════ 开关 ═══════════ */

test('--no-build / --no-check / --no-gh 各自只影响该影响的步骤', () => {
  assert.deepEqual(resolveSteps('full', { noBuild: true }).map((s) => s.id).includes('build'), false);
  assert.deepEqual(resolveSteps('full', { noBuild: true }).map((s) => s.id).includes('prep'), true);

  const noCheck = resolveSteps('full', { noCheck: true }).map((s) => s.id);
  assert.equal(noCheck.some((id) => id.startsWith('check-')), false);
  assert.ok(noCheck.includes('build') && noCheck.includes('gh'));

  assert.equal(resolveSteps('full', { noGh: true }).map((s) => s.id).includes('gh'), false);
});

test('--no-retry / --no-verify 只加在热铁盒那一步上', () => {
  const steps = resolveSteps('full', { noRetry: true, noVerify: true });
  const rth = steps.find((s) => s.id === 'rth');
  assert.ok(rth.args.includes('--no-retry') && rth.args.includes('--no-verify'));
  const build = steps.find((s) => s.id === 'build');
  assert.ok(!build.args.includes('--no-retry'));
});

test('--port 只加在 serve 上，并且支持重复解析不叠加', () => {
  const a = resolveSteps('serve', { port: 8790 });
  assert.deepEqual(a[0].args, ['8790']);
  const b = resolveSteps('serve', { port: 8790 });
  assert.deepEqual(b[0].args, ['8790'], '同一份定义不能被上一次调用污染');
  assert.deepEqual(resolveSteps('serve')[0].args, []);
});

test('未知管线要报错（而不是静默跑个空的）', () => {
  assert.throws(() => resolveSteps('nope', {}), /没有这个管线/);
});

/* ═══════════ 编排 ═══════════ */

function collector() {
  const events = [];
  return { events, onEvent: (e) => events.push(e) };
}

test('runPipeline：全部成功 → done.ok=true，事件里每步都有 start/ok', async () => {
  const { events, onEvent } = collector();
  const r = await runPipeline('build', {
    mode: 'pipe',
    onEvent,
    runStep: async () => ({ code: 0, ms: 12, mode: 'pipe' }),
  });

  assert.equal(r.ok, true);
  const states = events.filter((e) => e.ev === 'step').map((e) => `${e.id}:${e.state}`);
  assert.deepEqual(states, ['build:start', 'build:ok']);
  const done = events.find((e) => e.ev === 'done');
  assert.equal(done.ok, true);
  assert.deepEqual(done.steps.map((s) => s.id), ['build']);
});

test('runPipeline：失败即停，后面的步骤标 skipped', async () => {
  const { events, onEvent } = collector();
  const r = await runPipeline('full', {
    mode: 'pipe',
    onEvent,
    runStep: async (step) => (step.id === 'prep' ? { code: 1, ms: 3, mode: 'pipe' } : { code: 0, ms: 1, mode: 'pipe' }),
  });

  assert.equal(r.ok, false);
  const states = Object.fromEntries(events.filter((e) => e.ev === 'step').map((e) => [e.id, e.state]));
  assert.equal(states.prep, 'fail');
  assert.equal(states.rth, 'skipped');
  assert.equal(states.gh, 'skipped');
  /* 失败之前跑过的步骤仍然是 ok */
  assert.equal(states.build, 'ok');
});

test('runPipeline：--continue-on-error 时失败也继续', async () => {
  const r = await runPipeline('full', {
    mode: 'pipe',
    continueOnError: true,
    runStep: async (step) => ({ code: step.id === 'prep' ? 1 : 0, ms: 1, mode: 'pipe' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.steps.find((s) => s.id === 'gh').state, 'ok');
});

test('runPipeline：soft 步骤被 Ctrl+C 停掉算 stopped，不算失败（serve 就是这样）', async () => {
  const r = await runPipeline('serve', {
    mode: 'pipe',
    runStep: async () => ({ code: 1, ms: 5, mode: 'pipe' }),
  });
  assert.equal(r.ok, true, 'serve 被停掉不该让整条管线判失败');
  assert.equal(r.steps[0].state, 'stopped');
});

test('runPipeline：runStep 抛错时不会把整个进程带走', async () => {
  await assert.rejects(() => runPipeline('build', {
    mode: 'pipe',
    runStep: async () => { throw new Error('模拟崩溃'); },
  }), /模拟崩溃/);
});

/* ═══════════ 部署文件规则 ═══════════ */

function tmpRoot(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  return d;
}

test('uploadSet：EXCLUDE 在任意层级都生效，asset/ 后写入覆盖同名', () => {
  const root = tmpRoot('deploy-files');
  const site = path.join(root, 'site');
  const asset = path.join(root, 'asset');

  fs.mkdirSync(path.join(site, 'p'), { recursive: true });
  fs.mkdirSync(path.join(site, 'build'), { recursive: true });          /* 站点里混了个 build/ */
  fs.mkdirSync(path.join(site, 'p', 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(site, 'asset'), { recursive: true });
  fs.mkdirSync(path.join(asset, 'icon'), { recursive: true });

  fs.writeFileSync(path.join(site, 'index.html'), 'site');
  fs.writeFileSync(path.join(site, 'p', 'a.md'), 'a');
  fs.writeFileSync(path.join(site, 'build', 'x.js'), 'should be skipped');
  fs.writeFileSync(path.join(site, 'p', 'node_modules', 'y.js'), 'should be skipped');
  fs.writeFileSync(path.join(site, 'asset', 'only-in-site.svg'), 'site version');   /* 根 asset 没有它 */
  fs.writeFileSync(path.join(site, 'asset', 'same.svg'), 'site version');
  fs.writeFileSync(path.join(asset, 'icon', 'logo.svg'), 'logo');
  fs.writeFileSync(path.join(asset, 'same.svg'), 'root version');

  const set = uploadSet(site, asset);
  assert.ok(set.has('index.html'));
  assert.ok(set.has('p/a.md'));
  assert.ok(!set.has('build/x.js'), 'EXCLUDE 里的目录在任意层级都要跳过');
  assert.ok(!set.has('p/node_modules/y.js'), '嵌套的 node_modules 也要跳过');
  assert.ok(set.has('asset/icon/logo.svg'), '项目根 asset/ 会镜像进 dist/asset/');
  assert.ok(set.has('asset/only-in-site.svg'));
  assert.equal(set.get('asset/same.svg'), path.join(asset, 'same.svg'), '同名时项目根 asset/ 胜出');

  fs.rmSync(root, { recursive: true, force: true });
});

test('mirrorInto：增量（内容没变不动）、prune 掉源站已删除的文件、保住 .git', () => {
  const root = tmpRoot('mirror');
  const site = path.join(root, 'site');
  const asset = path.join(root, 'asset');
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(site, 'p'), { recursive: true });
  fs.mkdirSync(asset, { recursive: true });
  fs.mkdirSync(path.join(dist, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'p'), { recursive: true });

  fs.writeFileSync(path.join(site, 'p', 'a.md'), 'a');
  fs.writeFileSync(path.join(dist, 'p', 'a.md'), 'a');            /* 一样 → 不动 */
  const before = fs.statSync(path.join(dist, 'p', 'a.md')).mtimeMs;

  fs.writeFileSync(path.join(dist, 'p', 'old.md'), 'old');        /* 源站没了 → 该清 */
  fs.writeFileSync(path.join(dist, '.git', 'HEAD'), 'ref: x');    /* .git 必须留着 */
  fs.writeFileSync(path.join(dist, 'CNAME'), 'x');               /* 根部手工文件要保留 */

  const r = mirrorInto(dist, { siteRootAbs: site, assetDirAbs: asset });
  assert.equal(r.added, 0);
  assert.equal(r.updated, 0);
  assert.equal(r.identical, 1);
  assert.equal(fs.statSync(path.join(dist, 'p', 'a.md')).mtimeMs, before, '内容一样时不该改写（增量上传靠它）');
  assert.ok(r.pruned.includes('p/old.md'));
  assert.ok(fs.existsSync(path.join(dist, '.git', 'HEAD')));
  assert.ok(fs.existsSync(path.join(dist, 'CNAME')));

  fs.writeFileSync(path.join(site, 'p', 'a.md'), 'a2');
  const r2 = mirrorInto(dist, { siteRootAbs: site, assetDirAbs: asset });
  assert.equal(r2.updated, 1);
  assert.deepEqual(r2.changed, ['p/a.md']);
  assert.equal(countFiles(dist), 2);   /* p/a.md + CNAME（.git 不计，.gitignore 是 prep-deploy 写的） */

  fs.rmSync(root, { recursive: true, force: true });
});

test('EXCLUDE 里不该出现站点需要的东西（防手滑删条目）', () => {
  for (const bad of ['p', 'asset', 'Skills', '811', 'index.html', 'sk.json', 'lib']) {
    assert.ok(!EXCLUDE.has(bad), `${bad} 不能进 EXCLUDE`);
  }
});

/* ═══════════ 命令行契约 ═══════════ */

const runCli = (script, args) => spawnSync(process.execPath, [path.join(here, script), ...args], {
  cwd: projectRoot, encoding: 'utf8',
});

test('run-pipeline.mjs：不给 --steps 直接拒绝（这个工具背后是线上部署）', () => {
  const r = runCli('run-pipeline.mjs', []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /必须显式指定 --steps/);
});

test('run-pipeline.mjs：不存在的步骤要报错并列出可用的', () => {
  const r = runCli('run-pipeline.mjs', ['--steps=nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /没有这些步骤/);
  assert.match(r.stderr, /check-manifests/);
});

test('run-pipeline.mjs：--help 走帮助（不会顺手部署）', () => {
  const r = runCli('run-pipeline.mjs', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /用法：node build\/run-pipeline\.mjs/);
});

test('部署.cmd 必须是纯 ASCII（cmd.exe 逐字节解码，非 ASCII 会错位执行）', () => {
  const buf = fs.readFileSync(path.join(projectRoot, '部署.cmd'));
  const bad = [];
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) bad.push(i);
  assert.deepEqual(bad, [], `第 ${bad[0]} 字节起有非 ASCII 字符`);
});

test('控制台.cmd 必须是纯 ASCII', () => {
  const buf = fs.readFileSync(path.join(projectRoot, '控制台.cmd'));
  assert.equal(buf.some((b) => b > 0x7f), false);
});

test('deploy-cli.mjs 还能直接跑（--help 不会抛）', () => {
  const r = runCli('deploy-cli.mjs', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /用法：部署\.cmd/);
});

/* ═══════════ 源码备份（独立功能，不属于部署管线） ═══════════ */

test('备份源码不在任何部署管线里（full 不能顺手把源码也推了）', () => {
  for (const [name, steps] of Object.entries(PIPELINES)) {
    assert.ok(!steps.some((s) => s.id === 'bakup'), `${name} 里不该有 bakup 步骤`);
    assert.ok(!steps.some((s) => s.script === 'backup-github.mjs'), `${name} 里不该跑 backup-github.mjs`);
  }
  assert.equal(JOB_PIPELINES.includes('bakup'), false);
});

test('备份仓库地址与分支是钉住的（写错就是把源码推到别人仓库）', () => {
  assert.equal(BACKUP_REPO, 'https://github.com/JinSuperOfficial/JinSuperKitBakup.git');
  assert.equal(BACKUP_BRANCH, 'main');
  assert.match(BACKUP_REPO, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
});

test('nestedRepos：找出自带 .git 的子目录（含嵌套两层），且跳过 node_modules/dist', () => {
  const root = tmpRoot('nested-repos');
  const mk = (rel) => fs.mkdirSync(path.join(root, rel), { recursive: true });
  mk('src');
  mk('dist/.git');                       /* 第 1 层：发布产物仓库 */
  mk('.agents/skills/theme-plus/.git');  /* 第 3 层：工具自带的仓库 */
  mk('a/b/deep-repo/.git');              /* 第 3 层：通用嵌套仓库 */
  mk('node_modules/dep/.git');           /* 必须跳过：不是我们的源码 */
  mk('plain/nested');                    /* 普通目录，不算 */

  const found = nestedReposIn(root).map((r) => r.rel).sort();
  /* dist 和 node_modules 属于 BACKUP_SKIP_DIRS（跟 .gitignore 一样不进备份），
     所以连报都不用报；真正要报的是那些「看着像源码、其实自带仓库」的目录 */
  assert.deepEqual(found, ['.agents/skills/theme-plus', 'a/b/deep-repo']);
  assert.ok(found.every((r) => !r.startsWith('node_modules') && !r.startsWith('dist')));

  /* depth 收窄到 1 时只看根的直接子目录 */
  assert.deepEqual(nestedReposIn(root, 1).map((r) => r.rel), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sanitize：认证报错里带 token 的 URL 不会被原样打进日志', () => {
  const raw = 'fatal: could not read from https://ghp_abcd1234@github.com/x/y.git';
  const clean = sanitize(raw);
  assert.ok(!clean.includes('ghp_abcd1234'), 'token 必须被抹掉');
  assert.match(clean, /github\.com\/x\/y\.git/);
});

/* ═══════════ 备份的版本 tag ═══════════ */

test('checkTagName：交给 git 判（正常名字放行，带空格/怪字符的拦住）', () => {
  assert.equal(checkTagName('v1.0.0').ok, true);
  assert.equal(checkTagName('bakup-20261004-0842').ok, true);
  assert.equal(checkTagName('发布-第一个版本').ok, true);
  assert.equal(checkTagName('').ok, false);
  assert.equal(checkTagName('   ').ok, false);
  assert.equal(checkTagName('v1.0.0 空格').ok, false);
  assert.equal(checkTagName('v1..0').ok, false, '连续的 . 不是合法 ref');
  assert.equal(checkTagName('v1.0.0^').ok, false);
  assert.ok(checkTagName('a b').error, '不合格要给一句人话');
});

test('附注 tag：打完能查到、指向当前提交，删掉后不残留', () => {
  /* 在临时仓库里跑，绝不碰项目根自己的 tag。
     用 `git -C <dir> tag -a` 走的是和 lib/git-backup.mjs 里 createTag 同一条命令。 */
  const root = tmpRoot('tag-check');
  const inTmp = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  inTmp(['init', '-b', 'main']);
  inTmp(['config', 'user.name', 'Test']);
  inTmp(['config', 'user.email', 't@example.com']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  inTmp(['add', '-A']);
  inTmp(['commit', '-m', '第一次备份']);

  const made = inTmp(['tag', '-a', 'v1.0.0', '-m', '备份 X · 提交 abc123']);
  assert.equal(made.status, 0, made.stderr);

  const list = inTmp(['tag', '-l']).stdout.trim().split(/\r?\n/);
  assert.deepEqual(list, ['v1.0.0']);
  /* 附注 tag：cat-file 的类型是 tag（轻量 tag 是 commit），说明也存得住 */
  assert.equal(inTmp(['cat-file', '-t', 'v1.0.0']).stdout.trim(), 'tag');
  assert.match(inTmp(['tag', '-n', 'v1.0.0']).stdout, /备份 X · 提交 abc123/);
  const head = inTmp(['rev-parse', 'HEAD']).stdout.trim();
  assert.equal(inTmp(['rev-parse', 'v1.0.0^{commit}']).stdout.trim(), head, 'tag 要指向当前提交');

  /* 重名不该被静默覆盖：git 自己就会拒 */
  assert.notEqual(inTmp(['tag', '-a', 'v1.0.0', '-m', 'x']).status, 0);

  inTmp(['tag', '-d', 'v1.0.0']);
  assert.equal(inTmp(['tag', '-l']).stdout.trim(), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('backup-github.mjs：--help 走帮助（不会顺手暂存/推送）', () => {
  const r = runCli('backup-github.mjs', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /用法：node build\/backup-github\.mjs/);
  assert.match(r.stdout, /JinSuperKitBakup/);
});

test('backup-github.mjs：--check 是干跑（不改提交、不推送）', () => {
  /* 不加 --check 时这个工具会真往备份仓库推，所以只测「帮助」和「干跑」两种模式，
     用 --message 之外不传任何东西也不行 —— 这里只断言帮助文案里写清了 --check */
  const r = runCli('backup-github.mjs', ['--help']);
  assert.match(r.stdout, /--check/);
  assert.match(r.stdout, /不提交也不推/);
});
