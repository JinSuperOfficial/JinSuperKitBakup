/**
 * 渲染核心自检：拿真实文档跑一遍，把关键语法点逐个断言。
 * 用法：node test-render.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './lib/markdown.cjs';
import { buildDir, siteRoot } from './paths.mjs';

const here = buildDir;
/* asset/ 在站点目录之外（项目根下），所以不能一律拼 siteRoot */
const projectRoot = path.resolve(buildDir, '..');

function read(p) {
  const abs = p.startsWith('asset/')
    ? path.join(projectRoot, p)
    : path.join(siteRoot, p);
  return fs.readFileSync(abs, 'utf8');
}

/** 文件在不在（归档之后原文会离开 /p） */
function has(p) {
  const abs = p.startsWith('asset/') ? path.join(projectRoot, p) : path.join(siteRoot, p);
  return fs.existsSync(abs);
}

/**
 * 全语法测试稿的位置。
 * ---------------------------------------------------
 * `p/TEST.md` 既是站点上的一篇文档，也是这套断言的样本。
 * 它要是被**归档**了（发布控制台会把原文挪到项目根的 para/ 留底），
 * 站点目录里就没有它了 —— 那就去留底目录接着测，
 * 而不是让整套自检因为「文件不存在」直接挂掉。
 */
function syntaxSample() {
  const cands = [
    path.join(siteRoot, 'p', 'TEST.md'),
    path.join(projectRoot, 'para', 'TEST.md'),     /* 归档留底（保持原相对路径） */
  ];
  for (const c of cands) if (fs.existsSync(c)) return { abs: c, text: fs.readFileSync(c, 'utf8') };
  return null;
}

const cases = [
  { file: 'p/TEST.md', label: 'TEST.md（全语法测试稿）' },
  { file: 'p/science.md', label: 'science.md' },
  { file: 'p/para/First.md', label: 'First.md' },
  { file: 'p/SKILL.md', label: 'p/SKILL.md' },
  { file: 'asset/SKILL.md', label: 'asset/SKILL.md' },
  { file: 'asset/功能.md', label: 'asset/功能.md' },
];

let failed = 0;

for (const c of cases) {
  if (!has(c.file)) {
    /* 归档走了的不算失败：站点上那篇现在就以预渲染稿的形式存在 */
    console.log(`· ${c.label} 不在 ${c.file}（可能已归档），跳过这一份样本`);
    continue;
  }
  const src = read(c.file);
  const t0 = performance.now();
  let html;
  try {
    html = renderMarkdown(src);
  } catch (e) {
    console.log(`✗ ${c.label}\n   渲染抛错: ${e.stack.split('\n').slice(0, 4).join('\n   ')}`);
    failed++;
    continue;
  }
  const ms = (performance.now() - t0).toFixed(0);
  const katexCount = (html.match(/class="katex/g) || []).length;
  const h2 = (html.match(/<h2 /g) || []).length;
  console.log(`✓ ${c.label}  src=${src.length}B  html=${html.length}B  ${ms}ms  h2=${h2}  katex=${katexCount}`);

  /* 写一份产物供人眼检查 */
  const outDir = path.join(here, '.out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, path.basename(c.file) + '.html'), html, 'utf8');
}

/* ── 针对性断言（拿全语法测试稿，它是专门测语法的） ── */
console.log('\n── 语法点断言 ──');
const sample = syntaxSample();
if (!sample) {
  console.log('✗ 找不到全语法测试稿（p/TEST.md 和 para/TEST.md 都没有），语法断言无法进行');
  failed++;
}
const testHtml = sample ? renderMarkdown(sample.text) : '';
if (sample) {
  console.log(`  样本：${path.relative(projectRoot, sample.abs).split(path.sep).join('/')}`);
}

const checks = [
  ['标题锚点 id',            /<h2 id="[^"]+"/],
  ['锚点链接 .anchor',       /class="anchor"/],
  ['代码高亮 hljs',          /class="hljs[^"]*"/],
  ['行号包装 .cl',           /class="cl/],
  ['高亮行 .hl',             /class="cl hl"/],
  /* 语言后面写 :line-numbers 才显示行号栏，和 {1,3-5} 高亮是两件事 */
  [':line-numbers 行号栏',   /class="hljs[^"]*show-lines"/],
  ['KaTeX 行内公式',         /class="katex"/],
  ['KaTeX 块级公式',         /katex-display/],
  ['GitHub 告示',            /markdown-alert/],
  /* 不写名字时不该硬塞默认标题，只留 data-untitled + aria-label */
  ['告示未命名无标题行',      /class="markdown-alert markdown-alert-note"[^>]*data-untitled="true"/],
  ['告示未命名保留 aria',     /aria-label="注意"[^>]*data-untitled="true"/],
  /* 写了名字就用写的，不能被默认标题盖掉（标题行里前面还有图标 svg） */
  ['告示自定义标题',          /markdown-alert-title">[\s\S]*?部署前须知<\/p>/],
  ['告示标题中文长句',        /markdown-alert-title">[\s\S]*?改这个文件前先备份<\/p>/],
  ['告示标题支持行内代码',     /markdown-alert-title">[\s\S]*?<code>rg<\/code>[\s\S]*?<\/p>/],
  ['提示框 :::',             /md-box/],
  ['容器自定义标题',          /md-box-title">自定义标题的警告框<\/p>/],
  ['容器标题支持行内代码',     /md-box-title">[\s\S]*?<code>npm run build<\/code>[\s\S]*?<\/p>/],
  ['容器默认标题',            /md-box md-box-tip"><p class="md-box-title">提示<\/p>/],
  ['任务列表',               /type="checkbox"/],
  ['脚注',                   /footnote/],
  ['表格',                   /<table>/],
  ['图片懒加载',             /loading="lazy"/],
  ['emoji 转字符',           /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u],
  ['注音 ruby',              /<ruby>/],
  ['剧透 spoiler',           /class="spoiler"/],
  ['[[toc]] 目录',           /class="md-toc"/],

  /* ── 站点扩展：卡片 ── */
  ['card 渲染成 a.card',      /<a href="[^"]*" class="card">/],
  ['card 标题 .card-title',   /class="card-title">归途，且慢</],
  ['card 日期 .card-date',    /class="card-date">2026\.9\.27</],
  ['card 转文档站深链接',      /href="\/p\/docs\.html#idea%2F1\.%E5%BD%92%E9%80%94%E4%B8%94%E6%85%A2\.md"/],
  ['card 外链原样',           /href="https:\/\/example\.com\/\?a=1&amp;b=2"/],
  /* 没写 link 的留给页面上的 enhance 兜底，这里应保持原样（不变成 a.card） */
  ['card 无 link 不被误转',    /<card>这张不该变成卡片<\/card>/],

  /* ── 站点扩展：选项卡 @mdit/plugin-tab ── */
  ['tabs 容器',              /class="tabs-tabs-wrapper"/],
  ['tabs 标签行 role=tablist', /class="tabs-tabs-header" role="tablist"/],
  ['tabs 页签 role=tab',      /class="tabs-tab-button[^"]*" role="tab" aria-selected="(?:true|false)"/],
  ['tabs 面板 role=tabpanel', /class="tabs-tab-content[^"]*" role="tabpanel"/],
  ['tabs 标题支持行内代码',    /tabs-tab-button[^>]*>用 <code>npm<\/code> 安装</],
  ['tabs 容器 id',           /class="tabs-tabs-wrapper" data-id="demo-group"/],
  ['tabs 页签 id',           /class="tabs-tab-button[^"]*" role="tab"[^>]*data-id="tab-a"/],
  ['tabs 单页签标 data-single', /class="tabs-tabs-wrapper" data-single="true"/],
  ['tabs 里的代码块有高亮',    /role="tabpanel"[^>]*>[\s\S]{0,80}class="hljs language-bash"/],

  /* ── 站点扩展：代码组 ── */
  ['code-group 容器',         /class="code-group"/],
  ['code-group 面板',         /class="cg-panel"/],
  ['code-group 标签文字',      /data-label="(JavaScript|Python|配置文件|JSON|Bash)"/],
  ['code-group 用了 [标签]',   /data-label="配置文件"/],
  ['code-group 里的代码有高亮', /class="cg-panel"[^>]*><pre><code class="hljs/],
];

for (const [name, re] of checks) {
  const ok = re.test(testHtml);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}

/* 代码组的结构正确性：面板数、内外代码块数量对得上 */
const cgCount = (testHtml.match(/class="code-group"/g) || []).length;
const cgPanels = (testHtml.match(/class="cg-panel"/g) || []).length;
console.log(`\n── 代码组结构 ──`);
console.log(`${cgCount === 3 ? '✓' : '✗'} TEST.md 里应有 3 个代码组，实际 ${cgCount}`);
if (cgCount !== 3) failed++;
console.log(`${cgPanels === 5 ? '✓' : '✗'} 面板总数应为 5（2+2+1），实际 ${cgPanels}`);
if (cgPanels !== 5) failed++;

/* 代码组外面的普通代码块要照旧渲染。
   注意别用 includes("const outside") —— 代码高亮会把关键字拆成
   <span class="hljs-keyword">const</span> outside，字面量匹配不到。 */
const outsideOk = /const<\/span>\s*outside|const outside/.test(testHtml);
console.log(`${outsideOk ? '✓' : '✗'} 代码组外的普通代码块没受影响`);
if (!outsideOk) failed++;

/* ── 告示：未命名 vs 命名，两者不能互相污染 ── */
const alerts = [...testHtml.matchAll(/<div class="markdown-alert markdown-alert-(\w+)"([^>]*)>/g)];
const untitled = alerts.filter((m) => /data-untitled="true"/.test(m[2]));
const titled = alerts.filter((m) => !/data-untitled="true"/.test(m[2]));
console.log('\n── 告示 ──');
console.log(`${alerts.length === 9 ? '✓' : '✗'} 告示总数应为 9，实际 ${alerts.length}`);
if (alerts.length !== 9) failed++;
console.log(`${untitled.length === 6 ? '✓' : '✗'} 未命名告示应为 6，实际 ${untitled.length}`);
if (untitled.length !== 6) failed++;
console.log(`${titled.length === 3 ? '✓' : '✗'} 命名告示应为 3，实际 ${titled.length}`);
if (titled.length !== 3) failed++;
/* 未命名的告示里不能出现标题行：按告示开标签切片，逐段查 */
const segs = [];
alerts.forEach((m, i) => {
  const end = i + 1 < alerts.length ? alerts[i + 1].index : testHtml.length;
  segs.push({ untitled: /data-untitled="true"/.test(m[2]), body: testHtml.slice(m.index, end) });
});
const untitledHasTitle = segs.some((s) => s.untitled && /markdown-alert-title/.test(s.body));
console.log(`${!untitledHasTitle ? '✓' : '✗'} 未命名告示里没有残留的默认标题行`);
if (untitledHasTitle) failed++;
const titledHasTitle = segs.filter((s) => !s.untitled).every((s) => /markdown-alert-title/.test(s.body));
console.log(`${titledHasTitle ? '✓' : '✗'} 命名告示都带上了标题行`);
if (!titledHasTitle) failed++;

/* ── 选项卡结构 ── */
const tabWraps = (testHtml.match(/class="tabs-tabs-wrapper"/g) || []).length;
const tabSingle = (testHtml.match(/class="tabs-tabs-wrapper" data-single="true"/g) || []).length;
const tabGroups = (testHtml.match(/data-id="demo-group"/g) || []).length;
const tabBtns = (testHtml.match(/class="tabs-tab-button/g) || []).length;
const tabPanels = (testHtml.match(/class="tabs-tab-content/g) || []).length;
const tabActiveBtns = (testHtml.match(/class="tabs-tab-button active"/g) || []).length;
const tabActivePanels = (testHtml.match(/class="tabs-tab-content active"/g) || []).length;

console.log('\n── 选项卡 ──');
const tabChecks = [
  [tabWraps === 6, `容器 6 个（实际 ${tabWraps}）`],
  [tabBtns === 11, `页签 11 个（实际 ${tabBtns}）`],
  [tabPanels === 11, `面板 11 个（实际 ${tabPanels}）`],
  /* 每个容器都要恰好有一个选中，否则会出现「一个面板都不显示」的空窗 */
  [tabActiveBtns === 6, `每个容器各有 1 个选中页签，共 6（实际 ${tabActiveBtns}）`],
  [tabActivePanels === 6, `每个容器各有 1 个选中面板，共 6（实际 ${tabActivePanels}）`],
  [tabSingle === 1, `单页签容器 1 个（实际 ${tabSingle}）`],
  [tabGroups === 2, `跨容器联动组 2 个（实际 ${tabGroups}）`],
];
for (const [pass, label] of tabChecks) {
  console.log(`${pass ? '✓' : '✗'} ${label}`);
  if (!pass) failed++;
}

/* @tab:active 必须被尊重：第二个容器的第 2 个页签是选中的。
   按容器切片来判断，不能直接截到文末 —— 后面的容器本来就有各自的 data-tab="0" 选中项。 */
const wrapStarts = [...testHtml.matchAll(/class="tabs-tabs-wrapper"/g)].map((m) => m.index);
const wrapBody = (n) => testHtml.slice(wrapStarts[n], wrapStarts[n + 1] ?? testHtml.length);
const second = wrapBody(1);

const respectsActive = /tabs-tab-button active[^>]*data-tab="1"/.test(second);
console.log(`${respectsActive ? '✓' : '✗'} @tab:active 指定的页签被选中（没被默认值盖掉）`);
if (!respectsActive) failed++;

const firstOfSecond = /tabs-tab-button active[^>]*data-tab="0"/.test(second);
console.log(`${!firstOfSecond ? '✓' : '✗'} 显式 @tab:active 时第一个不会被强行选中`);
if (firstOfSecond) failed++;

/* 没写 @tab:active 的容器，默认选中第一个（否则一个面板都不显示，整块空白） */
const defaultsToFirst = wrapStarts.every((_, n) => {
  const body = wrapBody(n);
  if (/tabs-tab-button active[^>]*data-tab="1"/.test(body)) return true; /* 显式指定过，跳过 */
  return /tabs-tab-button active[^>]*data-tab="0"/.test(body);
});
console.log(`${defaultsToFirst ? '✓' : '✗'} 没写 @tab:active 的容器默认选中第一个`);
if (!defaultsToFirst) failed++;

/* ── 选项卡边界情况：空容器、嵌套、标签成对 ── */
console.log('\n── 选项卡边界情况 ──');

function balanced(html) {
  return (html.match(/<div/g) || []).length === (html.match(/<\/div>/g) || []).length;
}

const edgeCases = [
  {
    label: '空容器（没有 @tab）整块丢掉',
    src: '::: tabs\n:::',
    want: (h) => h.trim() === '',
  },
  {
    label: '空容器夹在正常容器之间不乱序',
    src: '::: tabs\n:::\n\n::: tabs\n\n@tab 甲\nA\n\n:::\n\n::: tabs\n:::',
    want: (h) => (h.match(/tabs-tabs-wrapper/g) || []).length === 1 && balanced(h),
  },
  {
    label: '嵌套（外层 :::: / 内层 :::）',
    src: ':::: warning\n::: tabs\n\n@tab 甲\nA\n\n@tab 乙\nB\n\n:::\n::::',
    want: (h) =>
      /md-box-warning/.test(h) &&
      (h.match(/tabs-tab-content/g) || []).length === 2 &&
      /<p>B<\/p>/.test(h) &&
      balanced(h),
  },
  {
    label: '未闭合的容器也能收尾',
    src: '::: tabs\n\n@tab 甲\nA',
    want: (h) => (h.match(/tabs-tabs-wrapper/g) || []).length === 1 && balanced(h),
  },
];

for (const c of edgeCases) {
  const html = renderMarkdown(c.src);
  const pass = c.want(html);
  console.log(`${pass ? '✓' : '✗'} ${c.label}`);
  if (!pass) {
    failed++;
    console.log('   实际输出：' + JSON.stringify(html.trim().slice(0, 200)));
  }
}

/* 代码组不该把外面的代码块吞掉。
   TEST.md 里共 17 个 <pre>：16 个围栏（组内 5 + 组外 10 + 选项卡内 1）
   额外 1 个是 §1.5 的缩进式代码块（无语言，code 上不加 class）。 */
const preCount = (testHtml.match(/<pre/g) || []).length;
console.log(`${preCount === 17 ? '✓' : '✗'} 代码块总数 17（16 个围栏 + 1 个缩进块），实际 ${preCount}`);
if (preCount !== 17) failed++;

/* card 不该有裸标签残留 */
const bareCards = (testHtml.match(/<card[\s>]/gi) || []).length;
console.log(`${bareCards === 1 ? '✓' : '✗'} 只有「没写 link 的那张」保留为字面量（实际 ${bareCards} 处）`);
if (bareCards !== 1) failed++;

/* 砍掉 Mermaid 的确认：必须没有 mermaid 容器，只有普通代码块 */
const noMermaid = !/md-mermaid/.test(testHtml);
console.log(`${noMermaid ? '✓' : '✗'} Mermaid 已砍掉（无 md-mermaid 容器）`);
if (!noMermaid) failed++;

if (/preconnect|jsdelivr|unpkg/.test(testHtml)) {
  console.log('✗ 产物里出现了 CDN 痕迹');
  failed++;
} else {
  console.log('✓ 产物无任何 CDN 痕迹');
}

console.log(failed ? `\n共 ${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
