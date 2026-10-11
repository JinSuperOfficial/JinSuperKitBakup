/**
 * 生成作业清单（本地命令行）
 * ---------------------------------------------------
 * 实际实现在 `build/lib/hwk-index.mjs` —— 这个文件只做两件本地才需要的事：
 *   1. 用 `build/paths.mjs` 算出**真站点根**（`jinsuper.rth1.xyz/`），
 *      CI 里那份拷贝则是拿仓库根（`dist/`）跑的；
 *   2. 顺带刷新生成物（`docs/info/site-index.js` / `sitemap.xml`）——
 *      新写进去的 `index-produce.json` 也是站点里的一份文件，目录树得跟着更新。
 *
 * 跑法：
 *   node build/gen-hwk-index.mjs              扫 class/data/hwk/ → 写两个清单
 *   node build/gen-hwk-index.mjs --check      只比对，不写（有差异退出码 1）
 *   node build/gen-hwk-index.mjs --preview 5  清单里预装几天的正文（默认 5）
 *   node build/gen-hwk-index.mjs --quiet      只留错误
 *
 * 什么时候要跑：手写/手拷了一份 `hwk-<id>.json` 而没走控制台的时候。
 * 平时控制台「写入作业」与「重建清单」按钮会自动调用同一份实现。
 */
import { siteRoot } from './paths.mjs';
import { main as runIndex } from './lib/hwk-index.mjs';

const CHECK = process.argv.includes('--check');

const code = runIndex(process.argv.slice(2), siteRoot);

/* 生成物：内容一致的会跳过，只有真变了才写 */
if (!CHECK && code === 0) {
  try {
    const { collectOutputs, writeOutputs } = await import('./lib/site-index.mjs');
    const wrote = writeOutputs(collectOutputs().outputs);
    if (wrote.length && !process.argv.includes('--quiet')) {
      console.log('  生成物已更新：' + wrote.map((w) => w.label).join(' / ') + '\n');
    }
  } catch (e) {
    console.error('  生成物没刷新成（' + e.message + '）：跑一次 部署.cmd build 就好');
  }
}

if (CHECK && code === 0 && !process.argv.includes('--quiet')) {
  console.log('  两个清单都和现场一致。\n');
}

process.exit(code);
