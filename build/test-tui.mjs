/**
 * ink TUI 的冒烟测试
 * ---------------------------------------------------
 * 没有真终端也得能验：ink 允许把 stdout/stdin 换成自己的流，
 * 于是这里用两个假流把界面跑起来，按键就写到假 stdin 上。
 *
 * 验的是「界面能不能跑、按了键会不会坏、屏幕上有没有该有的字」——
 * 真终端里的观感还是得人看一眼（见项目文档的验收清单）。
 *
 * 跑法：node --test build/test-tui.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { TuiApp } from './tui/app.mjs';
import { PIPELINES } from './lib/pipeline.mjs';

/** 假 stdout：ink 只用到 write / columns / rows / isTTY / on('resize') */
class FakeStdout extends EventEmitter {
  constructor(cols = 100, rows = 30) {
    super();
    this.columns = cols;
    this.rows = rows;
    this.isTTY = true;
    this.frames = [];
  }
  write(s) { this.frames.push(String(s)); return true; }
  get text() { return this.frames.join(''); }
}

/** 假 stdin：ink v7 用 `on('readable')` + `read()` 收输入，所以得按这个契约实现 */
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.rawMode = false;
    this.queue = [];
  }
  setEncoding() {}
  setRawMode(v) { this.rawMode = !!v; }
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read() { return this.queue.length ? this.queue.shift() : null; }
  /** 模拟按下一个键 */
  press(s) { this.queue.push(s); this.emit('readable'); }
}

const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-log-'));

const PLANS = [
  { id: 'full', name: '快速部署', desc: '构建 → 自检 → 组装 → 热铁盒 → GitHub', steps: PIPELINES.full.map((s) => ({ ...s, on: true })) },
  { id: 'prep', name: '只组装', desc: '拼出 dist/，不上传', steps: PIPELINES.prep.map((s) => ({ ...s, on: true })) },
  { id: 'diff', name: '看改动', desc: 'git 会提交什么（不推）', steps: [{ id: 'diff', label: '看会提交什么（不推）', script: 'push-github.mjs', args: ['--check'], on: true }] },
  {
    id: 'bakup',
    name: '备份源码',
    desc: '整个项目源码 → JinSuperKitBakup',
    steps: [{ id: 'bakup', label: '备份整个项目源码 → JinSuperKitBakup', script: 'backup-github.mjs', on: true }],
    formFields: [
      { key: 'tag', label: '版本 tag', def: 'v1.0.0' },
      { key: 'tagMessage', label: 'tag 说明', def: '' },
    ],
  },
  { id: 'status', name: '状态', desc: '站点 / dist / 密钥 / Deno / Git', special: 'status', steps: [] },
];

const SITE_INFO = {
  siteName: 'jinsuper.rth1.xyz',
  siteFiles: 716,
  sites: [{ site: 'jinsuper', domains: ['jinsuper.rth1.xyz'] }, { site: 'jinsuper.cn', domains: ['www.jinsuper.cn'] }],
  distFiles: 717,
  key: '3aef…47ca',
  deno: { ok: true, where: '项目内 node_modules/.bin/deno.cmd' },
  branch: 'main',
  dirty: 0,
  ahead: 0,
  last: '更新站点内容 · 2026-10-03 04:44',
  changed: ['p/docs.html', 'sk.json'],
};

function mount(opts = {}) {
  const stdout = new FakeStdout(opts.cols || 100, opts.rows || 30);
  const stdin = new FakeStdin();
  const inst = render(React.createElement(TuiApp, {
    plans: PLANS,
    getSiteInfo: () => SITE_INFO,
    logDir: tmpLogDir,
    projectRoot: process.cwd(),
    initialId: opts.initialId || null,
    runner: opts.runner || null,
    planArgsOf: opts.planArgsOf || null,
  }), { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  return { stdout, stdin, inst };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** 最后一帧的文本：ink 是一帧帧重绘的，用累积文本判断「现在屏幕上有什么」会误判 */
function lastFrame(stdout) {
  const t = stdout.text;
  const i = t.lastIndexOf('\u001b[?2026h');
  return i >= 0 ? t.slice(i) : t;
}

/* ink 7 的渲染是批处理的：固定 sleep 会偶发赶不上，改成等到内容真的出现 */
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await tick(30);
  }
}

test('菜单能渲染出来，包含所有计划与站点信息', async () => {
  const { stdout, inst } = mount();
  await tick();
  const t = stdout.text;
  assert.match(t, /JinSuper 站点部署/);
  assert.match(t, /快速部署/);
  assert.match(t, /只组装/);
  assert.match(t, /看改动/);
  assert.match(t, /状态/);
  assert.match(t, /↑↓ 或数字选择/);
  inst.unmount();
});

test('数字键直接进入那条计划的确认页（保留旧菜单的手感）', async () => {
  const { stdout, stdin, inst } = mount();
  await tick();
  stdin.press('2');
  await tick();
  const t = stdout.text;
  assert.match(t, /计划：只组装/);
  assert.match(t, /\[x\] 组装 dist\//);
  assert.match(t, /空格 开关/);
  inst.unmount();
});

test('计划页可以用空格关掉某一步，状态栏跟着变', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'prep' });
  await tick();
  assert.match(stdout.text, /\[x\] 组装 dist\//);
  stdin.press(' ');
  await tick();
  assert.match(stdout.text, /\[ \] 组装 dist\//);
  inst.unmount();
});

test('状态页显示站点/dist/密钥/Deno/Git', async () => {
  const { stdout, inst } = mount({ initialId: 'status' });
  await waitFor(() => /个文件/.test(stdout.text));
  const t = stdout.text;
  assert.match(t, /当前状态/);
  /* 文件数从假数据推导：站点增删文件不该把这条测试搞红 */
  assert.match(t, new RegExp('jinsuper\\.rth1\\.xyz · ' + SITE_INFO.siteFiles + ' 个文件'));
  assert.match(t, new RegExp('dist/\\s+' + SITE_INFO.distFiles + ' 个文件'));
  assert.match(t, /RTH_API_KEY=3aef…47ca/);
  assert.match(t, /项目内 node_modules\/\.bin\/deno\.cmd/);
  assert.match(t, /main · 无待提交改动/);
  inst.unmount();
});

test('窄终端（72 列）也不炸', async () => {
  const { stdout, inst } = mount({ cols: 72, rows: 20 });
  await tick();
  assert.match(stdout.text, /JinSuper 站点部署/);
  inst.unmount();
});

test('Ctrl+C 在菜单上直接退出（不留下挂住的等待）', async () => {
  const { stdin, inst } = mount();
  await tick();
  stdin.press('\u0003');
  const code = await Promise.race([
    inst.waitUntilExit().then(() => 'exited'),
    new Promise((r) => setTimeout(() => r('timeout'), 1500)),
  ]);
  assert.equal(code, 'exited');
});

test('Esc 从确认页回到菜单', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'prep' });
  await tick();
  assert.match(stdout.text, /计划：只组装/);
  stdin.press('\u001b');
  await tick();
  assert.match(stdout.text, /JinSuper 站点部署/);
  inst.unmount();
});

test('计划里所有步骤都关掉时按 Enter 不会起管线（不会误部署）', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'prep' });
  await tick();
  stdin.press(' ');            /* 关掉唯一一步 */
  await tick();
  stdin.press('\r');           /* 确认 */
  await tick(200);
  assert.match(stdout.text, /计划：只组装/, '还应该停在确认页');
  assert.doesNotMatch(stdout.text, /正在执行/);
  inst.unmount();
});

test('确认后进入执行页并落到结果页（用注入的假 runner，不碰真部署）', async () => {
  let called = null;
  const runner = async (steps, opts) => {
    called = { ids: steps.map((s) => s.id), logFile: opts.logFile };
    opts.onEvent({ ev: 'start', steps: steps.map((s) => ({ id: s.id, label: s.label })) });
    opts.onEvent({ ev: 'step', id: steps[0].id, state: 'start' });
    opts.onEvent({ ev: 'log', id: steps[0].id, line: '组装部署产物 → dist/', stream: 'out' });
    opts.onEvent({ ev: 'step', id: steps[0].id, state: 'ok', ms: 1200, code: 0 });
    return { ok: true, ms: 1300, steps: [{ id: steps[0].id, label: steps[0].label, state: 'ok', ms: 1200 }], domains: ['www.jinsuper.cn'], changed: ['p/docs.html'] };
  };

  const { stdout, stdin, inst } = mount({ initialId: 'prep', runner });
  await tick();
  stdin.press('\r');            /* 确认开跑 */
  await tick(150);
  assert.match(stdout.text, /正在执行/);
  assert.match(stdout.text, /组装 dist\//);
  assert.match(stdout.text, /组装部署产物 → dist\//, '子进程输出要出现在日志面板里');

  await tick(150);
  assert.match(stdout.text, /全部完成/);
  assert.match(stdout.text, /https:\/\/www\.jinsuper\.cn/);
  assert.match(stdout.text, /变化 1 个文件|p\/docs\.html/);
  assert.deepEqual(called.ids, ['prep']);
  assert.ok(called.logFile && called.logFile.endsWith('.log'), '每次运行都要留一份完整日志');

  /* 结果页按 r 能再跑一次 */
  stdin.press('r');
  await tick(120);
  assert.match(stdout.text, /正在执行|全部完成/);
  inst.unmount();
});

test('执行中按 Ctrl+C 会中止（runner 收到 abort 信号）', async () => {
  let sawAbort = false;
  const runner = async (steps, opts) => {
    opts.onEvent({ ev: 'step', id: steps[0].id, state: 'start' });
    await new Promise((resolve) => {
      opts.signal.addEventListener('abort', () => { sawAbort = true; resolve(); }, { once: true });
      setTimeout(resolve, 3000);
    });
    return { ok: false, ms: 10, steps: [{ id: steps[0].id, state: 'stopped' }], domains: [], changed: [] };
  };
  const { stdout, stdin, inst } = mount({ initialId: 'prep', runner });
  await tick();
  stdin.press('\r');
  await tick(120);
  assert.match(stdout.text, /正在执行/);
  stdin.press('\u0003');        /* Ctrl+C */
  await tick(150);
  assert.equal(sawAbort, true, 'Ctrl+C 要把 abort 传给正在跑的管线');
  inst.unmount();
});

/* ═══════════ 备份计划的额外字段（tag 勾选 + 输入） ═══════════ */

test('备份计划的字段显示在步骤下面，并有默认版本号', async () => {
  const { stdout, inst } = mount({ initialId: 'bakup' });
  await tick();
  const t = stdout.text;
  assert.match(t, /计划：备份源码/);
  assert.match(t, /\[x\] 备份整个项目源码/);
  assert.match(t, /版本 tag/);
  assert.match(t, /v1\.0\.0/, '默认值要直接显示出来，省得手输');
  assert.match(t, /Tab\/↓ 进输入框/);
  inst.unmount();
});

test('关掉那一步时提示「选项不生效」，字段跟着藏起来', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'bakup' });
  await tick();
  stdin.press(' ');                  /* 关掉唯一那一步 */
  await tick();
  const frame = lastFrame(stdout);
  assert.match(frame, /\[ \] 备份整个项目源码/);
  assert.match(frame, /关掉后下面的选项不生效/);
  assert.doesNotMatch(frame, /版本 tag/, '步骤关掉后字段不该还留在屏幕上');
  inst.unmount();
});

test('进入输入框编辑 tag 名：退格删字、输入加字', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'bakup' });
  await tick();
  stdin.press('\t');                 /* 进输入框 */
  await tick();
  assert.match(stdout.text, /输入后 Enter 回到选项/, '进编辑态要有提示');
  stdin.press('\u007f');             /* 退格：v1.0.0 → v1.0. */
  await tick();
  assert.match(stdout.text, /v1\.0\.(?!0)/);
  stdin.press('7');                  /* → v1.0.7 */
  await tick();
  assert.match(stdout.text, /v1\.0\.7/);
  stdin.press('\r');                 /* 退出编辑 */
  await tick();
  assert.match(stdout.text, /Tab\/↓ 进输入框/);
  inst.unmount();
});

test('tag 名清空后按 Enter 拦住（不静默丢字段），补回来才能跑', async () => {
  const { stdout, stdin, inst } = mount({ initialId: 'bakup' });
  await tick();
  stdin.press('\t');
  await tick();
  for (let i = 0; i < 'v1.0.0'.length; i++) { stdin.press('\u007f'); await tick(20); }
  stdin.press('\r');                 /* 退出编辑，此时是空字符串 */
  await tick();
  stdin.press('\r');                 /* 想直接开跑 */
  await tick(120);
  assert.match(stdout.text, /不能为空/, '空 tag 名要拦住并说明怎么跳过');
  assert.doesNotMatch(stdout.text, /正在执行/);
  inst.unmount();
});

test('确认后字段被翻译成命令行参数（planArgsOf），并落到执行页', async () => {
  let called = null;
  const runner = async (steps, opts) => {
    called = { args: steps.map((s) => s.args || []) };
    opts.onEvent({ ev: 'step', id: steps[0].id, state: 'start' });
    opts.onEvent({ ev: 'step', id: steps[0].id, state: 'ok', ms: 800, code: 0 });
    return { ok: true, ms: 900, steps: [{ id: 'bakup', state: 'ok', ms: 800 }], domains: [], changed: [] };
  };
  /* 与 deploy-cli.mjs 里的 planArgsOf 同一套映射 */
  const planArgsOf = (step, form) => {
    if (step.script !== 'backup-github.mjs') return [];
    const tag = String(form.tag || '').trim();
    if (!tag) return [];
    const args = ['--tag', tag];
    const msg = String(form.tagMessage || '').trim();
    if (msg) args.push('--tag-message', msg);
    return args;
  };

  const { stdout, stdin, inst } = mount({ initialId: 'bakup', runner, planArgsOf });
  await tick();
  stdin.press('\t');
  await tick();
  stdin.press('2');                  /* v1.0.02 */
  stdin.press('\r');
  await tick();
  stdin.press('\r');                 /* 开跑 */
  await tick(150);
  assert.deepEqual(called.args, [['--tag', 'v1.0.02']], '字段要变成 --tag <名称>');
  assert.match(stdout.text, /正在执行|全部完成/);
  inst.unmount();
});
