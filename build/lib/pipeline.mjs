/**
 * 部署管线（唯一来源）
 * ---------------------------------------------------
 * “一次部署 = 哪些脚本、什么顺序、什么参数”只在这里定义一次，
 * 三个前端都从这儿取：
 *   · build/deploy-cli.mjs    命令行（inherit 模式，输出和以前一模一样）
 *   · build/tui/app.mjs       ink TUI（pipe 模式，实时日志）
 *   · build/run-pipeline.mjs  子进程 JSON Lines（发布控制台用）
 *
 * 每个步骤仍然是**原来那个脚本**（build.mjs / prep-deploy.mjs / deploy.mjs …），
 * 这里只负责编排，不重新实现任何构建或上传逻辑。
 *
 * 步骤 id 就是稳定契约：控制台/测试都按 id 认步骤，别随便改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDir } from '../paths.mjs';
import { runStepInherit, runStepPiped, withArgs } from './proc.mjs';
import { readChangedFile } from './deploy-files.mjs';

const projectRoot = path.resolve(buildDir, '..');

const S = (id, label, script, args = [], extra = {}) => ({ id, label, script, args, ...extra });

/* ── 单步 ── */
const STEP = {
  build: S('build', '构建（docs.html / docs-md.js / docs-md.css / 字体）', 'build.mjs'),

  checkManifests: S('check-manifests', '自检 · 清单与生成物', 'verify-manifests.mjs'),
  checkManifestRender: S('check-manifest-render', '自检 · 卡片渲染', 'test-manifest.mjs'),
  checkFunction: S('check-function', '自检 · Plot 图像计算器', 'test-function.mjs'),
  checkRender: S('check-render', '自检 · 渲染语法', 'test-render.mjs'),
  checkArtifacts: S('check-artifacts', '自检 · 产物结构', 'verify.mjs'),
  checkDom: S('check-dom', '自检 · DOM 行为（较慢）', 'test-dom.mjs'),

  prep: S('prep', '组装 dist/', 'prep-deploy.mjs'),
  rth: S('rth', '传热铁盒（rth-sites.json 里的每个站点）', 'deploy.mjs', ['--no-github']),
  gh: S('gh', '推 GitHub Pages', 'push-github.mjs'),
  diff: S('diff', '看会提交什么（不推）', 'push-github.mjs', ['--check']),
  serve: S('serve', '本地预览', '.serve.mjs', [], { soft: true }),
};

/** 快速自检（一两秒那几套） */
export const QUICK_CHECK = [STEP.checkManifests, STEP.checkManifestRender, STEP.checkFunction, STEP.checkRender, STEP.checkArtifacts];

/** 管线定义：值是步骤数组 */
export const PIPELINES = {
  build: [STEP.build],
  quickCheck: QUICK_CHECK,
  check: [...QUICK_CHECK, STEP.checkDom],
  prep: [STEP.prep],
  rth: [STEP.rth],
  gh: [STEP.gh],
  diff: [STEP.diff],
  serve: [STEP.serve],
  full: [STEP.build, ...QUICK_CHECK, STEP.prep, STEP.rth, STEP.gh],
};

/** 控制台作业允许的管线（白名单，前端不能自由指定脚本） */
export const JOB_PIPELINES = ['full', 'build', 'quickCheck', 'check', 'prep', 'rth', 'gh', 'diff'];

/** 允许的开关（--no-build 这类），前端只能传这些 */
export const JOB_FLAGS = ['noBuild', 'noCheck', 'noGh', 'noRetry', 'noVerify'];

/**
 * 解析出这次要跑的步骤。
 * @param {string} name 管线名（PIPELINES 的键）
 * @param {{noBuild?:boolean,noCheck?:boolean,noGh?:boolean,noRetry?:boolean,noVerify?:boolean,port?:number}} flags
 */
export function resolveSteps(name, flags = {}) {
  const base = PIPELINES[name];
  if (!base) throw new Error('没有这个管线：' + name);

  let steps = base.slice();
  if (flags.noBuild) steps = steps.filter((s) => s.id !== 'build');
  if (flags.noCheck) steps = steps.filter((s) => !s.id.startsWith('check-'));
  if (flags.noGh) steps = steps.filter((s) => s.id !== 'gh');
  if (flags.noRetry) steps = steps.map((s) => (s.id === 'rth' ? withArgs(s, ['--no-retry']) : s));
  if (flags.noVerify) steps = steps.map((s) => (s.id === 'rth' ? withArgs(s, ['--no-verify']) : s));
  if (flags.port != null) steps = steps.map((s) => (s.id === 'serve' ? withArgs(s, [String(flags.port)]) : s));
  return steps;
}

/** 汇总结果要用的两份数据 */
export function deploySites() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(projectRoot, 'rth-sites.json'), 'utf8'));
    return (j.sites || [])
      .map((s) => (typeof s === 'string' ? { site: s, domains: [] } : s))
      .filter((s) => s && s.site);
  } catch {
    return [];
  }
}

export function changedFiles(limit = 0) {
  return readChangedFile(projectRoot, limit);
}

/**
 * 跑一条管线。
 *
 * @param {string|string[]} pipeline 管线名，或直接给步骤数组
 * @param {object} o
 * @param {'inherit'|'pipe'} [o.mode]        默认 inherit（命令行）
 * @param {(ev:object)=>void} [o.onEvent]    事件回调（见下）
 * @param {object} [o.flags]                 开关
 * @param {boolean} [o.continueOnError]      出错也继续
 * @param {string} [o.logFile]               pipe 模式下的日志文件
 * @param {AbortSignal} [o.signal]           中止信号
 * @param {(child:any)=>void} [o.onSpawn]
 * @param {(step:Step,opts:object)=>Promise<{code:number,ms:number,mode:string,error?:string}>} [o.runStep]
 *        测试注入用：替换掉真正起子进程的那一步
 *
 * 事件：{ev:'start'} / {ev:'step',id,state:'start'|'ok'|'fail'|'skipped'|'stopped',ms?} /
 *      {ev:'log',id,line,stream} / {ev:'done',ok,ms,steps,domains,changed}
 */
export async function runPipeline(pipeline, o = {}) {
  const steps = Array.isArray(pipeline) ? pipeline : resolveSteps(pipeline, o.flags || {});
  const mode = o.mode || 'inherit';
  const emit = (ev) => { if (o.onEvent) { try { o.onEvent(ev); } catch { /* 回调出错不该影响部署 */ } } };
  const runner = o.runStep
    || (mode === 'pipe'
      ? (step) => runStepPiped(step, {
        buildDirAbs: buildDir, cwd: projectRoot, logFile: o.logFile,
        onLine: (line, stream) => emit({ ev: 'log', id: step.id, line, stream }),
        signal: o.signal, onSpawn: o.onSpawn,
      })
      : (step) => runStepInherit(step, { buildDirAbs: buildDir, cwd: projectRoot }));

  const t0 = Date.now();
  emit({ ev: 'start', steps: steps.map((s) => ({ id: s.id, label: s.label, soft: !!s.soft })) });

  const done = [];
  let failed = false;

  for (const step of steps) {
    if (failed && !o.continueOnError) {
      emit({ ev: 'step', id: step.id, state: 'skipped' });
      done.push({ id: step.id, state: 'skipped' });
      continue;
    }
    emit({ ev: 'step', id: step.id, state: 'start' });
    /* 步骤之间给事件循环一个机会：TUI 要重绘、控制台的日志要 flush */
    await new Promise((r) => setImmediate(r));

    const r = await runner(step, o);
    const code = r && typeof r.code === 'number' ? r.code : 1;
    let state;
    if (code === 0) state = 'ok';
    else if (step.soft) state = 'stopped';
    else { state = 'fail'; failed = true; }

    emit({ ev: 'step', id: step.id, state, ms: r.ms || 0, code, error: r.error || null, mode: r.mode || mode });
    done.push({ id: step.id, label: step.label, state, ms: r.ms || 0, code, error: r.error || null });
  }

  const ok = !failed;
  const sites = deploySites();
  const domains = sites.flatMap((s) => s.domains || []);
  emit({
    ev: 'done',
    ok,
    ms: Date.now() - t0,
    steps: done,
    domains,
    sites: sites.map((s) => s.site),
    changed: changedFiles(),
  });
  return { ok, steps: done, ms: Date.now() - t0, domains };
}
