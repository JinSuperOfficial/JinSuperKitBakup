/**
 * 同步配置（唯一来源）
 * ---------------------------------------------------
 * 两种读法，同一份结构：
 *   · 家里（CLI / 控制台）：项目根的 `sync.json`（非机密）+ `.env` 里的
 *     `JINS_GITEE_TOKEN`（机密，`.env` 不入库）
 *   · 学校（桌面版）：包内 `resources/sync-config.json`（打包时由
 *     `desktop/build/make-sync-config.mjs` 生成）→ 用户设置里的覆盖 → 开发态回落到仓库配置
 *
 * 所以「令牌从哪来」在桌面版里是**自带**的：学校那台机器不需要登录、不需要配置。
 *
 * 字段（sync.json）：
 *   provider         'gitee' | 'local'
 *   gitee.owner      账号
 *   gitee.repo       仓库名
 *   gitee.branch     站点镜像分支（家里 git push）
 *   gitee.inboxBranch 收件箱分支（学校用接口写）
 *   gitee.visibility 'private'（默认，走带令牌的 raw）| 'public'（走免令牌 CDN raw）
 *   gitee.publicBase 自建/自定义域名（可选；要备案，见桌面版「访问方式」）
 *   local.dir        本地目录 / U 盘后端（可选，兜底）
 *   roots            root 名 → 仓库里的相对目录（apply 用）
 *   exclude          不参与镜像的路径（相对站点根）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SYNC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // <仓库>/sync
export const PROJECT_ROOT = path.dirname(SYNC_DIR);                                    // <仓库>

export const CONFIG_FILE = 'sync.json';
export const TOKEN_ENV = 'JINS_GITEE_TOKEN';

/** 收件箱 / 镜像里用到的固定名字 */
export const MANIFEST_NAME = '_sync.json';        // 站点镜像清单（分支根）
export const INBOX_DIR = 'inbox';
export const INBOX_MANIFEST = '_manifest.json';
export const INBOX_ROOTS = ['hwk', 'site', 'misc'];

export const DEFAULT_CONFIG = {
  provider: 'gitee',
  gitee: {
    owner: '', repo: 'jinsuper-sync', branch: 'main', inboxBranch: 'inbox',
    visibility: 'private', publicBase: '',
  },
  local: { dir: '' },
  roots: { hwk: 'jinsuper.rth1.xyz/class/data/hwk', site: 'jinsuper.rth1.xyz', misc: 'sync/inbox' },
  exclude: [],
};

/** 读一个 .env（KEY=VALUE，允许引号、# 注释）；读不到就返回 {} */
export function readEnvFile(file) {
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

const str = (v, dflt = '') => (v === null || v === undefined ? dflt : String(v)).trim();

function normalize(raw, { token }) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const src = (raw && typeof raw === 'object') ? raw : {};
  cfg.provider = src.provider === 'local' ? 'local' : 'gitee';
  const g = (src.gitee && typeof src.gitee === 'object') ? src.gitee : {};
  cfg.gitee.owner = str(g.owner);
  cfg.gitee.repo = str(g.repo, DEFAULT_CONFIG.gitee.repo) || DEFAULT_CONFIG.gitee.repo;
  cfg.gitee.branch = str(g.branch, 'main') || 'main';
  cfg.gitee.inboxBranch = str(g.inboxBranch, 'inbox') || 'inbox';
  cfg.gitee.visibility = g.visibility === 'public' ? 'public' : 'private';
  cfg.gitee.publicBase = str(g.publicBase).replace(/\/+$/, '');
  cfg.gitee.token = str(token || g.token);
  const l = (src.local && typeof src.local === 'object') ? src.local : {};
  cfg.local.dir = str(l.dir);
  if (src.roots && typeof src.roots === 'object') {
    for (const key of INBOX_ROOTS) {
      if (src.roots[key]) cfg.roots[key] = str(src.roots[key]);
    }
  }
  if (Array.isArray(src.exclude)) cfg.exclude = src.exclude.map((s) => str(s)).filter(Boolean);
  /* 镜像清单自己不能进镜像（它是清单，不是站点内容） */
  cfg.exclude = Array.from(new Set([...cfg.exclude, MANIFEST_NAME]));
  return cfg;
}

/**
 * 读配置。
 * @param {object} o
 *   root       仓库根（默认按本文件位置推）
 *   config     直接给一份配置（桌面版用；优先于文件）
 *   token      直接给令牌（桌面版用；优先于 .env）
 *   env        环境变量对象（默认 process.env）
 * @returns {{config:object, problems:string[], sources:string[]}}
 */
export function loadConfig(o = {}) {
  const root = o.root || PROJECT_ROOT;
  const env = o.env || process.env;
  const sources = [];
  const problems = [];

  let raw = o.config || null;
  if (raw) sources.push('参数传入');
  else {
    const file = path.join(root, CONFIG_FILE);
    if (fs.existsSync(file)) {
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        sources.push(CONFIG_FILE);
      } catch (e) {
        problems.push(`${CONFIG_FILE} 不是合法 JSON：${e.message}`);
        raw = null;
      }
    }
  }

  let token = o.token || '';
  if (!token) {
    const fileEnv = readEnvFile(path.join(root, '.env'));
    token = env[TOKEN_ENV] || fileEnv[TOKEN_ENV] || '';
    if (token) sources.push('.env');
  } else {
    sources.push('令牌：参数传入');
  }

  const config = normalize(raw, { token });
  config.root = root;

  if (config.provider === 'gitee') {
    if (!config.gitee.owner) problems.push('还没配 gitee.owner（sync.json）');
    if (!config.gitee.repo) problems.push('还没配 gitee.repo（sync.json）');
    if (!config.gitee.token) problems.push(`还没有令牌：在项目根 .env 里写 ${TOKEN_ENV}=…（或在桌面版设置里填）`);
  } else if (!config.local.dir) {
    problems.push('provider=local 时要配 local.dir（本地目录 / U 盘）');
  }

  return { config, problems, sources };
}

/** 给界面用的一份说明（不含令牌本身） */
export function describeConfig(config) {
  if (config.provider === 'local') return `本地目录 · ${config.local.dir || '(未配)'}`;
  const vis = config.gitee.visibility === 'public' ? '公开' : '私有';
  const host = config.gitee.publicBase || `gitee.com/${config.gitee.owner}/${config.gitee.repo}`;
  return `Gitee · ${host} · ${vis} · 镜像分支 ${config.gitee.branch} / 收件箱分支 ${config.gitee.inboxBranch}`;
}

/** 仓库在 Gitee 上的页面地址 */
export function repoWebUrl(config) {
  const { owner, repo } = config.gitee;
  return `https://gitee.com/${owner}/${repo}`;
}
