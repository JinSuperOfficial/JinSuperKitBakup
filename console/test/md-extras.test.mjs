/**
 * 控制台「渲染增强」验收（node:test）
 * ---------------------------------------------------
 * 覆盖三件事（都是用户对齐过的约定）：
 *   1. 预览能画图表：ECharts 走服务端 SSR 出内联 SVG；mermaid 留占位交给浏览器；
 *   2. 画不出来的语法必须给提示，而不是安静退化；
 *   3. **归档产物自包含**：能烘的烘成静态标记（ECharts），要浏览器运行时的
 *      （mermaid）退回代码块 —— 产物里不许出现外部插件脚本。
 *
 * 走的是 lib/render.mjs / lib/md-extras.mjs 本身，不经过 HTTP，所以不会动
 * 任何 fixture 站点；依赖从真实 build/node_modules 解析（和运行时一致）。
 *
 * 跑法：node --test console/test/md-extras.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFragment, setupErrors } from '../lib/render.mjs';
import { extrasStatus, scanUnsupported, mermaidClientFile } from '../lib/md-extras.mjs';

const SRC = [
  '# 图表自检',
  '',
  '```echarts',
  '{"xAxis":{"type":"category","data":["一","二","三"]},',
  ' "yAxis":{"type":"value"},',
  ' "series":[{"type":"bar","data":[5,20,36]}]}',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
  '```plantuml',
  'Bob -> Alice : hello',
  '```',
].join('\n');

test('1. 预览：ECharts 出内联 SVG，mermaid 留占位，plantuml 给提示', () => {
  const html = renderFragment(SRC);
  assert.equal(setupErrors().length, 0, '插件装载不该报错：' + setupErrors().join('；'));
  assert.match(html, /<figure class="md-chart"[^>]*>\s*<svg/, 'ECharts 应该渲染成内联 SVG');
  assert.match(html, /class="mermaid md-mermaid"/, 'mermaid 应该留占位给浏览器画');
  assert.match(html, /data-ext="plantuml"/, 'plantuml 画不出来，要给一条提示');
  assert.match(html, /language-plantuml/, 'plantuml 的源码块要照常保留');
});

test('2. 能力状态：报得出每个特性可用不可用，并说明原因', () => {
  const st = extrasStatus();
  const by = Object.fromEntries(st.features.map((f) => [f.id, f]));
  assert.ok(by.echarts, '状态里要有 echarts');
  assert.ok(by.mermaid, '状态里要有 mermaid');
  assert.equal(by.echarts.ok, true, 'echarts 是 build 的依赖，应该可用');
  assert.equal(by.plantuml.ok, false, 'plantuml 离线不接，必须如实标不支持');
  assert.match(by.plantuml.detail, /服务/, '不支持要给原因');
  assert.ok(typeof st.summary === 'string' && st.summary.length, 'summary 要有内容');

  /* mermaid 的浏览器包：装了才有（可选依赖），两条路都得是合法结果 */
  const mf = mermaidClientFile();
  assert.ok(mf === null || mf.endsWith('.js'), 'mermaid 客户端文件要么没有，要么是个 js：' + mf);
  assert.equal(by.mermaid.ok, !!mf, 'mermaid 的可用性要跟客户端文件对不对得上');
});

test('3. 外部 markdown-it 插件：装了就用，装不上只提示不炸', () => {
  const st = extrasStatus();
  for (const p of st.external) {
    assert.ok(typeof p.id === 'string' && p.id, '每个外部插件都要有 id');
    if (!p.ok) assert.ok(p.detail, '装不上的插件要说明原因');
  }
  /* figure 在 console/md-plugins.json 里默认启用；装了就该生效 */
  const fig = st.external.find((p) => p.id === 'figure');
  if (fig && fig.ok) {
    const html = renderFragment('![一只猫](cat.png "标题")');
    assert.match(html, /<figure><img[^>]*alt="一只猫"[^>]*><figcaption>标题<\/figcaption><\/figure>/,
      'figure 插件应该把独立成段的图片包成 figure + figcaption');
  }
});

test('4. 归档产物自包含：ECharts 烘进去，mermaid 退回代码块，不引外部脚本', () => {
  const html = renderFragment(SRC, { mode: 'bake' });
  assert.match(html, /<svg/, 'ECharts 要烘成内联 SVG（产物不依赖任何脚本）');
  assert.ok(!/md-mermaid/.test(html), '归档里不能出现 mermaid 占位（那是要浏览器脚本的）');
  assert.match(html, /language-mermaid/, 'mermaid 要退回普通代码块');
  assert.ok(!/<script/i.test(html), '归档片段里不该有 script');
  /* 只允许 SVG 自带的 xmlns 命名空间；不许出现外链资源 */
  const noNs = html.replace(/xmlns(:xlink)?="[^"]*"/g, '');
  assert.ok(!/https?:\/\//.test(noNs), '归档片段不该引外链资源');
});

test('5. scanUnsupported：归档时能说清哪几段没烘进去', () => {
  const bake = scanUnsupported(SRC, 'bake');
  assert.deepEqual(bake.map((u) => u.lang), ['mermaid', 'plantuml'],
    '归档要报出所有烘不进去的：mermaid 要浏览器脚本、plantuml 离线不接');
  assert.ok(bake.every((u) => u.detail), '每一条都要说原因');

  /* 预览模式下 echarts/mermaid 都能画，只有 plantuml 该报 */
  const prev = scanUnsupported(SRC, 'preview').map((u) => u.lang);
  assert.deepEqual(prev, ['plantuml']);
});

test('6. 图表配置写坏了：报错但不影响整篇渲染', () => {
  const html = renderFragment('# 标题\n\n```echarts\n{ 这不是 JSON }\n```\n\n正文还在。');
  assert.match(html, /md-chart-bad/, '坏配置要落在图表错误块里');
  assert.match(html, /正文还在/, '其它内容必须照常渲染');
});
