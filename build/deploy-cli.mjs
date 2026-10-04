/**
 * 部署 CLI
 * ---------------------------------------------------
 * `部署.cmd` 双击进来的就是这个。它本身只负责「好看 + 好按」，
 * 真正的活还是交给原来那几个脚本干（build.mjs / prep-deploy.mjs /
 * deploy.mjs / push-github.mjs / 三个测试），这样命令行和 npm script
 * 不会各做一套、慢慢长歪。
 *
 * 跑法：
 *   node build/deploy-cli.mjs              进交互菜单
 *   node build/deploy-cli.mjs full         一条龙部署
 *   node build/deploy-cli.mjs full -y      不确认，直接干
 *   node build/deploy-cli.mjs check        跑自检
 *
 * 子进程一律用 stdio:'inherit'：这是部署工具，输出原样透到终端最直观
 * （颜色、进度、热铁盒 CLI 自己的提示都保留），也免得把几百 KB 的
 * 上传日志攒在内存里。只有查状态那几条短命令用管道抓回来解析。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { buildDir, siteRoot } from './paths.mjs';
import { PIPELINES, resolveSteps } from './lib/pipeline.mjs';
import { stepArgv } from './lib/proc.mjs';
import { BACKUP_REPO } from './lib/git-backup.mjs';

const projectRoot = path.resolve(buildDir, '..');
const distDir = path.join(projectRoot, 'dist');
const NODE = process.execPath;

/* ═══════════════════════════════════════════════════
   输出
   ═══════════════════════════════════════════════════ */

/* 只有在真终端里才上色：重定向到文件时留着转义字符会很难看。
   NO_COLOR 是通用约定，--no-color 给个显式开关。 */
const COLOR = !process.argv.includes('--no-color')
  && !process.env.NO_COLOR
  && !!process.stdout.isTTY;

const paint = (code) => (s) => (COLOR ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);

const RULE = '─'.repeat(58);

/** 中日韩字符占两格，按显示宽度补齐才对得齐 */
function width(s) {
  let n = 0;
  for (const ch of String(s)) {
    n += /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  }
  return n;
}
function pad(s, n) {
  return String(s) + ' '.repeat(Math.max(0, n - width(s)));
}

function title(text) {
  console.log('\n' + bold(text));
  console.log(dim(RULE));
}
function ok(msg) { console.log(green('  ✓ ') + msg); }
function warn(msg) { console.log(yellow('  ! ') + msg); }
function fail(msg) { console.log(red('  ✗ ') + msg); }
function note(msg) { console.log(dim('    ' + msg)); }

/* ═══════════════════════════════════════════════════
   交互
   ═══════════════════════════════════════════════════ */

/* 整个会话共用一个 readline 实例。
   每问一次就新建一个的话，'close' 监听器会越挂越多（Node 到 11 个就告警），
   而且 stdin 这个流被反复接管也容易出怪问题。

   这里不用 rl.question()，改成自己收 'line' 排成队列，原因：
   输入来自管道或文件时，readline 会**一次性**把内容全读出来并立刻触发
   close，而 question() 只认「下一个到达的行」。结果就是菜单刚问第一句，
   close 已经发生，后面几行全被当成「输入结束」丢掉。
   排队之后 TTY 和管道的行为就一致了，也方便拿文件喂输入做测试。 */
let rl = null;
let eof = false;                 /* stdin 没了（管道读完 / 被关掉） */
const lineQueue = [];            /* 已经到达、还没人取的行 */
const waiters = [];              /* 已经在等、还没有行的人 */

const IS_TTY = !!process.stdin.isTTY;

/** 把队列里的行发给等待者；eof 之后剩下的人一律收 null */
function pump() {
  while (waiters.length && lineQueue.length) waiters.shift()(lineQueue.shift());
  if (eof) while (waiters.length) waiters.shift()(null);
}

function input() {
  if (eof) return null;
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (l) => { lineQueue.push(String(l).trim()); pump(); });
    rl.on('close', () => { eof = true; rl = null; pump(); });
  }
  return rl;
}

/**
 * 问一句。
 * @returns {Promise<string|null>} 用户输入（已 trim）；stdin 断了返回 **null**
 *
 * 区分 null 和 '' 很关键：
 *   ''   有人按了回车 —— 对「请选择」等于用默认值，对「确认」等于同意
 *   null 根本没人 —— 绝不能当成同意，否则 `echo x | 部署.cmd`
 *        会在无人确认的情况下真的把站点发出去
 */
function ask(q) {
  process.stdout.write(q);

  if (lineQueue.length) {
    const v = lineQueue.shift();
    /* 管道/文件里 readline 不回显，补一行出来，日志才读得懂 */
    if (!IS_TTY) process.stdout.write(v + '\n');
    return Promise.resolve(v);
  }

  if (!input()) { if (!IS_TTY) process.stdout.write('\n'); return Promise.resolve(null); }

  return new Promise((resolve) => {
    waiters.push((v) => {
      /* 管道/文件里 readline 不回显，补一行出来，日志才读得懂 */
      if (!IS_TTY && v !== null) process.stdout.write(v + '\n');
      resolve(v);
    });
    pump();
  });
}

/* readline 关掉之后再 pause/resume 会抛 ERR_USE_AFTER_CLOSE，
   而子进程跑完时它可能正好已经关了，所以这里要挡一下。 */
function pauseInput() { if (rl && !eof) { try { rl.pause(); } catch { /* 已关闭，忽略 */ } } }
function resumeInput() { if (rl && !eof) { try { rl.resume(); } catch { /* 已关闭，忽略 */ } } }

function closeInput() {
  if (rl) { const r = rl; rl = null; r.close(); }
}

/* ═══════════════════════════════════════════════════
   跑子进程
   ═══════════════════════════════════════════════════ */

/** 抓一小段输出回来解析（只用于 status 这类短命令） */
function capture(cmd, args, cwd = projectRoot) {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout || '').trim();
  } catch {
    return null;
  }
}

/* 子进程跑着的时候，Ctrl+C 交给它自己处理（同一个控制台，它也会收到）。
   我们只在没人跑子进程时接管，免得把 serve 的服务器杀一半。 */
let inChild = false;

/**
 * 跑一个步骤：打印标题、计时、把子进程输出原样透出来。
 * @param {string} label
 * @param {string[]} args  node 的参数（脚本路径开头）
 * @param {{soft?: boolean}} [opts] soft=true 表示非 0 退出不算错（比如 serve 被 Ctrl+C 停掉）
 * @returns {number} 退出码
 */
function run(label, args, opts = {}) {
  console.log('');
  console.log(cyan('▶ ') + bold(label));
  pauseInput();                       /* 别让菜单抢走子进程的按键 */

  const t0 = Date.now();
  inChild = true;
  const r = spawnSync(NODE, args, { stdio: 'inherit', cwd: projectRoot, env: process.env });
  inChild = false;

  resumeInput();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.error) {
    fail(`${label} 起不来：${r.error.message}`);
    return 1;
  }
  const code = r.status ?? 1;
  if (code === 0) ok(`${label} · ${secs}s`);
  else if (opts.soft) warn(`${label} 已停止 · ${secs}s`);
  else fail(`${label} 失败（退出码 ${code}）· ${secs}s`);
  return code;
}

/* ═══════════════════════════════════════════════════
   站点状态（菜单里和 status 命令共用）
   ═══════════════════════════════════════════════════ */

function findDeno() {
  const local = [
    path.join(projectRoot, 'node_modules', '.bin', 'deno.cmd'),
    path.join(projectRoot, 'node_modules', '.bin', 'deno'),
    path.join(buildDir, 'node_modules', '.bin', 'deno.cmd'),
    path.join(buildDir, 'node_modules', '.bin', 'deno'),
  ].find((p) => fs.existsSync(p));
  if (local) return { ok: true, where: '项目内 ' + path.relative(projectRoot, local) };

  const sys = capture('deno', ['--version']);
  if (sys) return { ok: true, where: '系统 ' + sys.split(/\r?\n/)[0] };
  return { ok: false, where: '没找到（首次部署会自动 npm 装一个）' };
}

/** 数文件。dist 里的 .git 是推送用的仓库，不该算进「站点文件」里。 */
function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

function readEnvKey() {
  const f = path.join(projectRoot, '.env');
  if (!fs.existsSync(f)) return null;
  const m = /^RTH_API_KEY\s*=\s*(\S+)/m.exec(fs.readFileSync(f, 'utf8'));
  if (!m) return null;
  const k = m[1];
  /* 只露头尾，够确认「是哪个 key」就行，别把密钥整条打进终端历史 */
  return k.length > 10 ? k.slice(0, 4) + '…' + k.slice(-4) : k;
}

/** 读 rth-sites.json：要发到哪几个热铁盒站点 */
function readSites() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(projectRoot, 'rth-sites.json'), 'utf8'));
    return (j.sites || [])
      .map((s) => (typeof s === 'string' ? { site: s, domains: [] } : s))
      .filter((s) => s && s.site);
  } catch {
    return [];
  }
}

function siteInfo() {
  const sites = readSites();
  /* git 只查本地，不 fetch —— 状态要秒出，不能等网络 */
  const distRepo = fs.existsSync(path.join(distDir, '.git'));
  const dgit = (args) => capture('git', args, distDir);
  return {
    sites,
    deno: findDeno(),
    key: readEnvKey(),
    distFiles: countFiles(distDir),
    siteFiles: countFiles(siteRoot),
    branch: distRepo ? dgit(['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    dirty: distRepo ? (dgit(['status', '--porcelain']) || '').split(/\r?\n/).filter(Boolean).length : 0,
    ahead: distRepo ? Number(dgit(['rev-list', '--count', 'origin/main..HEAD']) || 0) : 0,
    last: distRepo ? dgit(['log', '-1', '--format=%s']) : null,
    /* 源码备份仓库（项目根那份 .git）—— 和 dist/ 那份是两回事，别混着看 */
    srcRepo: fs.existsSync(path.join(projectRoot, '.git')),
    srcBranch: capture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], projectRoot),
    srcDirty: (capture('git', ['status', '--porcelain'], projectRoot) || '').split(/\r?\n/).filter(Boolean).length,
    srcOrigin: capture('git', ['remote', 'get-url', 'origin'], projectRoot),
    srcCommits: Number(capture('git', ['rev-list', '--count', 'HEAD'], projectRoot) || 0),
  };
}

function printInfo() {
  const i = siteInfo();
  const line = (k, v) => console.log('  ' + dim(pad(k, 10)) + v);

  line('站点', `${path.basename(siteRoot)} · ${i.siteFiles} 个文件`);
  /* 热铁盒里 jinsuper.cn 是独立的一个站，不是 jinsuper 的别名，
     所以这里把要发的站全列出来，免得以为只发了主站。 */
  line('热铁盒', i.sites.length
    ? i.sites.map((s) => s.site).join('  +  ')
    : red('rth-sites.json 读不到'));
  line('dist/', i.distFiles ? `${i.distFiles} 个文件` : red('还没组装（先跑一次「只组装」）'));
  line('.env', i.key ? `${green('✓')} RTH_API_KEY=${i.key}` : red('✗ 缺失，热铁盒传不了'));
  line('Deno', (i.deno.ok ? green('✓ ') : yellow('! ')) + i.deno.where);

  if (i.branch) {
    const bits = [i.dirty ? yellow(`${i.dirty} 个文件待提交`) : '无待提交改动'];
    if (i.ahead) bits.push(yellow(`领先远程 ${i.ahead} 个提交`));
    line('Git', `${green('✓')} ${i.branch} · ${bits.join(' · ')}`);
    if (i.last) note('最近一次：' + i.last);
  } else {
    line('Git', yellow('! dist/.git 还没建，第一次推送时自动初始化'));
  }

  /* 源码备份是独立功能，状态单独一行（还没有 .git 就说清楚，别让人以为坏了） */
  if (!i.srcRepo) {
    line('源码备份', yellow('! 项目根还没有 .git，第一次跑「备份源码」时会自动建'));
  } else {
    const bits = [
      i.srcCommits ? `${i.srcCommits} 个提交` : '还没有提交',
      i.srcDirty ? yellow(`${i.srcDirty} 个改动待提交`) : '无待提交改动',
    ];
    line('源码备份', `${green('✓')} ${i.srcBranch || 'main'} · ${bits.join(' · ')}`);
    note(i.srcOrigin ? '→ ' + i.srcOrigin : '! 还没配远程（跑一次「备份源码」会自动加上）');
  }
}

/* ═══════════════════════════════════════════════════
   步骤
   ---------------------------------------------------
   标签与参数都从 build/lib/pipeline.mjs 取（唯一来源）——
   ink TUI 和发布控制台用的是同一张表，
   这样三个前端不会各自长出一套「部署包含什么」。
   ═══════════════════════════════════════════════════ */

const has = (flag) => process.argv.includes(flag);

/** 把管线里的一个步骤交给 run()（保持输出格式完全不变） */
function runStep(step, opts = {}) {
  return run(step.label, stepArgv(step, buildDir), opts);
}

/** 按 id 挑步骤（参数里带开关时用） */
function stepsOf(name, flags = {}) {
  return resolveSteps(name, flags);
}

const doBuild = () => runStep(PIPELINES.build[0]);

/* 只跑快的那两套：渲染断言 + 产物结构检查，一两秒。
   慢的那套（jsdom 跑整页）留给 check 命令。 */
function doQuickCheck() {
  for (const s of PIPELINES.quickCheck) {
    const code = runStep(s);
    if (code !== 0) return code;
  }
  return 0;
}

function doFullCheck() {
  const a = doQuickCheck();
  if (a !== 0) return a;
  return runStep(PIPELINES.check[PIPELINES.check.length - 1]);
}

const doPrep = () => runStep(PIPELINES.prep[0]);

/**
 * 热铁盒上传（含组装）。
 * 重试在 deploy.mjs 里**按站点**做 —— 放到这一层的话，
 * 一个站挂了会把已经传好的另一个站也重跑一遍（那一步要几十秒）。
 */
function doRetinbox() {
  const [step] = stepsOf('rth', {
    noRetry: has('--no-retry'),
    noVerify: has('--no-verify'),
  });
  return runStep(step);
}

const doGithub = () => runStep(PIPELINES.gh[0]);

/** 组装 + 推 GitHub（不碰热铁盒） */
function doGithubWithPrep() {
  const a = doPrep();
  if (a !== 0) return a;
  return doGithub();
}

/**【源码备份】直接把项目根那份 .git 推到备份仓库。
 *
 * 和「推 GitHub Pages」完全是两条独立的线：
 *   · 这边 = 项目根 + 源码全量 + 备份仓库（JinSuperKitBakup）
 *   · 那边 = dist/ + 编译产物 + Pages 仓库（JinSuper.github.io）
 * 所以它不放进任何部署管线（full 里没有它），也不碰 dist/、不碰 DENO_DIR。
 *
 * ⚠ 只想试跑、不想真推：加 --check，只看会备份什么。 */
function doBakup() {
  const args = [path.join(buildDir, 'backup-github.mjs')];
  if (has('--check') || has('--dry-run')) args.push('--check');
  const msg = valueOf('--message') || valueOf('-m');
  if (msg) args.push('--message', msg);
  return run(has('--check') || has('--dry-run') ? '备份源码（只看，不推）' : '备份源码', args);
}

/** 取 `--opt 值` 或 `--opt=值` 里的值（没写就返回 null） */
function valueOf(name) {
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1) || null;
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('-') ? v : null;
}

/** 备份前先让你看清推的是什么、推到哪儿，再确认一次 */
async function cmdBakup() {
  title('备份源码到 GitHub');
  printInfo();

  const cur = capture('git', ['remote', 'get-url', 'origin'], projectRoot);
  console.log('');
  console.log('  目标：' + cyan(cur || BACKUP_REPO) + (cur ? '' : dim('（还没配远程，会自动加上）')));
  /* 远程被人改过的话，backup-github.mjs 会直接停下来报错，这里先说一句 */
  if (cur && cur !== BACKUP_REPO) warn('这不是备份仓库的地址，跑下去会被拦下（不会往别的仓库推）');
  note('备份的是整个项目源码；node_modules / dist / .env / .deploy-logs 这些按 .gitignore 排除。');
  note('和「推 GitHub Pages」互不影响：那条推的是 dist/，这条推的是项目根源码。');

  if (has('--check') || has('--dry-run')) return doBakup();
  if (!(await confirm('确认备份并推送到上面这个仓库？'))) return 0;
  return doBakup();
}

function doDiff() {
  if (!fs.existsSync(distDir)) {
    warn('还没有 dist/，先跑一次「只组装」');
    return 1;
  }
  return run('看会提交什么（不推）', [path.join(buildDir, 'push-github.mjs'), '--check']);
}

/** 这个端口现在空着吗（真的去绑一下，别猜） */
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** 这个端口上是不是已经开着一个本站预览？看它吐不吐文档页的特征 */
async function probePreview(port) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}/p/docs.html`, { signal: ctl.signal });
    const body = await r.text();
    clearTimeout(timer);
    return r.ok && /docs-md\.js|docs-card\.js/.test(body);
  } catch {
    return false;   /* 连不上、超时、根本不是 HTTP —— 都当它不是我们的 */
  }
}

async function doServe() {
  const at = process.argv.indexOf('--port');
  const asked = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  const base = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 8788;
  let port = base;

  if (!(await portFree(base))) {
    /* 最常见的情况：上一次的预览还开着（窗口关了但进程没退）。
       那就别重开一个，直接把地址给他 —— 这正是他想要的。 */
    if (await probePreview(base)) {
      console.log('');
      ok(`预览已经在 ${base} 端口上跑着了，不用再开一个`);
      console.log('    打开：' + cyan(`http://127.0.0.1:${base}/p/docs.html`));
      note('想重开就先在原来那个窗口里按 Ctrl+C');
      note('或者换个端口：部署.cmd serve --port 8790');
      return 0;
    }

    /* 被别的程序占着：往后找个空的 */
    let p = base + 1;
    while (p <= base + 20 && !(await portFree(p))) p++;
    if (p > base + 20) {
      fail(`${base} ~ ${base + 20} 全被占用了，先清理一下端口再试`);
      return 1;
    }
    warn(`${base} 被别的程序占着（不像是本站预览），改用 ${p}`);
    port = p;
  }

  console.log('');
  console.log('  本地预览：' + cyan(`http://127.0.0.1:${port}/p/docs.html`));
  console.log(dim('  按 Ctrl+C 停掉服务器'));
  return run('本地预览', [path.join(buildDir, '.serve.mjs'), String(port)], { soft: true });
}

/** 组装完顺手把「这次变了什么」打出来，省得往上翻长输出 */
function showChanged() {
  const f = path.join(projectRoot, '.deploy-changed.txt');
  if (!fs.existsSync(f)) return;
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(2).filter(Boolean);
  if (!lines.length) return;
  console.log('');
  console.log(dim(`  变化 ${lines.length} 个文件：`));
  for (const l of lines.slice(0, 15)) note(l);
  if (lines.length > 15) note(`… 还有 ${lines.length - 15} 个`);
}

/** 通用确认。读不到输入（stdin 断了）一律当作「不继续」，绝不默认往下跑。 */
async function confirm(question) {
  if (has('-y') || has('--yes')) return true;

  const a = await ask('\n  ' + question + dim(' (Y/n) '));
  if (a === null) {
    /* ask 没等到回车就返回了，光标还停在提示行上，先换行再说话 */
    console.log('');
    warn('读不到确认输入，已取消（想免确认请加 -y）');
    return false;
  }
  if (a && !/^y(es)?$/i.test(a)) { warn('已取消'); return false; }
  return true;
}

/* ═══════════════════════════════════════════════════
   命令
   ═══════════════════════════════════════════════════ */

/** 一条龙：构建 → 快速自检 → 组装 → 热铁盒 → GitHub */
async function cmdFull() {
  title('一键部署');
  printInfo();

  /* 构建和自检都能关：只改了几篇 .md 的时候没必要重来一遍 */
  const skipBuild = has('--no-build');
  const skipCheck = has('--no-check') || has('--skip-check');
  const noGh = has('--no-gh') || has('--no-github');

  if (!(has('-y') || has('--yes'))) {
    const plan = [
      skipBuild ? null : '重新构建产物',
      skipCheck ? null : '跑快速自检',
      '组装 dist/',
      '传热铁盒',
      noGh ? null : '推 GitHub',
    ].filter(Boolean);
    console.log('');
    console.log('  将要执行：' + dim(plan.join('  →  ')));
    if (!(await confirm('继续？'))) return 0;
  }

  if (!skipBuild) {
    const code = doBuild();
    if (code !== 0) return code;
  }
  if (!skipCheck) {
    const code = doQuickCheck();
    if (code !== 0) {
      fail('自检没过，已经拦下这次部署（想强行部署加 --no-check）');
      return code;
    }
  }

  const rth = doRetinbox();
  if (rth !== 0) {
    fail('热铁盒没传上去。产物已经组装好了，网络恢复后重跑「部署.cmd rth」即可。');
    return rth;
  }

  if (noGh) {
    console.log('');
    ok('热铁盒完成');
    for (const s of readSites()) {
      for (const d of s.domains || []) console.log('    ' + cyan('https://' + d));
    }
    return 0;
  }

  const gh = doGithub();
  if (gh !== 0) {
    warn('GitHub 那步没成功，但热铁盒已经部署好了');
    note('单独重试：部署.cmd gh');
    return 0;   /* 主目标（热铁盒）已达成，不算整体失败 */
  }

  console.log('');
  console.log(bold('  全部完成'));
  for (const s of readSites()) {
    for (const d of s.domains || []) console.log('    热铁盒  ' + cyan('https://' + d));
  }
  console.log('    GitHub  ' + cyan('https://jinsuperofficial.github.io/'));
  return 0;
}

async function cmdBuild() {
  title('构建产物');
  return doBuild();
}

async function cmdPrep() {
  title('组装 dist/');
  const code = doPrep();
  if (code === 0) showChanged();
  return code;
}

async function cmdRth() {
  title('传热铁盒');
  printInfo();
  return doRetinbox();
}

async function cmdGh() {
  title('推 GitHub Pages');
  printInfo();
  if (!(await confirm('确认推送到 GitHub？'))) return 0;
  return doGithubWithPrep();
}

async function cmdCheck() {
  title('自检');
  return doFullCheck();
}

async function cmdDiff() {
  title('待提交改动');
  return doDiff();
}

async function cmdServe() {
  return doServe();
}

async function cmdStatus() {
  title('当前状态');
  printInfo();

  const f = path.join(projectRoot, '.deploy-changed.txt');
  if (fs.existsSync(f)) {
    const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(2).filter(Boolean);
    if (lines.length) {
      console.log('');
      console.log(dim(`  上一次组装变化了 ${lines.length} 个文件（只显示前 10 个）：`));
      for (const l of lines.slice(0, 10)) note(l);
    }
  }
  return 0;
}

/* ═══════════════════════════════════════════════════
   菜单
   ═══════════════════════════════════════════════════ */

const MENU = [
  ['1', 'full',   '快速部署', '构建 → 自检 → 组装 → 热铁盒 → GitHub'],
  ['2', 'build',  '只构建',   '重新生成 docs.html / docs-md.js / docs-md.css'],
  ['3', 'prep',   '只组装',   '拼出 dist/，不上传'],
  ['4', 'rth',    '传热铁盒', '组装 + 上传（网络抖了自动重试）'],
  ['5', 'gh',     '推 GitHub', '组装 + git push（推的是 dist/ 网页产物）'],
  ['6', 'bakup',  '备份源码', '整个项目源码 → JinSuperKitBakup（与部署互不影响）'],
  ['7', 'check',  '自检',     '渲染 / 结构 / DOM 三套测试'],
  ['8', 'serve',  '本地预览', 'http://127.0.0.1:8788/p/docs.html'],
  ['9', 'diff',   '看改动',   'git 会提交什么（不推）'],
  ['10', 'status', '状态',    '站点 / dist / 密钥 / Deno / Git / 备份'],
];

function drawMenu() {
  title('JinSuper 站点部署');
  console.log(dim('  jinsuper.rth1.xyz  ·  JinSuperOfficial.github.io'));
  console.log('');
  for (const [k, , name, desc] of MENU) {
    console.log(`  ${bold(k)}  ${pad(name, 12)}${dim(desc)}`);
  }
  console.log(`  ${bold('0')}  ${pad('退出', 12)}`);
  console.log('');
}

/* ═══════════════════════════════════════════════════
   TUI（ink）：分步向导 + 底部状态栏
   ---------------------------------------------------
   和纯文本菜单共用同一份「计划」定义（PIPELINES），
   所以两条路跑的东西必然一致，不会各长一套。
   ═══════════════════════════════════════════════════ */

/** 命令行开关 → resolveSteps 的 flags */
function flagsFromArgv() {
  const at = process.argv.indexOf('--port');
  const port = at >= 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : null;
  return {
    noBuild: has('--no-build'),
    noCheck: has('--no-check') || has('--skip-check'),
    noGh: has('--no-gh') || has('--no-github'),
    noRetry: has('--no-retry'),
    noVerify: has('--no-verify'),
    ...(Number.isFinite(port) && port > 0 ? { port } : {}),
  };
}

/** 「看改动」是 push-github 的 --check 模式（管线里定义好了） */
const ADHOC_DIFF = PIPELINES.diff[0];

/** 「备份源码」也不走部署管线（它跟发布无关），TUI 里给它一个独立步骤 */
const ADHOC_BAKUP = { id: 'bakup', label: '备份整个项目源码 → JinSuperKitBakup', script: 'backup-github.mjs' };

/**
 * 某条计划的步骤表：**完整步骤**都在，命令行里被关掉的预先置为 off，
 * 这样进了 TUI 还能把它重新打开（比"看不见"友好）。
 */
function planStepsFor(name) {
  const resolved = new Map(resolveSteps(name, flagsFromArgv()).map((s) => [s.id, s]));
  return (PIPELINES[name] || []).map((s) => ({ ...(resolved.get(s.id) || s), on: resolved.has(s.id) }));
}

/** TUI 的菜单项（顺序与纯文本菜单一致，数字快捷键也一样） */
function tuiPlans() {
  const out = [];
  for (const [, cmd, name, desc] of MENU) {
    if (cmd === 'diff') { out.push({ id: 'diff', name, desc, steps: [ADHOC_DIFF] }); continue; }
    if (cmd === 'bakup') { out.push({ id: 'bakup', name, desc, steps: [ADHOC_BAKUP] }); continue; }
    if (cmd === 'status') { out.push({ id: 'status', name, desc, special: 'status', steps: [] }); continue; }
    out.push({ id: cmd, name, desc, steps: planStepsFor(cmd) });
  }
  return out;
}

/** 现在这个终端适不适合上 TUI */
function canUseTui() {
  if (has('--plain')) return false;
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false;
  if (COLOR === false && has('--no-color')) return false;   /* 明确要无色输出 → 走纯文本 */
  const cols = process.stdout.columns || 0;
  if (cols && cols < 72) return false;                       /* 太窄，界面会糊成一团 */
  return true;
}

/**
 * 起 TUI。返回 true 表示「TUI 跑完了」，false 表示进不去（缺依赖等），
 * 调用方会回落到纯文本菜单 —— 部署通道绝不能因为界面而不可用。
 */
async function tryTui(initialId) {
  let runTui;
  try {
    ({ runTui } = await import('./tui/app.mjs'));
  } catch (e) {
    note('ink 没装好（' + ((e && e.message) || e) + '）');
    note('装一下就有 TUI：cd build && npm install');
    return false;
  }
  try {
    await runTui({
      plans: tuiPlans(),
      getSiteInfo: () => {
        const i = siteInfo();
        return {
          ...i,
          siteName: path.basename(siteRoot),
          changed: (() => {
            const f = path.join(projectRoot, '.deploy-changed.txt');
            if (!fs.existsSync(f)) return [];
            return fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(2).filter(Boolean);
          })(),
        };
      },
      logDir: path.join(projectRoot, '.deploy-logs'),
      projectRoot,
      initialId: initialId && MENU.some((m) => m[1] === initialId) ? initialId : null,    });
    return true;
  } catch (e) {
    note('TUI 起不来：' + ((e && e.message) || e));
    return false;
  }
}

async function menu() {
  for (;;) {
    drawMenu();
    const raw = await ask('  请选择 ' + dim('[1]') + ' > ');
    /* stdin 没了就别转了，否则空转刷屏 */
    if (raw === null) { console.log(''); warn('输入结束了，退出菜单'); break; }

    const pick = raw === '' ? '1' : raw;           /* 直接回车 = 快速部署 */
    if (pick === '0' || /^(q|quit|exit)$/i.test(pick)) break;

    const hit = MENU.find((m) => m[0] === pick) || MENU.find((m) => m[1] === pick);
    if (!hit) { warn(`没有「${pick}」这个选项`); continue; }

    await COMMANDS[hit[1]].run();
    console.log('');
    await ask(dim('  按回车回到菜单…'));
  }
}

/* ═══════════════════════════════════════════════════
   命令表 / 帮助
   ═══════════════════════════════════════════════════ */

const COMMANDS = {
  full:   { desc: '构建 → 自检 → 组装 → 热铁盒 → GitHub', run: cmdFull },
  build:  { desc: '只构建产物', run: cmdBuild },
  prep:   { desc: '只组装 dist/', run: cmdPrep },
  rth:    { desc: '组装 + 传热铁盒', run: cmdRth },
  gh:     { desc: '组装 + 推 GitHub Pages', run: cmdGh },
  check:  { desc: '跑三套自检', run: cmdCheck },
  diff:   { desc: '看会提交什么（不推）', run: cmdDiff },
  serve:  { desc: '本地预览', run: cmdServe },
  status: { desc: '看当前状态', run: cmdStatus },
};

/* 备份源码是独立功能，刻意不放进上面的表：
   这张表决定 `--help` 里的命令清单（也是测试钉住的契约），
   而且「部署包括什么」不该因为多了一个备份功能而变化。 */
const COMMANDS_EXTRA = {
  bakup: { desc: '备份整个项目源码到 JinSuperKitBakup', run: cmdBakup },
};
const ALL_COMMANDS = { ...COMMANDS, ...COMMANDS_EXTRA };

const ALIAS = {
  f: 'full', deploy: 'full',
  b: 'build', p: 'prep', r: 'rth',
  g: 'gh', push: 'gh',
  c: 'check', test: 'check',
  d: 'diff', diff: 'diff',
  s: 'serve', st: 'status',
  backup: 'bakup', bak: 'bakup', bk: 'bakup',
};

const OPTIONS = [
  ['-y, --yes', '不确认，直接干'],
  ['--no-build', 'full 时跳过重新构建（只改了 .md 就用它，快很多）'],
  ['--no-check', 'full 时跳过自检'],
  ['--no-gh', '只发热铁盒，不推 GitHub'],
  ['--no-retry', '热铁盒失败不自动重试'],
  ['--no-verify', '跳过上传后的域名可达性检查'],
  ['--port N', 'serve 用哪个端口（默认 8788，被占会自动往后找）'],
  ['--tui', '强制进交互界面（TUI），可带命令：--tui full'],
  ['--plain', '不进 TUI，用原来的纯文本菜单/输出'],
  ['--no-color', '关掉颜色（设 NO_COLOR 环境变量也行）'],
];

function usage() {
  console.log('');
  console.log(bold('  用法：部署.cmd [命令] [选项]'));
  console.log(dim('  不写命令就进交互菜单。'));
  console.log('');
  console.log(bold('  命令'));
  for (const [name, c] of Object.entries(COMMANDS)) {
    console.log(`    ${pad(name, 10)}${dim(c.desc)}`);
  }
  console.log('');
  console.log(bold('  选项'));
  for (const [o, d] of OPTIONS) console.log(`    ${pad(o, 14)}${dim(d)}`);
  console.log('');
  console.log(bold('  例子'));
  const eg = [
    ['部署.cmd', '进交互界面（TUI）'],
    ['部署.cmd full -y', '一条龙，不确认（纯文本输出）'],
    ['部署.cmd full --no-build', '没改渲染器，跳过构建'],
    ['部署.cmd rth', '只发热铁盒'],
    ['部署.cmd check', '部署前先自检'],
    ['部署.cmd --plain', '强制用原来的纯文本菜单'],
  ];
  for (const [a, d] of eg) console.log(`    ${pad(a, 28)}${dim(d)}`);
  console.log('');
  console.log(bold('  另一个功能：备份源码'));
  console.log(dim('    把整个项目源码（按 .gitignore 排除 node_modules / dist / .env 等）'));
  console.log(dim('    推到 ' + 'https://github.com/JinSuperOfficial/JinSuperKitBakup.git'));
  console.log(dim('    和上面的部署互不影响，也不在 full 里。'));
  for (const [a, d] of [
    ['部署.cmd bakup', '备份源码并推送'],
    ['部署.cmd bakup --check', '只看会备份什么（不提交、不推）'],
    ['部署.cmd bakup -m "说明"', '自定义提交信息'],
  ]) console.log(`    ${pad(a, 30)}${dim(d)}`);
  console.log('');
}

/* ═══════════════════════════════════════════════════
   入口
   ═══════════════════════════════════════════════════ */

async function main() {
  const argv = process.argv.slice(2);

  /* 帮助要在识别命令之前判：`--help` 以 - 开头，
     会被下面的「非选项参数」规则漏掉，结果跑进交互菜单。 */
  if (argv.some((a) => a === '--help' || a === '-h' || a === '-?' || a === '/?')) {
    usage();
    return 0;
  }

  /* 其余选项中，第一个不以 - 开头的才是命令 */
  const first = argv.find((a) => !a.startsWith('-'));

  if (first && first !== 'help' && first !== '?') {
    const name = ALIAS[first] || first;
    if (!ALL_COMMANDS[name]) {
      fail(`没有「${first}」这个命令`);
      usage();
      return 1;
    }
  }

  /* TUI：无子命令 + 真终端 → 默认进；`--tui [命令]` 强制进；`--plain` 禁用。
     进不去（没装 ink / 终端太窄 / 明确要无色）就回落到原来的纯文本菜单。 */
  const wantTui = has('--tui') || !first;
  if (wantTui && canUseTui()) {
    const id = first && first !== 'help' && first !== '?' ? (ALIAS[first] || first) : null;
    if (await tryTui(id)) return 0;
  }

  if (first) {
    if (first === 'help' || first === '?') {
      usage();
      return 0;
    }
    return await ALL_COMMANDS[ALIAS[first] || first].run();
  }

  /* 交互模式：菜单里某一步失败不该关掉窗口，回到菜单就好 */
  await menu();
  console.log('');
  /* 双击进来的时候，等一下再关，好让人看清最后几行 */
  await ask(dim('  按回车键关闭窗口…'));
  return 0;
}

/* 跑子进程的时候不插手 Ctrl+C（同一个控制台，子进程自己也会收到），
   否则 serve 会被杀一半。 */
process.on('SIGINT', () => {
  if (inChild) return;
  closeInput();
  console.log('\n');
  console.log(dim('  已中断。'));
  process.exit(130);
});

try {
  process.exitCode = await main();
} catch (e) {
  console.error('\n' + red('  出错了：') + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  closeInput();
}
