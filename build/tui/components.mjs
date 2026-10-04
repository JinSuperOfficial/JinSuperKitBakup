/**
 * ink 组件（部署 TUI 的零件）
 * ---------------------------------------------------
 * 不用 JSX：这个环境里跑不了任何打包器（project.md §10.6），
 * Node 也不支持 JSX，所以用 htm 把模板字符串接到 React.createElement 上。
 * 效果和 JSX 一样，但零构建步骤。
 *
 * 注意：htm 会把「模板里的多个表达式」变成一个子元素数组，React 对数组
 * 子元素要求 key（否则开发期会刷警告，而 ink 的 patchConsole 会把警告
 * 打进界面里，很难看）。所以下面凡是多表达式的模板，元素都带 key。
 */
import React from 'react';
import htm from 'htm';
import { Box, Text } from 'ink';

export const html = htm.bind(React.createElement);

const MARK = { pending: '·', start: '▶', ok: '✓', fail: '✗', skipped: '－', stopped: '■' };
const COLOR = { pending: 'gray', start: 'cyan', ok: 'green', fail: 'red', skipped: 'gray', stopped: 'yellow' };

export function fmtMs(ms) {
  const s = (Number(ms) || 0) / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export function spin(frame) { return SPIN[frame % SPIN.length]; }

/** 标题行 */
export function Header({ title, sub }) {
  return html`
    <${Box} flexDirection="column" marginBottom=${1}>
      <${Text} key="t" bold>${title}</${Text}>
      ${sub ? html`<${Text} key="s" dimColor>${sub}</${Text}>` : null}
    <//>
  `;
}

/** 主菜单 */
export function Menu({ items, cursor }) {
  return html`
    <${Box} flexDirection="column">
      ${items.map((it, i) => html`
        <${Box} key=${it.id}>
          <${Text} key="n" color=${i === cursor ? 'cyan' : undefined} bold=${i === cursor}>
            ${i === cursor ? '❯ ' : '  '}${String(i + 1)}. ${it.name.padEnd(12, ' ')}
          <//>
          <${Text} key="d" dimColor>${it.desc}</${Text}>
        <//>
      `)}
    <//>
  `;
}

/**
 * 计划页：步骤可以逐条开关（这就是「分步向导」的那一步）。
 * 有的步骤还需要填点东西（比如备份时给提交打 tag），那就跟在它下面显示成
 * 一行可编辑的输入框 —— cursor / formCursor / editing 三个状态由调用方给。
 */
export function PlanList({ plan, cursor, form, formCursor, editing, hint }) {
  const fields = (plan && plan.formFields) || [];
  return html`
    <${Box} flexDirection="column">
      ${plan.steps.map((s, i) => html`
        <${Box} key=${s.id}>
          <${Text} key="l" color=${editing ? undefined : (i === cursor ? 'cyan' : undefined)}>
            ${!editing && i === cursor ? '❯ ' : '  '}${s.on ? '[x]' : '[ ]'} ${s.label}
          <//>
          ${s.soft ? html`<${Text} key="k" dimColor>  （长驻：Ctrl+C 停）</${Text}>` : null}
          ${!s.on && fields.length ? html`<${Text} key="off" dimColor>  （关掉后下面的选项不生效）</${Text}>` : null}
        <//>
      `)}
      ${fields.length && plan.steps[0].on ? html`
        <${Box} key="fields" flexDirection="column" marginTop=${1}>
          ${fields.map((f, i) => {
            const val = form[f.key] || '';
            const active = editing && i === formCursor;
            return html`
              <${Box} key=${f.key}>
                <${Text} key="p" color=${active ? 'cyan' : undefined}>
                  ${active ? '›' : ' '} ${f.label.padEnd(10, ' ')}
                <//>
                <${Text} key="v" color=${active ? 'cyan' : 'blue'}>${val || f.placeholder || ''}</${Text}>
                ${active ? html`<${Text} key="c" color="cyan">_</${Text}>` : null}
              <//>
            `;
          })}
          <${Text} key="h" dimColor>  ${editing ? '输入后 Enter 回到选项 · Esc 取消编辑' : (hint || 'Tab / ↓ 进输入框，Enter 开始')}</${Text}>
        <//>
      ` : null}
    <//>
  `;
}

/** 执行页的步骤列表 */
export function StepList({ steps, frame, busy }) {
  return html`
    <${Box} flexDirection="column">
      ${steps.map((s) => {
        const color = COLOR[s.state] || 'gray';
        const mark = s.state === 'start' && busy ? spin(frame) : (MARK[s.state] || '·');
        return html`
          <${Box} key=${s.id}>
            <${Text} key="m" color=${color}>${mark} <//>
            <${Text} key="l" color=${s.state === 'pending' ? 'gray' : undefined}>${s.label}<//>
            ${s.ms ? html`<${Text} key="t" dimColor>  ${fmtMs(s.ms)}</${Text}>` : null}
            ${s.state === 'fail' && s.error ? html`<${Text} key="e" color="red">  ${s.error}</${Text}>` : null}
          <//>
        `;
      })}
    <//>
  `;
}

/** 日志面板：只渲染尾巴若干行；宽度超了截断（终端不换行才不会把布局顶乱） */
export function LogPane({ lines, rows, cols }) {
  const width = Math.max(20, cols - 4);
  const tail = lines.slice(-rows);
  const pad = Math.max(0, rows - tail.length);
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      ${Array.from({ length: pad }, (_, i) => html`<${Text} key=${'pad' + i}> </${Text}>`)}
      ${tail.map((l, i) => html`
        <${Text} key=${'l' + i} dimColor>${String(l.text).slice(0, width)}</${Text}>
      `)}
    <//>
  `;
}

/** 底部状态栏：常驻，永远告诉你在哪一步、还剩多久、能按什么键 */
export function StatusBar({ planName, steps, elapsedMs, frame, busy, aborting, hints, cols }) {
  const done = steps.filter((s) => ['ok', 'fail', 'skipped', 'stopped'].includes(s.state)).length;
  const cur = steps.find((s) => s.state === 'start');
  const left = busy
    ? `${spin(frame)} ${planName} · ${done}/${steps.length} · ${cur ? cur.label : '准备中'} · ${fmtMs(elapsedMs)}${aborting ? ' · 正在中止…' : ''}`
    : `${planName} · 就绪`;
  return html`
    <${Box} flexDirection="column" marginTop=${1}>
      <${Text} key="r" dimColor>${'─'.repeat(Math.max(10, cols - 2))}</${Text}>
      <${Text} key="l" color=${busy ? 'cyan' : 'gray'}>${left}</${Text}>
      <${Text} key="h" dimColor>${hints}</${Text}>
    <//>
  `;
}

/** 结果页 */
export function Summary({ result }) {
  const failed = (result.steps || []).filter((s) => s.state === 'fail');
  return html`
    <${Box} flexDirection="column">
      <${Text} key="h" bold color=${result.ok ? 'green' : 'red'}>
        ${result.ok ? '✓ 全部完成' : '✗ 有步骤没成功'}
      <//>
      <${Text} key="m" dimColor>总耗时 ${fmtMs(result.ms)}${result.changed && result.changed.length ? ` · 变化 ${result.changed.length} 个文件` : ''}</${Text}>
      ${failed.length ? html`
        <${Box} key="f" flexDirection="column" marginTop=${1}>
          ${failed.map((s) => html`<${Text} key=${s.id} color="red">  ✗ ${s.label}（退出码 ${s.code}）</${Text}>`)}
        <//>
      ` : null}
      ${result.domains && result.domains.length ? html`
        <${Box} key="d" flexDirection="column" marginTop=${1}>
          ${result.domains.map((d) => html`<${Text} key=${d}>  https://${d}</${Text}>`)}
        <//>
      ` : null}
      ${result.changed && result.changed.length ? html`
        <${Box} key="c" flexDirection="column" marginTop=${1}>
          <${Text} key="t" dimColor>这次变化的文件（前 8 个）：</${Text}>
          ${result.changed.slice(0, 8).map((f) => html`<${Text} key=${f} dimColor>  ${f}</${Text}>`)}
        <//>
      ` : null}
    <//>
  `;
}

/** 状态页：站点 / dist / 密钥 / Deno / Git */
export function StatusScreen({ info }) {
  const line = (k, v) => html`
    <${Box} key=${k}>
      <${Text} key="k" dimColor>${String(k).padEnd(10, ' ')}</${Text}>
      <${Text} key="v">${v}</${Text}>
    <//>
  `;
  return html`
    <${Box} flexDirection="column">
      ${line('站点', `${info.siteName} · ${info.siteFiles} 个文件`)}
      ${line('热铁盒', info.sites.length ? info.sites.map((s) => s.site).join('  +  ') : 'rth-sites.json 读不到')}
      ${line('dist/', info.distFiles ? `${info.distFiles} 个文件` : '还没组装（先跑一次「只组装」）')}
      ${line('.env', info.key ? `✓ RTH_API_KEY=${info.key}` : '✗ 缺失，热铁盒传不了')}
      ${line('Deno', `${info.deno.ok ? '✓' : '!'} ${info.deno.where}`)}
      ${line('Git', info.branch ? `${info.branch} · ${info.dirty ? info.dirty + ' 个文件待提交' : '无待提交改动'}` : 'dist/.git 还没建')}
      ${info.last ? line('最近提交', info.last) : null}
      ${info.changed && info.changed.length ? line('上次变更', `${info.changed.length} 个文件（${info.changed.slice(0, 3).join('、')}…）`) : null}
    <//>
  `;
}
