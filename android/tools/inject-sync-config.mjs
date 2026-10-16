#!/usr/bin/env node
/**
 * android/tools/inject-sync-config.mjs —— 把同步配置（**含令牌**）注进 APK 的 assets
 * ===========================================================
 * 对齐桌面版的 `desktop/build/make-sync-config.mjs` → `resources/sync-config.json`：
 * 同学**不用登录、不用配任何东西**，装完就能看、就能传。
 *
 * 产物：`android/app/src/main/assets/sync-config.json`
 *   ★ 这个文件**不入库**（见 .gitignore）—— 它含令牌。
 *
 * 令牌来源（与 `sync/lib/config.mjs` 同一套，别另发明）：
 *   1. `--token=` 参数
 *   2. 环境变量 `JINS_GITEE_TOKEN`
 *   3. 项目根 `.env` 里的 `JINS_GITEE_TOKEN`
 *
 * 其余字段从项目根 `sync.json` 读（`gitee.owner` / `repo` / `branch` / `inboxBranch` /
 * `visibility` / `publicBase`）。`from` 取 `--from=` 或留空（安卓那边回落到手机型号）。
 *
 * 用法：
 *   node android/tools/inject-sync-config.mjs                  # 从 .env 注入
 *   node android/tools/inject-sync-config.mjs --from "老师手机"
 *   node android/tools/inject-sync-config.mjs --check          # 只看有没有，不写
 *   node android/tools/inject-sync-config.mjs --dry-run        # 打印（令牌打码）
 *
 * ★ 安全提醒（写在明面上，别只放在文档里）：
 *   APK 是明文注入的，解包就能拿到令牌 —— 这是**有意选择**（见 project.md 的「移动端」一节：
 *   加密只让解包难度上升一档，不改变「能被解包」这件事，却会把复杂度拉满）。
 *   真正的防线是「令牌可以随时在 Gitee 侧撤销 + 重打一个 APK」。
 *   所以：**别把带令牌的 APK 发到公开的地方**；换手机 / 有人退群就重打一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'sync-config.json');

const args = process.argv.slice(2);
const arg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const has = (name) => args.includes(`--${name}`);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '';
};

if (has('check')) {
  if (fs.existsSync(OUT)) {
    const size = fs.statSync(OUT).size;
    console.log(`✓ assets/sync-config.json 在（${size} 字节）—— 这个包能传作业`);
    process.exit(0);
  }
  console.log('· assets/sync-config.json 不在 —— 这个包只能看作业、不能传（这是允许的状态）');
  process.exit(0);
}

/** 读 .env（KEY=VALUE，允许引号 / # 注释）—— 与 sync/lib/config.mjs 的 readEnvFile 同规则 */
function readEnvFile(file) {
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
    const key = s.slice(0, eq).trim();
    let value = s.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const envFile = readEnvFile(path.join(ROOT, '.env'));
const token = arg('token') || process.env.JINS_GITEE_TOKEN || envFile.JINS_GITEE_TOKEN || '';
if (!token) {
  console.error('✗ 没有令牌。三选一：');
  console.error('   · 在项目根 .env 里写 JINS_GITEE_TOKEN=…（推荐）');
  console.error('   · 环境变量 JINS_GITEE_TOKEN=…');
  console.error('   · node android/tools/inject-sync-config.mjs --token=…');
  process.exit(1);
}

let syncJson = {};
try {
  syncJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'sync.json'), 'utf8'));
} catch (e) {
  console.error('✗ 读不到项目根 sync.json：' + e.message);
  process.exit(1);
}
const g = syncJson.gitee || {};
if (!g.owner || !g.repo) {
  console.error('✗ sync.json 里缺 gitee.owner / gitee.repo');
  process.exit(1);
}

/** 与 sync/lib/config.mjs 的 DEFAULT_CONFIG 对齐（扁平一层，安卓侧更好读） */
const config = {
  provider: syncJson.provider === 'local' ? 'gitee' : (syncJson.provider || 'gitee'),
  giteeOwner: String(g.owner).trim(),
  giteeRepo: String(g.repo).trim(),
  giteeBranch: String(g.branch || 'main').trim() || 'main',
  giteeInboxBranch: String(g.inboxBranch || 'inbox').trim() || 'inbox',
  giteeVisibility: g.visibility === 'public' ? 'public' : 'private',
  giteePublicBase: String(g.publicBase || '').replace(/\/+$/, ''),
  token: String(token).trim(),
  from: String(arg('from') || flagValue('from') || '').trim(),
};

if (has('dry-run')) {
  const masked = { ...config, token: config.token.slice(0, 4) + '…（打码）' };
  console.log(JSON.stringify(masked, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
/* 制表符缩进 + 结尾换行：和仓库里其他 JSON 同一个口径 */
fs.writeFileSync(OUT, JSON.stringify(config, null, '\t') + '\n', 'utf8');

console.log(`✓ 注入 ${path.relative(ROOT, OUT)}`);
console.log(`  仓库 ${config.giteeOwner}/${config.giteeRepo} · 收件箱分支 ${config.giteeInboxBranch}`);
console.log(`  令牌 ${config.token.slice(0, 4)}…（共 ${config.token.length} 位，已打码显示）`);
console.log('  ⚠ 这个文件含令牌、不入库；带令牌的 APK 别发到公开的地方。');
