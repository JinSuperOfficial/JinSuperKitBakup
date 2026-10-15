/**
 * build/make-sync-config.mjs —— 打包前把同步配置（含令牌）注进安装包
 * ---------------------------------------------------
 * 学校那台机器不该让人登录 Gitee、也不该让人手填令牌，所以令牌在**打包时**
 * 从家里的 .env（`JINS_GITEE_TOKEN`）读出来，写进 `desktop/build/sync-config.json`，
 * 由 electron-builder 的 extraResources 放进 `resources/sync-config.json`。
 * 桌面版启动时读它（见 desktop/src/lib-path.js），装完即用。
 *
 * ⚠ 这个文件**绝不能进仓库**（.gitignore 里已经排除）。里面的令牌建议是
 *   「只对同步仓库有写权限」的那种，丢了就在 Gitee 撤销重发一个。
 *
 * 跑法：node desktop/build/make-sync-config.mjs
 *      node desktop/build/make-sync-config.mjs --check   只看会写出什么（不写）
 *
 * CI 里用环境变量（.env 不在仓库里）：JINS_GITEE_TOKEN / JINS_GITEE_OWNER / JINS_GITEE_REPO。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..');
const CHECK = process.argv.includes('--check');

const envFile = path.join(root, '.env');
const syncFile = path.join(root, 'sync.json');
const outFile = path.join(here, 'sync-config.json');

function readEnv(file) {
  const out = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const env = readEnv(envFile);
const sync = readJson(syncFile) || {};
const gitee = { ...(sync.gitee || {}) };
/* 环境变量优先：CI（GitHub Actions）里没法带 .env，只能走 secrets */
if (process.env.JINS_GITEE_OWNER) gitee.owner = process.env.JINS_GITEE_OWNER;
if (process.env.JINS_GITEE_REPO) gitee.repo = process.env.JINS_GITEE_REPO;
const token = process.env.JINS_GITEE_TOKEN || env.JINS_GITEE_TOKEN || gitee.token || '';

/* 没配就**不阻断打包**：谁都可以先打一个「同步未配置」的包出来用，
   面板会在「云端同步」里明确提示还差什么。配好了再打一次即可。 */
const missing = [];
if (!token) missing.push(`.env 里的 ${'JINS_GITEE_TOKEN'}（或环境变量）`);
if (!gitee.owner) missing.push('sync.json 的 gitee.owner');

if (missing.length) {
  console.warn('\n  ! 还没配好同步：' + missing.join('、'));
  console.warn('    这次打包不会带 sync-config.json，桌面版「云端同步」会提示未配置。');
  console.warn('    配好之后重新打一次包就带上了。\n');
  try {
    fs.rmSync(outFile, { force: true });
  } catch { /* 没有就算了 */ }
  process.exit(0);
}

/* 打包进去的这份 = sync.json 的内容 + 令牌；其余字段原样带过去 */
const out = {
  provider: sync.provider || 'gitee',
  gitee: { ...gitee, token },
  local: sync.local || { dir: '' },
  roots: sync.roots || {},
  exclude: sync.exclude || [],
};

const json = JSON.stringify(out, null, '\t') + '\n';
if (CHECK) {
  const masked = JSON.parse(json);
  masked.gitee.token = '<' + token.length + ' 个字符>';
  console.log('\n  会写进 ' + path.relative(root, outFile) + '：\n');
  console.log(masked);
  console.log('');
  process.exit(0);
}

fs.writeFileSync(outFile, json, 'utf8');
console.log(`  ✓ 已写出 ${path.relative(root, outFile)}（令牌 ${token.length} 个字符，仓库 ${gitee.owner}/${gitee.repo}）`);
