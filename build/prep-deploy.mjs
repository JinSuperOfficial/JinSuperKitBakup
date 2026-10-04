/**
 * 组装部署产物 dist/
 * ---------------------------------------------------
 * 自动部署会把 `outdir`（也就是 dist/）整体上传。
 * 所以这里只做一件事：把「网站真正需要的东西」原样拼到 dist/ 里。
 *
 * 关键在「增量」——
 *   比对源文件与 dist/ 里已有副本的 sha256，内容没变就**原样不动**。
 *   这样部署工具的日志里能明显看出哪些文件真的变了，
 *   也避免了每次都给所有文件刷新时间戳（那会让增量上传失效）。
 *
 * 真正的镜像/清理规则在 **build/lib/deploy-files.mjs**（和发布控制台的
 * 「与云端合并」共用同一套，避免两处各写一份慢慢长歪）；
 * 这里只负责命令行输出与变更清单文件。
 *
 * 跑法：node build/prep-deploy.mjs
 *      node build/prep-deploy.mjs --verbose   列出每个文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDir, siteRoot } from './paths.mjs';
import { countFiles, mirrorInto, writeChangedFile } from './lib/deploy-files.mjs';

const VERBOSE = process.argv.includes('--verbose');
const projectRoot = path.resolve(buildDir, '..');
const distDir = path.join(projectRoot, 'dist');
const assetDir = path.join(projectRoot, 'asset');

/* ── 开跑 ── */
console.log('\n组装部署产物 → dist/\n');

const result = mirrorInto(distDir, {
  siteRootAbs: siteRoot,
  assetDirAbs: assetDir,
  onFile: VERBOSE
    ? (rel, kind) => {
        const mark = kind === 'same' ? '=' : kind === 'updated' ? '±' : '＋';
        console.log(`    ${mark} ${rel}`);
      }
    : null,
});

if (!fs.existsSync(assetDir)) {
  console.log('  ⚠ 找不到 asset/，sk.json 里那三篇文档线上会读不到');
}

/* dist 自己是一个独立 git 仓库，给它留一份最小 .gitignore：
   prune 见 KEEP_ROOT 会跳过它，所以能一直留着。 */
const distGitignore = path.join(distDir, '.gitignore');
if (!fs.existsSync(distGitignore)) {
  fs.writeFileSync(distGitignore, '*.log\n.deploy-changed.txt\n', 'utf8');
}

console.log(`\n  新增 ${result.added} · 更新 ${result.updated} · 未变 ${result.identical}`);

if (result.pruned.length) {
  console.log(`\n  清理了 ${result.pruned.length} 个源站已删除的旧文件：`);
  for (const f of result.pruned) console.log(`    － ${f}`);
}

if (result.changed.length && !VERBOSE) {
  console.log('\n  这次真正变化的文件：');
  for (const f of result.changed) console.log(`    ${f}`);
}

/* 写一份清单，方便核对。
   注意：没有变化时**不要**覆盖，否则上一次的清单会被清空，
   而部署工具此刻使用的正是上一次组装的结果（它还是最新的）。 */
if (!writeChangedFile(projectRoot, result.changed)) {
  console.log('  （保留上一次的变更清单，本次没有新变化）');
}

const total = countFiles(distDir);

console.log(`\n  dist/ 共 ${total} 个文件（不含 .git）`);
if (result.changed.length === 0) console.log('  内容与上次完全一致——理论上部署工具会全部跳过');
console.log('');
