/**
 * 部署 TUI（ink）
 * ---------------------------------------------------
 * 形态：分步向导 + 底部常驻状态栏。
 *   menu  → 选一件事（保留旧菜单的数字快捷键）
 *   plan  → 看这次要跑哪些步骤，逐条开关（这就是“向导”那一步）
 *   run   → 步骤列表 + 实时日志 + 状态栏（Ctrl+C 中止）
 *   done  → 结果摘要（再跑一次 / 回菜单 / 关窗口）
 *   status→ 站点状态一屏
 *
 * 关键约束：
 *   · 子进程一律走 pipe 模式抓输出（管道不可用时 proc.mjs 自己退到 fd 模式），
 *     永远不把 ink 的终端控制权交给子进程 —— 否则两边抢屏必花。
 *   · 完整日志始终写文件，退出时把路径打出来，TUI 里看不到的部分不会丢。
 *   · Ctrl+C 第一次 = 中止当前步骤，第二次 = 强杀进程树；没在跑就直接退出。
 */
import fs from 'node:fs';
import path from 'node:path';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { runPipeline } from '../lib/pipeline.mjs';
import { killTree } from '../lib/proc.mjs';
import {
  Header, LogPane, Menu, PlanList, StatusBar, StatusScreen, StepList, Summary, fmtMs, html,
} from './components.mjs';

const LOG_TAIL = 240;          /* 内存里保留的日志行数（完整日志在文件里） */

const HINTS = {
  menu: '↑↓ 或数字选择 · Enter 进入 · Esc/q 退出',
  plan: '↑↓ 选步骤 · 空格 开关 · a 全开/全关 · Enter 开始 · Esc 返回',
  run: 'Ctrl+C 中止当前步骤（再按一次强杀）',
  done: 'r 再跑一次 · Enter/Esc 回菜单 · q 退出',
  status: 'Enter/Esc 回菜单 · q 退出',
};

function clampCursor(cur, len) {
  if (!len) return 0;
  return Math.max(0, Math.min(len - 1, cur));
}

function App({ plans, getSiteInfo, logDir, projectRoot, initialId, runner, planArgsOf }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = (stdout && stdout.columns) || 80;
  const rows = (stdout && stdout.rows) || 30;

  /* --tui <命令> 直接落到那条计划的确认页；「状态」是个特殊项，直接上状态页 */
  const initialPlan = initialId ? plans.find((x) => x.id === initialId) : null;
  const initialIsStatus = !!(initialPlan && initialPlan.special === 'status');

  const [screen, setScreen] = useState(initialId && !initialIsStatus ? 'plan' : (initialIsStatus ? 'status' : 'menu'));
  const [cursor, setCursor] = useState(0);
  const [planId, setPlanId] = useState(initialId && !initialIsStatus ? initialId : null);
  const [planSteps, setPlanSteps] = useState(() => (
    initialPlan && !initialIsStatus ? initialPlan.steps.map((s) => ({ ...s, on: true })) : []
  ));
  /* 计划里要填的字段（比如「打 tag」的名称/说明）——空对象表示这条计划不需要填。
     ⚠ 这里必须跟 planSteps 一样把默认值填上：`--tui bakup` 是直接落在计划页的，
     openPlan 不会被调用，初始值只能在这里给。 */
  const [form, setForm] = useState(() => (
    initialPlan && !initialIsStatus
      ? Object.fromEntries((initialPlan.formFields || []).map((f) => [f.key, f.def || '']))
      : {}
  ));
  const [formCursor, setFormCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState(null);
  const [steps, setSteps] = useState([]);
  const [lines, setLines] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [info, setInfo] = useState(null);

  const acRef = useRef(null);
  const childRef = useRef(null);
  const t0Ref = useRef(0);
  const logFileRef = useRef(null);

  const plan = useMemo(() => plans.find((p) => p.id === planId) || null, [plans, planId]);

  /* 一进来就落在「状态」页时，把信息取一次 */
  useEffect(() => {
    if (initialIsStatus && info == null) setInfo(getSiteInfo());
  }, [initialIsStatus, info, getSiteInfo]);

  /* 计时 + spinner：只在跑的时候开 */
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => {
      setFrame((f) => f + 1);
      setElapsed(Date.now() - t0Ref.current);
    }, 160);
    return () => clearInterval(t);
  }, [busy]);

  const backToMenu = useCallback(() => {
    setScreen('menu');
    setCursor(clampCursor(0, plans.length));
    setSteps([]);
    setLines([]);
    setResult(null);
    setAborting(false);
    setElapsed(0);
    setForm({});
    setFormCursor(0);
    setEditing(false);
    setFormError(null);
  }, [plans.length]);

  const startPlan = useCallback(async (stepsToRun, label, formValues = {}) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = String(label || 'pipeline').replace(/[^\w.-]+/g, '_');
    const logFile = path.join(logDir, `${stamp}-${safe}.log`);
    logFileRef.current = logFile;
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(logFile, `# ${label} · ${new Date().toLocaleString()}\n`);

    /* 计划页填的字段 → 追加到对应步骤的命令行参数（比如备份时 --tag v1.0.0）。
       planArgsOf 由 deploy-cli 传进来：TUI 不该知道备份脚本长什么样。 */
    const finalSteps = planArgsOf
      ? stepsToRun.map((s) => ({ ...s, args: [...(s.args || []), ...planArgsOf(s, formValues)] }))
      : stepsToRun;

    const ac = new AbortController();
    acRef.current = ac;
    childRef.current = null;
    t0Ref.current = Date.now();

    setSteps(finalSteps.map((s) => ({ id: s.id, label: s.label, state: 'pending' })));
    setLines([]);
    setResult(null);
    setAborting(false);
    setBusy(true);
    setScreen('run');

    const onEvent = (ev) => {
      if (ev.ev === 'step') {
        setSteps((prev) => prev.map((s) => (s.id === ev.id
          ? { ...s, state: ev.state === 'start' ? 'start' : ev.state, ms: ev.ms, error: ev.error, code: ev.code }
          : s)));
      } else if (ev.ev === 'log') {
        setLines((prev) => {
          const next = prev.concat({ text: ev.line });
          return next.length > LOG_TAIL ? next.slice(next.length - LOG_TAIL) : next;
        });
      }
    };

    let out;
    try {
      out = await (runner || runPipeline)(finalSteps, {
        mode: 'pipe',
        logFile,
        onEvent,
        signal: ac.signal,
        onSpawn: (child) => { childRef.current = child; },
      });
    } catch (e) {
      out = { ok: false, ms: Date.now() - t0Ref.current, steps: [], domains: [], changed: [], error: String((e && e.message) || e) };
    }

    setBusy(false);
    setAborting(false);
    setResult({ ...out, logFile });
    setScreen('done');
  }, [logDir, runner, planArgsOf]);

  /* 键位 */
  useInput((input, key) => {
    /* Ctrl+C：分三档处理，任何时刻都能干净退出 */
    if (key.ctrl && (input === 'c' || input === 'C')) {
      if (busy) {
        if (!aborting) {
          setAborting(true);
          setLines((prev) => prev.concat({ text: '（收到 Ctrl+C，正在中止当前步骤…再按一次强杀）' }));
          if (acRef.current) acRef.current.abort();
        } else if (childRef.current && childRef.current.pid) {
          killTree(childRef.current.pid);
        }
        return;
      }
      exit();
      return;
    }

    if (screen === 'menu') {
      if (key.upArrow) setCursor((c) => clampCursor(c - 1, plans.length));
      else if (key.downArrow) setCursor((c) => clampCursor(c + 1, plans.length));
      else if (input === 'k') setCursor((c) => clampCursor(c - 1, plans.length));
      else if (input === 'j') setCursor((c) => clampCursor(c + 1, plans.length));
      else if (/^[1-9]$/.test(input)) {
        const i = Number(input) - 1;
        if (i < plans.length) { setCursor(i); openPlan(plans[i]); }
      } else if (key.return) openPlan(plans[cursor]);
      else if (input === 'q' || key.escape) exit();
      return;
    }

    if (screen === 'plan') {
      const fields = (plan && plan.formFields) || [];
      const hasFields = fields.length > 0 && planSteps[0] && planSteps[0].on;

      /* 正在填输入框：按键都归它，Enter 收工回选项 */
      if (editing) {
        const key0 = fields[formCursor] && fields[formCursor].key;
        if (key.return) { setEditing(false); setFormError(null); return; }
        if (key.escape) {
          /* Esc = 放弃这一格的改动，退回默认值 */
          setForm((f) => ({ ...f, [key0]: (fields[formCursor] && fields[formCursor].def) || '' }));
          setEditing(false);
          return;
        }
        if (key.backspace || key.delete) {
          setForm((f) => ({ ...f, [key0]: String(f[key0] || '').slice(0, -1) }));
          return;
        }
        /* 只收可见字符，免得方向键、功能键把内容搞乱 */
        if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
          setForm((f) => ({ ...f, [key0]: String(f[key0] || '') + input }));
        }
        return;
      }

      if (key.upArrow) setCursor((c) => clampCursor(c - 1, planSteps.length));
      else if (key.downArrow) {
        /* 最后一项再往下 → 进输入框 */
        if (hasFields && cursor >= planSteps.length - 1) { setEditing(true); setFormCursor(0); setFormError(null); return; }
        setCursor((c) => clampCursor(c + 1, planSteps.length));
      } else if (key.tab && hasFields) { setEditing(true); setFormCursor(0); setFormError(null); return; }
      else if (input === ' ') setPlanSteps((prev) => prev.map((s, i) => (i === cursor ? { ...s, on: !s.on } : s)));
      else if (input === 'a') {
        const allOn = planSteps.every((s) => s.on);
        setPlanSteps((prev) => prev.map((s) => ({ ...s, on: !allOn })));
      } else if (key.return) {
        const picked = planSteps.filter((s) => s.on);
        if (!picked.length) return;
        /* 字段填了东西但对应步骤关着 → 说一声，别默默丢掉 */
        if (fields.length && !hasFields) {
          setFormError('这一步关掉了，填的选项不会生效（先按空格打开它）');
          return;
        }
        const first = fields[0];
        if (hasFields && first && first.required !== false && !String(form[first.key] || '').trim()) {
          setFormError(`${first.label} 不能为空（要跳过就关掉那一步）`);
          return;
        }
        startPlan(picked, plan ? plan.name : 'pipeline', form);
      } else if (key.escape || input === 'q') backToMenu();
      return;
    }

    if (screen === 'run') return;      /* 跑的时候只认 Ctrl+C */

    if (screen === 'done') {
      if (input === 'r') {
        const picked = planSteps.filter((s) => s.on);
        startPlan(picked, plan ? plan.name : 'pipeline');
      } else if (input === 'q') exit();
      else if (key.return || key.escape) backToMenu();
      return;
    }

    if (screen === 'status') {
      if (input === 'q') exit();
      else backToMenu();
    }
  });

  function openPlan(item) {
    if (item.special === 'status') {
      setInfo(getSiteInfo());
      setScreen('status');
      return;
    }
    setPlanId(item.id);
    setPlanSteps(item.steps.map((s) => ({ ...s, on: true })));
    /* 有字段的计划：先填上默认值，光标落在选项上，按 Tab/↓ 才能进输入框 */
    setForm(Object.fromEntries(((item.formFields) || []).map((f) => [f.key, f.def || ''])));
    setFormCursor(0);
    setEditing(false);
    setFormError(null);
    setCursor(0);
    setScreen('plan');
  }

  /* 日志面板能占几行：终端高度减去固定部分，别让 ink 顶出可视区 */
  const chromeRows = 6 + (screen === 'run' ? Math.min(10, steps.length) : 0);
  const logRows = Math.max(3, rows - chromeRows - 4);
  const hints = screen === 'plan' && plan && plan.formFields && plan.formFields.length
    ? '↑↓ 选步骤 · 空格 开关 · Tab/↓ 进输入框 · Enter 开始 · Esc 返回'
    : (HINTS[screen] || '');

  return html`
    <${Box} flexDirection="column">
      ${screen === 'menu' ? html`
        <${Box} key="menu" flexDirection="column">
          <${Header} title="JinSuper 站点部署" sub="jinsuper.rth1.xyz  ·  JinSuperOfficial.github.io" />
          <${Menu} items=${plans} cursor=${cursor} />
        <//>
      ` : null}

      ${screen === 'plan' ? html`
        <${Box} key="plan" flexDirection="column">
          <${Header} title=${`计划：${plan ? plan.name : ''}`} sub=${plan ? plan.desc : ''} />
          <${PlanList}
            plan=${{ steps: planSteps, formFields: (plan && plan.formFields) || [] }}
            cursor=${cursor}
            form=${form}
            formCursor=${formCursor}
            editing=${editing}
            hint=${formError ? '⚠ ' + formError : ''}
          />
        <//>
      ` : null}

      ${screen === 'run' ? html`
        <${Box} key="run" flexDirection="column">
          <${Header} title="正在执行" sub=${logFileRef.current ? '完整日志：' + logFileRef.current : ''} />
          <${StepList} steps=${steps} frame=${frame} busy=${busy} />
          <${LogPane} lines=${lines} rows=${logRows} cols=${cols} />
        <//>
      ` : null}

      ${screen === 'done' ? html`
        <${Box} key="done" flexDirection="column">
          <${Header} title="结果" sub=${result && result.logFile ? '完整日志：' + result.logFile : ''} />
          ${result ? html`<${Summary} result=${result} />` : null}
        <//>
      ` : null}

      ${screen === 'status' ? html`
        <${Box} key="status" flexDirection="column">
          <${Header} title="当前状态" sub="只查本地，不联网（所以是秒出）" />
          ${info ? html`<${StatusScreen} info=${info} />` : null}
        <//>
      ` : null}

      <${StatusBar}
        key="bar"
        planName=${screen === 'menu' ? '未选择' : (plan ? plan.name : (screen === 'status' ? '状态' : ''))}
        steps=${screen === 'run' || screen === 'done' ? steps : []}
        elapsedMs=${elapsed}
        frame=${frame}
        busy=${busy}
        aborting=${aborting}
        hints=${hints}
        cols=${cols}
      />
    <//>
  `;
}

/**
 * 起 TUI。返回时终端已经还原（ink 负责）。
 * @param {object} o
 * @param {Array} o.plans       菜单项（由 deploy-cli 组装，含 steps / formFields）
 * @param {() => object} o.getSiteInfo
 * @param {string} o.logDir     日志目录（绝对路径）
 * @param {string} o.projectRoot
 * @param {string} [o.initialId] 直接进入某个计划的确认页（--tui full 用）
 * @param {(step:object, form:object) => string[]} [o.planArgsOf]
 *        计划页填的字段 → 该步骤的额外命令行参数（备份打 tag 就用它）
 */
export async function runTui(o) {
  const instance = render(
    React.createElement(App, {
      plans: o.plans,
      getSiteInfo: o.getSiteInfo,
      logDir: o.logDir,
      projectRoot: o.projectRoot,
      initialId: o.initialId || null,
      planArgsOf: o.planArgsOf || null,
    }),
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
}

/* 测试用：直接把组件树交给调用方（配假 stdout/stdin 就能在没有终端的地方跑） */
export { App as TuiApp };

