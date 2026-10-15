/**
 * 同步状态（CLI 与控制台共用的一份「现在是什么情况」）
 * ---------------------------------------------------
 * 家里要看的三件事：
 *   · 云端镜像是什么版本、和本地 dist/ 差多少（`sync push` 会传多少）
 *   · 收件箱里有几份、哪几份还没拉下来
 *   · 本地仓库有多少没提交的改动
 * 桌面版看的是另一头：云端版本 vs 本地离线副本。
 * 都从这里出，免得两处各算一套。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanDir, diffManifests, readManifestFile } from './manifest.mjs';
import { listInbox } from './inbox.mjs';
import { MANIFEST_NAME, INBOX_DIR } from './config.mjs';

/** 版本号：优先用 git 的 tag/短哈希，拿不到就 dev */
export function versionOf(projectRoot) {
  const r = spawnSync('git', ['-C', projectRoot, 'describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' });
  if (r.status === 0 && (r.stdout || '').trim()) return r.stdout.trim();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'desktop', 'package.json'), 'utf8'));
    if (pkg.version) return 'v' + pkg.version;
  } catch { /* 没有就算了 */ }
  return 'dev';
}

/** 云端清单（镜像分支根上的 _sync.json）；没有就返回 null */
export async function cloudManifest(transport, branch) {
  try {
    const buf = await transport.get(MANIFEST_NAME, { branch });
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    if (e && (e.status === 404 || /404/.test(String(e.message)))) return null;
    throw e;
  }
}

/** dist/ 的本地清单（和云端清单同一种形状） */
export function localSiteManifest(distDir, { version = '' } = {}) {
  const { files, count, bytes } = scanDir(distDir);
  return { v: 1, version, builtAt: '', count, bytes, files };
}

/** 收件箱里已经拉下来的时间戳（sync/inbox/ 下的目录名） */
export function localInboxStamps(inboxDir) {
  try {
    return fs.readdirSync(inboxDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/**
 * 家里那一侧的完整状态。
 * @returns {{ok:boolean, error?:string, cloud:object|null, local:object, diff:object|null,
 *            inbox:{remote:any[], local:string[], pending:string[]}, git:{dirty:number, last:string}}}
 */
export async function collectState({ transport, branch, distDir, projectRoot, inboxDir, version = '' }) {
  const local = localSiteManifest(distDir, { version });
  const state = {
    ok: true,
    cloud: null,
    local: { count: local.count, bytes: local.bytes, version },
    diff: null,
    inbox: { remote: [], local: localInboxStamps(inboxDir), pending: [] },
    git: { dirty: 0, last: '' },
  };

  try {
    state.cloud = await cloudManifest(transport, branch);
  } catch (e) {
    state.ok = false;
    state.error = e.message;
  }
  if (state.cloud && state.cloud.files) {
    state.diff = diffManifests(local.files, state.cloud.files);
  }
  try {
    state.inbox.remote = await listInbox(transport, { branch: transport.inboxBranch });
    const localSet = new Set(state.inbox.local);
    state.inbox.pending = state.inbox.remote.filter((x) => x.complete && !localSet.has(x.stamp)).map((x) => x.stamp);
  } catch (e) {
    if (state.ok) { state.ok = false; state.error = e.message; }
  }
  const r = spawnSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  state.git.dirty = r.status === 0 ? (r.stdout || '').split(/\r?\n/).filter(Boolean).length : 0;
  const last = spawnSync('git', ['-C', projectRoot, 'log', '-1', '--format=%s'], { encoding: 'utf8' });
  state.git.last = last.status === 0 ? (last.stdout || '').trim() : '';
  return state;
}

export { MANIFEST_NAME, INBOX_DIR };
