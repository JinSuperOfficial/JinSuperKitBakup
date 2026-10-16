#!/usr/bin/env node
/**
 * android/tools/sync-site-assets.mjs —— 把「离线副本最小集」与「作业编辑器界面」
 * 同步进 `android/app/src/main/assets/`
 * ===========================================================
 * 为什么不把这些文件**提交进仓库**：
 *   它们都是**生成物** —— 站点那份的源头在 `jinsuper.rth1.xyz/`，
 *   编辑器界面的源头在 `desktop/src/ui/hwk/`。提交副本就会出现
 *   「改了一边忘了另一边」，而且 git 里会多出一整套重复文件。
 *   所以 `.gitignore` 里排除了 `assets/site/` 与 `assets/hwk-ui/`，
 *   由这个脚本在构建前拷一遍（`android.yml` 与 README 的构建命令里都会先跑它）。
 *
 * 离线副本**只放「看作业」链路所需**（见 project.md 的「移动端」一节）：
 *   明确排除：
 *     · `class/data/english/**`（36MB 的听力音频）—— 页面上直接引线上地址，
 *       离线时按设计静默降级；要缓存走「按需缓存」那条路；
 *     · `p/docs-md.js`（1.45MB）与 `p/fonts/` —— 阅读器不在离线链路里；
 *     · `asset/background/**`（游戏壁纸 2.8MB，只在项目根那份）—— 缺了就是
 *       底纹照常、游戏壁纸空白，页面自己能兜住。
 *
 * 用法：
 *   node android/tools/sync-site-assets.mjs            # 拷（已存在且一样就跳过）
 *   node android/tools/sync-site-assets.mjs --check    # 只比对 + 报体积（CI 用）
 *   node android/tools/sync-site-assets.mjs --clean    # 先清空再拷
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SITE = path.join(ROOT, 'jinsuper.rth1.xyz');
const DESKTOP_HWK_UI = path.join(ROOT, 'desktop', 'src', 'ui', 'hwk');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

/** 目标体积上限（不含 hwk-ui，那点很小）：超过就要按削减顺序砍 */
const MAX_SITE_BYTES = 10 * 1024 * 1024;

/**
 * 离线副本清单：**逐条列出**，不用通配。
 * 这样加文件时是有意识的（而不是「不小心把 36MB 音频拷进去了」）。
 */
const SITE_FILES = [
  'index.html',
  '404.html',
  'robots.txt',
  'site.json',
  'favicon.svg',
  'apple-touch-icon.svg',
  'lib/manifest.js',
  'lib/theme.js',
  'class/index.html',
  'class/homework.html',
  'class/tools.json',
  'class/data/hwk/index.json',
  'class/data/index-produce.json',
  'class/data/hwk-log/index.json',
  'asset/icon/logo.svg',
  'asset/homework/bg_grid.jpg',
  'asset/homework/bg_ink.jpg',
  'asset/homework/bg_map.jpg',
  'asset/homework/bg_botanical.jpg',
];

/** 作业数据：目录里所有 `hwk-*.json`（基线）都带上 */
const HWK_DIR = 'class/data/hwk';

const EDITOR_FILES = ['index.html', 'hwk.css', 'hwk.js'];

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const CLEAN = args.includes('--clean');

const problems = [];
let copied = 0;
let skipped = 0;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyOne(absFrom, relTo, { into }) {
  if (!fs.existsSync(absFrom)) {
    problems.push(`缺文件：${path.relative(ROOT, absFrom)}`);
    return 0;
  }
  const buf = fs.readFileSync(absFrom);
  const absTo = path.join(into, relTo);
  if (CHECK) {
    if (!fs.existsSync(absTo) || !fs.readFileSync(absTo).equals(buf)) {
      problems.push(`过期：${path.relative(ROOT, absTo)}（跑 sync-site-assets.mjs 更新）`);
    }
    return buf.length;
  }
  ensureDir(path.dirname(absTo));
  if (fs.existsSync(absTo) && fs.readFileSync(absTo).equals(buf)) {
    skipped++;
    return buf.length;
  }
  fs.writeFileSync(absTo, buf);
  copied++;
  return buf.length;
}

function collectHwkNames() {
  const dir = path.join(SITE, HWK_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^hwk-.+\.json$/.test(n)).sort();
}

/* ── 主流程 ── */

const siteOut = path.join(OUT, 'site');
const uiOut = path.join(OUT, 'hwk-ui');

if (CLEAN && !CHECK) {
  fs.rmSync(siteOut, { recursive: true, force: true });
  fs.rmSync(uiOut, { recursive: true, force: true });
}
ensureDir(siteOut);

let siteBytes = 0;
for (const rel of SITE_FILES) {
  siteBytes += copyOne(path.join(SITE, rel), rel, { into: siteOut });
}
const hwkNames = collectHwkNames();
if (!hwkNames.length) problems.push(`'${HWK_DIR}' 里一份作业都没有（基线是空的）`);
for (const n of hwkNames) {
  siteBytes += copyOne(path.join(SITE, HWK_DIR, n), `${HWK_DIR}/${n}`, { into: siteOut });
}

let uiBytes = 0;
for (const rel of EDITOR_FILES) {
  uiBytes += copyOne(path.join(DESKTOP_HWK_UI, rel), rel, { into: uiOut });
}

/* ── 体积检查 ── */

const mb = (n) => (n / 1048576).toFixed(2);
if (siteBytes > MAX_SITE_BYTES) {
  problems.push(
    `离线副本 ${mb(siteBytes)}MB 超过上限 ${mb(MAX_SITE_BYTES)}MB —— ` +
      '按 project.md 的削减顺序砍：先砍听力音频（本就按需缓存），再砍 bg_*.jpg（退到默认纯色）',
  );
}

if (problems.length) {
  console.error('✗ ' + (CHECK ? '离线副本过期 / 有问题：' : '同步离线副本时出问题：'));
  for (const p of problems) console.error('   · ' + p);
  process.exit(1);
}

console.log(
  `${CHECK ? '✓ 离线副本是最新的' : '✓ 离线副本同步完成'}：` +
    `site ${mb(siteBytes)}MB（${SITE_FILES.length + hwkNames.length} 个文件）· ` +
    `hwk-ui ${(uiBytes / 1024).toFixed(1)}KB（${EDITOR_FILES.length} 个文件）` +
    (CHECK ? '' : ` · 新拷 ${copied} / 跳过 ${skipped}`),
);

/* ── 顺带提醒一句令牌 ──
   包内 `assets/sync-config.json` 由**另一个脚本**注入（inject-sync-config.mjs），
   它含令牌、不入库。这里只在缺失时说一句人话，省得有人以为是这个脚本漏拷了。 */
const cfg = path.join(OUT, 'sync-config.json');
if (!fs.existsSync(cfg)) {
  console.log(
    '  ℹ 还没有 assets/sync-config.json —— 这个包只能看作业、不能传。' +
      '要能传就跑：node android/tools/inject-sync-config.mjs（需要项目根 .env 里有 JINS_GITEE_TOKEN）',
  );
}
