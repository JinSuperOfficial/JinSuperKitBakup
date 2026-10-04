/**
 * 生成站点索引类文件（不要手改产物）
 * ---------------------------------------------------
 * 逻辑在 build/lib/site-index.mjs，这里只是命令行外壳。
 *
 * 跑法：
 *   node build/gen-site-index.mjs           写盘
 *   node build/gen-site-index.mjs --check   只比对，不写（verify-manifests.mjs 用它）
 *   node build/gen-site-index.mjs --stdout [名字]   只打印，不写（看 diff / 受限环境手工落盘用）
 */
import { collectOutputs, checkOutputs, writeOutputs } from './lib/site-index.mjs';

const CHECK_ONLY = process.argv.includes('--check');
const STDOUT_ONLY = process.argv.includes('--stdout');
const STDOUT_NAME = STDOUT_ONLY ? process.argv[process.argv.indexOf('--stdout') + 1] : null;

/* 清单有问题就别生成 —— 校验器会说清楚哪里错 */
const pre = collectOutputs();
if (pre.problems.length) {
  console.error('\n清单有错误，已停止生成：');
  for (const p of pre.problems) console.error('  ✗ ' + p.message);
  console.error('\n先跑 node build/verify-manifests.mjs 看完整报告。\n');
  process.exit(1);
}

if (STDOUT_ONLY) {
  for (const [label, , content] of pre.outputs) {
    if (!STDOUT_NAME || STDOUT_NAME === label) process.stdout.write(content);
  }
  process.exit(0);
}

if (CHECK_ONLY) {
  const { stale } = checkOutputs();
  if (stale.length) {
    for (const s of stale) console.log(`  ! ${s.label} 与现场生成的结果不一致`);
    console.error(`\n有 ${stale.length} 个生成物过期或在被手改：跑 node build/gen-site-index.mjs 重新生成。\n`);
    process.exit(1);
  }
  console.log('  ✓ 生成物都是最新的\n');
  process.exit(0);
}

const written = writeOutputs(pre.outputs);
for (const w of written) console.log(`  ${w.created ? '＋' : '±'} ${w.label}`);
if (!written.length) console.log('  = 生成物未变化');

const items = pre.collections.reduce((n, c) => n + c.items.length, 0);
console.log(`\n  ${pre.collections.length} 个 collection / ${items} 个条目 → 生成物已写出`);
console.log('  sitemap.xml + docs/info/site-index.js\n');
