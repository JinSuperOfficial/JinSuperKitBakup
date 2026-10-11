/**
 * 作业录入 · 终端入口
 * ---------------------------------------------------
 * 跟网页面板共用**同一份实现**（`lib/hwk.mjs`）：
 * 写 `class/data/hwk/hwk-<id>.json`、把它顶到 `index.json` 最前、
 * 顺手重建 `class/data/index-produce.json`；同一天覆盖前先把旧版本备份出去
 * （备份落在 console/ 的状态目录，不进站点、不会被上传）。
 *
 * 跑法（两条启动器都只是转发参数，所以 Windows 与 Linux 完全一样）：
 *
 *   ./控制台.sh hwk                    问答式录入（一路回车也能用：默认今天）
 *   ./控制台.sh hwk --json             直接粘 JSON 源码，粘完 Ctrl+D（Windows：Ctrl+Z 回车）
 *   ./控制台.sh hwk --json 某份.json    从文件读 JSON（`hwk 某份.json` 也一样）
 *   ./控制台.sh hwk --from-current     以现在显示的那天为底稿改
 *   ./控制台.sh hwk --list             看现在有哪几天
 *   ./控制台.sh hwk --dry-run          只算不写（看会写出什么、会备份什么）
 *   ./控制台.sh hwk --yes              不再确认（脚本里用）
 *
 * 多行正文怎么输：一科一次输入，**空行结束**；直接回车 = 这科不写
 * （有底稿时直接回车 = 沿用现在这份）。输入的样子逐字写进 JSON，换行照旧 \n。
 */
import fs from 'node:fs';
import readline from 'node:readline';
import * as hwk from './lib/hwk.mjs';

/* ── 极简着色：不是 TTY（被重定向 / 管道）就什么都不加 ── */
const TTY = !!(process.stdout.isTTY && process.env.NO_COLOR === undefined);
const paint = (code, s) => (TTY ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const dim = (s) => paint('2', s);
const bold = (s) => paint('1', s);
const warn = (s) => console.log(paint('33', '  ! ' + s));
const bad = (s) => console.log(paint('31', '  X ' + s));
const ok = (s) => console.log(paint('32', '  ✓ ' + s));
const line = () => console.log('');

/* ═══════════════════════════════════════════════════
   逐行读取（自己排一个队列：EOF 时不挂住，也不堆监听器）
   ═══════════════════════════════════════════════════ */

function createReader() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: !!process.stdin.isTTY,       /* 交互时回显；管道里不回显 */
  });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l); else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  return {
    /** 下一行；EOF 返回 null */
    readLine() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** 问一句：空输入 → 默认值；EOF → 默认值 */
    async ask(question, dflt) {
      process.stdout.write('  ' + question + dim(dflt ? `  [${dflt}]` : '  [回车跳过]') + ' ' + dim('>') + ' ');
      const v = await this.readLine();
      if (v === null) { console.log(''); return dflt || ''; }
      return String(v).trim() === '' ? (dflt || '') : v;
    },
    /** 多行：空行结束；直接回车 → dflt（有底稿时就是「沿用」） */
    async multiline(label, dflt) {
      line();
      console.log('  ' + bold(label) + dim(dflt
        ? '（直接回车 = 沿用现在这份；一行一行输，空行结束）'
        : '（一行一行输，空行结束；直接回车 = 这科不写）'));
      const rows = [];
      for (;;) {
        process.stdout.write(dim('    │ '));
        const row = await this.readLine();
        if (row === null || String(row).trim() === '') { console.log(''); break; }
        rows.push(String(row));
      }
      return rows.length ? rows.join('\n') : (dflt || '');
    },
    close() { try { rl.close(); } catch { /* 已经关了 */ } },
  };
}

/** 从 stdin 读全部内容（粘 JSON 用） */
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/* ═══════════════════════════════════════════════════
   参数
   ═══════════════════════════════════════════════════ */

function parseArgs(argv) {
  const out = { _: [] };
  const FLAGS = ['list', 'dry-run', 'yes', 'help', 'quiet'];
  const OPTIONAL = ['json', 'from-current'];       /* 可以不带值 */
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) { out._.push(a); continue; }
    const name = a.replace(/^--?/, '');
    if (FLAGS.includes(name)) { out[name] = true; continue; }
    if (OPTIONAL.includes(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) { out[name] = true; }
      else { out[name] = v; i++; }
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) out[name] = true;
    else { out[name] = v; i++; }
  }
  return out;
}

const USAGE = `
  录作业 · 终端入口（和网页「作业」面板同一份实现）

    ./控制台.sh hwk                     问答式录入（全部回车 = 今天；科目留空就不写）
    ./控制台.sh hwk --json              粘 JSON 源码（粘完 Ctrl+D；Windows 用 Ctrl+Z 回车）
    ./控制台.sh hwk --json 作业.json     从文件读 JSON（写成 hwk 作业.json 也一样）
    ./控制台.sh hwk --from-current      以现在显示的那天为底稿改
    ./控制台.sh hwk --list              看现在有哪几天
    ./控制台.sh hwk --dry-run           只算不写
    ./控制台.sh hwk --yes               不再确认

  预填（可和上面任意一条一起用）：
    --id n261011  --date 2026-10-11  --title 作业-20261011
    --bg default | game-mc | game-ut | egg | bg_grid | bg_ink | bg_map | bg_botanical

  会写出去的东西：
    class/data/hwk/hwk-<id>.json        这一天（各科正文直接写在里面）
    class/data/hwk/index.json           目录：这条顶到最前（原来那天就成历史）
    class/data/index-produce.json       生产清单：目录 + 最近 5 天正文（时光机的 CDN 兜底读它）

  Windows：控制台.cmd hwk  ·  也可以 部署.cmd hwk（同一个入口）
`;

/* ═══════════════════════════════════════════════════
   看现状
   ═══════════════════════════════════════════════════ */

function cmdList() {
  let info;
  try {
    info = hwk.listRecords();
  } catch (e) {
    bad(e.message);
    return 1;
  }
  line();
  console.log('  ' + bold('作业数据') + '  ' + dim(info.dirRel));
  line();
  if (!info.records.length) console.log(dim('  目录里还没有任何一天。'));
  info.records.forEach((r, i) => {
    const mark = r.exists ? (i === 0 ? '●' : '○') : '✗';
    console.log(`  ${mark} ${r.date || '(无日期)'}  ${r.title || r.id}  ${dim(r.name + '  ' + r.bytes + ' B')}`
      + (r.exists ? '' : dim('  （文件不在，页面会跳过它）')));
  });
  if (info.orphans.length) {
    line();
    warn('目录里没登记的文件（页面看不到它们，跑一次重建清单就好）：' + info.orphans.map((o) => o.name).join('、'));
  }
  line();
  console.log('  ' + dim('清单：index.json ' + (info.records.length ? '✓' : '✗')
    + ' · index-produce.json ' + (info.produceExists ? '✓' : '✗（跑控制台「重建清单」或 node build/gen-hwk-index.mjs）')));
  if (info.legacy) {
    console.log('  ' + dim('老文件 class/data/homework.json 还在（id ' + (info.legacy.id || '?') + '）——写入时会自动补进历史'));
  }
  line();
  return 0;
}

/* ═══════════════════════════════════════════════════
   写一天
   ═══════════════════════════════════════════════════ */

async function cmdEnter(args) {
  let info;
  try {
    info = hwk.listRecords();
  } catch (e) {
    bad(e.message);
    return 1;
  }
  const newest = info.records.find((r) => r.exists) || info.records[0] || null;
  let draft = null;
  if (newest) {
    try { draft = hwk.readRecord(newest.id).record; } catch { draft = null; }
  }
  if (args['from-current'] && !draft) warn('读不到现在这份记录，就当空白开始');

  /* ── ① 直接给 JSON 源码：读完就写，不再问答 ── */
  if (args.json) {
    let source = '';
    if (typeof args.json === 'string') {
      if (!fs.existsSync(args.json)) { bad('找不到这个文件：' + args.json); return 1; }
      source = fs.readFileSync(args.json, 'utf8');
    } else {
      if (process.stdin.isTTY) {
        line();
        console.log('  粘 JSON 源码，粘完按 ' + bold('Ctrl+D') + dim('（Windows：Ctrl+Z 再回车）') + '：');
        line();
      }
      source = await readStdin();
    }
    if (!source.trim()) { bad('没读到 JSON（空输入）'); return 1; }
    return await write({ mode: 'json', source }, args);
  }

  /* ── ② 问答 ── */
  const r = createReader();
  try {
    line();
    console.log('  ' + bold('录作业') + dim('  一路回车 = 用默认值'));
    if (newest) console.log('  ' + dim('现在显示的是 ' + (newest.date || newest.id) + '「' + (newest.title || '') + '」'));
    line();

    const date = await r.ask('日期', args.date || (draft && draft.date) || info.today);
    const id = await r.ask('id（文件名的一部分：字母数字 . _ -）',
      args.id || (draft && draft.id) || hwk.idFromDate(date));
    const title = await r.ask('标题',
      args.title || (draft && draft.title) || ('作业-' + String(date).replace(/-/g, '')));
    const bg = await r.ask('背景（' + hwk.BG_KNOWN.slice(0, 6).join(' / ') + ' …）',
      args.bg || (draft && draft.bg && (draft.bg.value || draft.bg.slug)) || 'default');

    /* 科目顺序：固定那几科 → 底稿里出现过的自定义科目 */
    const names = [];
    const push = (n) => { if (n && names.indexOf(n) < 0) names.push(n); };
    hwk.DEFAULT_SUBJECTS.forEach(push);
    if (draft) Object.keys(draft).forEach((k) => {
      if (k !== hwk.NOTES_KEY && k !== hwk.EGG_KEY && hwk.RESERVED.indexOf(k) < 0) push(k);
    });

    const subjects = [];
    for (const name of names) {
      const old = draft && typeof draft[name] === 'string' ? draft[name] : '';
      if (old) {
        line();
        console.log('  ' + dim(name + '（现在这份）'));
        old.split('\n').forEach((l) => console.log(dim('    ' + l)));
      }
      const text = await r.multiline(name, old);
      if (String(text).trim()) subjects.push({ name, text: String(text) });
    }
    /* 还想加科目：问名字，留空结束 */
    for (;;) {
      const extra = await r.ask('再加一个科目（留空结束）', '');
      if (!String(extra).trim()) break;
      const text = await r.multiline(String(extra).trim(), '');
      if (String(text).trim()) subjects.push({ name: String(extra).trim(), text: String(text) });
    }

    const oldNotes = draft && typeof draft[hwk.NOTES_KEY] === 'string' ? draft[hwk.NOTES_KEY] : '';
    const notes = await r.multiline(hwk.NOTES_KEY, oldNotes);

    return await write({ mode: 'form', date, id, title, bg, subjects, notes }, args);
  } finally {
    r.close();
  }
}

/** 收尾：先干算一遍给人看 → 确认 → 真写 */
async function write(input, args) {
  let plan;
  try {
    plan = await hwk.saveHomework({ ...input, dryRun: true });
  } catch (e) {
    bad(e.message);
    return 1;
  }

  line();
  console.log('  ' + bold('要写的东西'));
  console.log('  ' + plan.rel + dim('  （' + plan.date + ' · ' + plan.title + '）'));
  console.log('  ' + dim('科目：' + (plan.meta.subjects.join('、') || '（一个都没有）')
    + (plan.meta.hasNotes ? ' + 笔记' : '') + ' · 背景：' + plan.meta.bg));
  if (plan.replaced) warn('这一天已经有文件了 —— 旧版本会先备份到 console/ 的备份目录（不进站点，不会被上传）');
  if (plan.archived.length) warn('老文件 homework.json 里那份会先按 hwk-<id>.json 补进历史');
  plan.notes.forEach((n) => warn(n));
  line();

  if (args['dry-run']) {
    ok('--dry-run：上面就是结果，一个字节都没写');
    return 0;
  }

  if (!args.yes) {
    if (!process.stdin.isTTY) {
      warn('不是交互终端（也没给 --yes），这次不写。要在脚本里用就加 --yes');
      return 1;
    }
    const r = createReader();
    const yes = await r.ask('写进去？(y/N)', '');
    r.close();
    if (!/^y(es)?$/i.test(String(yes).trim())) {
      console.log('  ' + dim('好，什么都没写。'));
      return 0;
    }
  }

  let res;
  try {
    res = await hwk.saveHomework(input);
  } catch (e) {
    bad(e.message);
    return 1;
  }

  line();
  ok('已写入 ' + res.rel);
  res.archived.forEach((a) => ok('老文件那份补进历史：' + a.name + '（' + a.date + '）'));
  res.backups.forEach((b) => console.log('  ' + dim('旧版本备份：' + b)));
  if (res.manifests && !res.manifests.skipped) {
    console.log('  ' + dim('清单已重建：index.json + class/data/index-produce.json'
      + (res.manifests.changed.length ? '（变了 ' + res.manifests.changed.join('、') + '）' : '（内容没变）')));
  } else if (res.manifests) {
    warn('清单生成器没跑成：' + res.manifests.reason);
  }
  res.notes.forEach((n) => warn(n));
  line();
  console.log('  ' + dim('要上线：部署.cmd full -y（Linux：./部署.sh full -y）'));
  console.log('  ' + dim('仓库那边推上去后，GitHub Actions 会再对一遍清单 —— 时光机的 CDN 兜底读的就是它'));
  line();
  return 0;
}

/* ═══════════════════════════════════════════════════
   入口
   ═══════════════════════════════════════════════════ */

export async function main(argv = []) {
  const args = parseArgs(argv);

  if (args.help || args.h) { console.log(USAGE); return 0; }
  if (args.list) return cmdList();

  /* `hwk 某份.json` == `hwk --json 某份.json` */
  if (!args.json && args._.length) {
    const file = args._[0];
    if (!fs.existsSync(file)) { bad('这个文件不在：' + file); return 1; }
    return await write({ mode: 'json', source: fs.readFileSync(file, 'utf8') }, args);
  }

  /* 管道里喂了一份 JSON：cat 作业.json | ./控制台.sh hwk */
  if (!args.json && !process.stdin.isTTY) {
    const source = await readStdin();
    if (source.trim()) return await write({ mode: 'json', source }, args);
  }

  return await cmdEnter(args);
}

const isMain = process.argv[1] && process.argv[1].endsWith('hwk-cli.mjs');
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = Number.isFinite(code) ? code : 0; })
    .catch((e) => { bad(String((e && e.message) || e)); process.exitCode = 1; });
}
