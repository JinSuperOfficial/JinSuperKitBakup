/**
 * 管线子进程前端（给发布控制台用）
 * ---------------------------------------------------
 * 控制台不能直接把 build/ 的模块 import 进自己的进程跑部署：
 * 部署要几十秒、还要能中止、要能在控制台重启后仍然活着。
 * 所以它是一个**子进程**，进度用 JSON Lines 吐在 stdout 上：
 *
 *   {"ev":"start","steps":[{"id":"build","label":"构建"}]}
 *   {"ev":"step","id":"build","state":"start"}
 *   {"ev":"log","id":"build","line":"…子进程输出一行…"}
 *   {"ev":"step","id":"build","state":"ok","ms":2312,"code":0}
 *   {"ev":"done","ok":true,"ms":41900,"domains":["www.jinsuper.cn"]}
 *
 * 用法：
 *   node build/run-pipeline.mjs --steps=full --json
 *   node build/run-pipeline.mjs --steps=build,prep --json --no-check
 *   node build/run-pipeline.mjs --steps=full            （人看的输出）
 *
 * 退出码：0 全部成功；1 有步骤失败。
 */
import { PIPELINES, JOB_FLAGS, runPipeline } from './lib/pipeline.mjs';

const argv = process.argv.slice(2);

/** 支持 --name value 和 --name=value 两种写法（控制台用的是后者） */
function argOf(name, dflt = null) {
  const eq = argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}
const has = (f) => argv.includes(f);

const JSON_MODE = has('--json');
const SPEC = argOf('--steps', null);
const CONTINUE = has('--continue-on-error');

if (has('--help') || has('-h')) {
  console.log(`
  用法：node build/run-pipeline.mjs --steps=<管线> [选项]

  管线    ${Object.keys(PIPELINES).join(' / ')}
         也可以用逗号挑单个步骤：--steps=build,prep,gh
  选项    --json                  进度用 JSON Lines 输出（控制台用）
          --continue-on-error     出错继续跑后面的步骤
          --no-build / --no-check / --no-gh / --no-retry / --no-verify / --port N
`);
  process.exit(0);
}

/* --steps 可以是管线名，也可以是逗号分隔的步骤 id。
   刻意**不给默认值** —— 这个工具背后是"传站点 + 推 GitHub"，
   少写一个参数就发一次线上，代价太大。 */
if (!SPEC) {
  console.error('\n  必须显式指定 --steps=<管线>（可用：' + Object.keys(PIPELINES).join(' / ') + '）\n');
  process.exit(2);
}
let pipeline;
const wanted = SPEC.split(',').map((s) => s.trim()).filter(Boolean);
if (wanted.length === 1 && PIPELINES[wanted[0]]) {
  pipeline = wanted[0];
} else {
  const all = new Map();
  for (const list of Object.values(PIPELINES)) for (const s of list) all.set(s.id, s);
  const missing = wanted.filter((id) => !all.has(id));
  if (missing.length) {
    console.error(`\n  没有这些步骤：${missing.join('、')}\n  可用：${[...all.keys()].join('、')}\n`);
    process.exit(1);
  }
  pipeline = wanted.map((id) => all.get(id));
}

const flags = {};
for (const f of JOB_FLAGS) if (has('--' + f.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))) flags[f] = true;
const port = argOf('--port', null);
if (port) flags.port = Number(port);

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

let failedStep = null;

const onEvent = JSON_MODE
  ? (ev) => {
      if (ev.ev === 'step' && ev.state === 'fail') failedStep = ev.id;
      write(ev);
    }
  : (ev) => {
      if (ev.ev === 'start') {
        console.log('\n▶ 管线步骤：' + ev.steps.map((s) => s.label).join(' → '));
      } else if (ev.ev === 'log') {
        console.log(ev.line);
      } else if (ev.ev === 'step' && ev.state === 'start') {
        console.log('\n▶ ' + ev.id);
      } else if (ev.ev === 'step' && ev.state !== 'start') {
        const mark = ev.state === 'ok' ? '✓' : ev.state === 'skipped' ? '·' : '✗';
        console.log(`  ${mark} ${ev.id} · ${((ev.ms || 0) / 1000).toFixed(1)}s`);
      } else if (ev.ev === 'done') {
        console.log('');
        console.log(ev.ok ? '  全部完成' : '  有步骤失败');
        for (const d of ev.domains || []) console.log('    https://' + d);
        if (ev.changed && ev.changed.length) console.log(`    变化 ${ev.changed.length} 个文件`);
      }
    };

/* Ctrl+C：交给 runPipeline 的 signal 处理（转给正在跑的子进程），
   这样日志能收尾，而不是整个进程被砍掉。 */
const ac = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => ac.abort());
}

try {
  const r = await runPipeline(pipeline, {
    mode: 'pipe',
    flags,
    onEvent,
    continueOnError: CONTINUE,
    signal: ac.signal,
  });
  process.exitCode = r.ok ? 0 : 1;
} catch (e) {
  if (JSON_MODE) write({ ev: 'error', message: String((e && e.message) || e) });
  else console.error('\n  出错了：' + ((e && e.stack) || e));
  process.exitCode = 1;
}
