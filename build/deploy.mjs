/**
 * 一键部署
 * ---------------------------------------------------
 *   1. 组装 dist/（调用 prep-deploy.mjs，增量）
 *   2. 确保有 Deno（本机没有就用 npm 包里的）
 *   3. 把 dist/ 传到**每一个**热铁盒站点
 *   4. 检查各个域名是否真的能访问
 *
 * 跑法：npm run deploy
 *
 * ⚠ 为什么要发好几个站：
 *   热铁盒里 `jinsuper.cn` 是**独立的一个站**，不是 `jinsuper` 的别名
 *   （`cli site list` 能看到 class11 / jinsuper / jinsuper.cn 三个）。
 *   只发 `jinsuper` 的话，自有域名那边永远是空的。
 *   站点清单在项目根的 rth-sites.json，加减站点改那个文件就行。
 *
 * 为什么不用 rth-host.json 里的 build 字段：
 *   CLI 一看到 build 就会先执行 `npm install`，那一步依赖子进程
 *   stdio，在某些受限环境里起不来（实测静默退出）。
 *   组装产物我们自己在本进程里做，更可控。
 *   所以 rth-host.json 只留 site 和 outdir（那是给 CLI 的 watch 用的）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildDir } from './paths.mjs';
import { checkDomains } from './lib/domain-check.mjs';
import { findLocalDeno, systemDeno } from './lib/deno.mjs';

const projectRoot = path.resolve(buildDir, '..');
const CLI = 'https://host.retiehe.com/cli';

const NO_GITHUB = process.argv.includes('--no-github');
const NO_VERIFY = process.argv.includes('--no-verify');
const NO_RETRY = process.argv.includes('--no-retry');
/* --only jinsuper.cn 可以只发某一个站（可重复） */
const ONLY = process.argv.reduce((acc, a, i, arr) => {
  if (a === '--only' && arr[i + 1]) acc.push(arr[i + 1]);
  return acc;
}, []);

function log(...a) { console.log(' ', ...a); }
function ok(...a) { console.log('  ✓', ...a); }
function warn(...a) { console.log('  !', ...a); }
function bad(...a) { console.log('  ✗', ...a); }

/* ── 读站点清单 ── */
function readSites() {
  const f = path.join(projectRoot, 'rth-sites.json');
  if (!fs.existsSync(f)) {
    console.error('\n找不到 rth-sites.json —— 里面写着要发到哪几个热铁盒站点。');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.error(`\nrth-sites.json 不是合法 JSON：${e.message}`);
    process.exit(1);
  }
  const list = Array.isArray(parsed.sites) ? parsed.sites : [];
  const sites = list
    .map((s) => (typeof s === 'string' ? { site: s, domains: [] } : s))
    .filter((s) => s && s.site);

  if (!sites.length) {
    console.error('\nrth-sites.json 里没有配任何站点（sites 是空的）。');
    process.exit(1);
  }
  return ONLY.length ? sites.filter((s) => ONLY.includes(s.site)) : sites;
}

/* ── 1. 组装 dist/ ── */
console.log('\n[1/4] 组装 dist/');
const prep = spawnSync(process.execPath, [path.join(buildDir, 'prep-deploy.mjs')], {
  stdio: 'inherit',
  cwd: projectRoot,
});
if (prep.status !== 0) {
  console.error('\n组装失败，已中止部署。');
  process.exit(1);
}

/* ── 2. 找 Deno ── */
console.log('\n[2/4] 准备 Deno');

/* 系统 PATH 上的优先（用户自己装的，版本自己管） */
let denoCmd = systemDeno();

if (!denoCmd) {
  /* 其次看项目里装过没有 —— 按本平台找，别把 Windows 的 deno.cmd 当成可执行文件 */
  denoCmd = findLocalDeno(projectRoot, [buildDir]);

  if (denoCmd) {
    log(`用项目内的 Deno：${path.relative(projectRoot, denoCmd)}`);
  } else {
    log('本机没有 Deno，正在用 npm 装一个（只装在项目里，不动系统）...');
    const inst = spawnSync('npm', ['install', 'deno', '--no-save', '--ignore-scripts'], {
      stdio: 'inherit',
      cwd: projectRoot,
      shell: true,
    });
    if (inst.status !== 0) {
      console.error('\nDeno 安装失败。可以手动装：https://deno.com/');
      process.exit(1);
    }
    /* 装完按本平台再找一次：本平台那份在 node_modules/@deno/ 下，
       Windows 上则是 .bin/deno.cmd —— 交给 findLocalDeno 判断 */
    denoCmd = findLocalDeno(projectRoot, [buildDir]);
    if (!denoCmd) {
      console.error('\n装完了还是找不到 deno 可执行文件：看 node_modules/@deno/ 里有没有本平台那一份。');
      process.exit(1);
    }
  }
} else {
  log(`用系统 Deno：${denoCmd}`);
}

/* ── 3. 逐个站点上传 ── */
const envFile = path.join(projectRoot, '.env');
if (!fs.existsSync(envFile)) {
  console.error('\n找不到 .env（里面要放 RTH_API_KEY）。');
  process.exit(1);
}

const sites = readSites();
console.log(`\n[3/4] 上传（${sites.length} 个站点：${sites.map((s) => s.site).join('、')}）`);

const isWin = process.platform === 'win32';

/* UNC 当前目录（\\wsl.localhost\... 这种）：cmd.exe 起不来，它会直接放弃 cwd、
   退到 C:\Windows，于是相对路径的 .env / dist 全找不到（报 `node: .env: not found`）。
   原生 exe 没这个毛病 —— CreateProcess 允许 UNC 当当前目录。
   所以：真 exe 直接起，只有 .cmd/.bat 包装才需要 cmd /c。 */
const isBatch = /\.(cmd|bat)$/i.test(denoCmd);
const UNC_CWD = isWin && /^\\\\/.test(projectRoot);

/* 项目在 UNC 路径下（Windows 控制台通过 \\wsl.localhost\... 访问 WSL 里的项目）
   时，起 Deno 这件事有两个坑，报错就得把办法一起说清楚，别让人干瞪眼。 */
function uncHint() {
  console.error(
    '\n项目在 UNC 路径下：\n  ' + projectRoot + '\n' +
    'Windows 的 cmd.exe 不支持把 UNC 当当前目录（会退到 C:\\Windows，\n' +
    '于是相对路径的 .env / dist 全找不到）。三个办法：\n' +
    '  1. 在 Windows 上装个系统 Deno：winget install DenoLand.Deno\n' +
    '     （脚本优先用系统里的 deno.exe，最省事）\n' +
    '  2. 或者让项目里带上 Windows 那份二进制：在 Windows 侧跑一次 npm install deno\n' +
    '     会装进 node_modules/@deno/win32-x64/deno.exe，脚本会直接起它（不经 cmd）\n' +
    '  3. 或者干脆在 WSL/Linux 侧跑 ./部署.sh —— 上传这条路在那边是通的。'
  );
}

if (UNC_CWD && isBatch) {
  console.error('\n找到的 Deno 是不能用的批处理包装：\n  ' + denoCmd);
  uncHint();
  console.error('');
  process.exit(1);
}

/** 把 dist/ 传到一个站点上：true 成功 · false 失败 · 'fatal' 起不来（重试没意义） */
function uploadOnce(site) {
  const args = [
    'run', '--allow-all',
    '--env-file=.env',
    CLI,
    'deploy',
    '--site', site,
  ];

  /* 只有 .cmd/.bat 才需要经 cmd 起（Node 20+ 也不能直接起批处理）；
     真 exe 直接起 —— 这样 UNC 当前目录也能用（cmd.exe 会把它丢掉）。
     用 cmd /c 而不是 shell:true，免得 Node 报 DEP0190（参数转义警告） */
  const [cmd, cmdArgs] = isWin && isBatch ? ['cmd', ['/c', denoCmd, ...args]] : [denoCmd, args];

  const r = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    cwd: projectRoot,
    env: {
      ...process.env,
      /* Deno 默认缓存目录在用户目录下，某些环境里不可写。
         指到项目内更稳，也方便随时清掉。 */
      DENO_DIR: process.env.DENO_DIR || path.join(projectRoot, '.deno-cache'),
    },
  });

  if (r.error) {
    console.error('\n起 Deno 失败：' + r.error.message + '\n  ' + denoCmd);
    if (UNC_CWD) uncHint();
    return 'fatal';
  }
  return r.status === 0;
}

/** 带重试地上传一个站点。上传是幂等的，重跑安全。 */
function uploadSite(site, index) {
  const tries = NO_RETRY ? 1 : 3;
  console.log(`\n──── [${index}/${sites.length}] ${site} ${'─'.repeat(Math.max(0, 40 - site.length))}`);

  for (let n = 1; n <= tries; n++) {
    if (n > 1) {
      console.log('');
      warn(`「${site}」第 ${n}/${tries} 次重试`);
    }
    const r = uploadOnce(site);
    if (r === true) {
      ok(`${site} 上传完成`);
      return true;
    }
    if (r === 'fatal') {
      bad(`${site}：Deno 根本没起来，重试没用，先解决上面那条报错`);
      return false;
    }
    if (n < tries) log('热铁盒偶尔会 error reading a body from connection —— 上面看着像网络类报错再等重试');
  }
  bad(`${site} 传了 ${tries} 次都没成功`);
  return false;
}

const results = sites.map((s, i) => ({ ...s, ok: uploadSite(s.site, i + 1) }));

/* ── 4. 检查域名 ──
   上传成功 ≠ 域名能打开。证书没签、DNS 没生效、域名没绑到站上，
   这几件事 deploy 这一步都不会报错，但用户打开就是打不开。
   所以这里挨个探一下，把问题当场指出来。

   探测逻辑（浏览器 UA、跟随 CDN 302、错误翻译）在
   build/lib/domain-check.mjs 里，控制台的「部署前预检」用的是同一份。 */
if (!NO_VERIFY) {
  const domains = results.filter((r) => r.ok).flatMap((r) => r.domains || []);
  if (domains.length) {
    console.log('\n[4/4] 检查域名');
    let domainBad = 0;
    for (const d of await checkDomains(domains)) {
      if (!d.ok) {
        domainBad++;
        bad(`https://${d.domain}/  →  ${d.reason}`);
      } else if (d.status === 200) {
        ok(`https://${d.domain}/  →  HTTP 200`);
      } else {
        warn(`https://${d.domain}/  →  HTTP ${d.status}`);
      }
    }
    if (domainBad) {
      console.log('');
      warn(`${domainBad} 个域名访问不了。上传是成功的，所以问题在域名/证书那一层：`);
      log('去热铁盒控制台看「域名」设置：确认域名已绑定到这个站，并且证书已签发。');
      log('裸域和 www 通常要分别申请证书。');
    }
  }
} else {
  console.log('\n[4/4] 跳过域名检查（--no-verify）');
}

/* ── 汇总 ── */
const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  bad(`热铁盒：${results.length - failed.length}/${results.length} 个站点成功`);
  for (const f of failed) log(`失败的站：${f.site}`);
} else {
  ok(`热铁盒：${results.length} 个站点全部上传完成`);
  for (const r of results) log(`${r.site}  →  ${(r.domains || []).map((d) => 'https://' + d).join('  ')}`);
}

if (failed.length) {
  /* 有站点没传上去，别接着推 GitHub 假装一切正常 */
  process.exit(1);
}

/* ── 顺手推一份到 GitHub Pages ──
   两个平台共用同一个 dist/，内容因此天然一致。
   推失败**不影响**热铁盒（那边已经成功了），只提示。 */
if (NO_GITHUB) {
  console.log('');
  process.exit(0);
}

console.log('\n接着推送到 GitHub...');
const push = spawnSync(process.execPath, [path.join(buildDir, 'push-github.mjs')], {
  stdio: 'inherit',
  cwd: projectRoot,
  env: process.env,
});

if (push.status !== 0) {
  console.log('\n⚠ GitHub 那一步没成功，但热铁盒已经部署好了。');
  console.log('  单独重试：npm run push\n');
  /* 刻意不以失败退出：主要目标是热铁盒，它已经成功 */
  process.exit(0);
}

console.log('\n全部完成：');
for (const r of results) {
  for (const d of r.domains || []) console.log(`  热铁盒    https://${d}`);
}
console.log('  GitHub    https://jinsuperofficial.github.io/');
console.log('  （GitHub Pages 首次需要在仓库设置里启用，见 build/README.md）\n');
