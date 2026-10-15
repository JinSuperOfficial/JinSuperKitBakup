/**
 * 站点镜像清单（增量同步的账本）
 * ---------------------------------------------------
 * `_sync.json` 放在部署产物 dist/ 的根（`sync push` 写它，随仓库推到 Gitee
 * 的镜像分支）。形状：
 *
 *   { v: 1, version: '1.0.0', builtAt: '2026-10-15T…', count: 758,
 *     bytes: 51000000, files: { 'p/docs.html': '<sha256>', … } }
 *
 * 学校那边拿它和本地离线副本对一遍，**只下变化的文件**（第一次全量由随包的
 * `resources/site` 顶着，所以通常每次只有几个文件）。
 *
 * 规则只有一份：dist 里除了 `.git/`、`.github/` 和清单自己，其它文件都进清单。
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './hash.mjs';
import { MANIFEST_NAME } from './config.mjs';

export const MANIFEST_VERSION = 1;
export const SKIP_DIRS = new Set(['.git', '.github']);
export const SKIP_FILES = new Set([MANIFEST_NAME, '.deploy-changed.txt']);

/** 扫一个目录 → { files: {相对路径: sha256}, count, bytes } */
export function scanDir(dirAbs, { prefix = '', onFile = null } = {}) {
  const files = {};
  let count = 0;
  let bytes = 0;
  const walk = (d, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(d, e.name), rel ? rel + '/' + e.name : e.name);
        continue;
      }
      if (!e.isFile()) continue;
      if (!rel && SKIP_FILES.has(e.name)) continue;
      const key = rel ? rel + '/' + e.name : e.name;
      const abs = path.join(d, e.name);
      const stat = fs.statSync(abs);
      files[key] = sha256(fs.readFileSync(abs));
      count++;
      bytes += stat.size;
      if (onFile) onFile(key);
    }
  };
  if (fs.existsSync(dirAbs)) walk(dirAbs, prefix);
  return { files, count, bytes };
}

/** 生成清单对象（version 从 package.json / 桌面版版本传进来） */
export function buildManifest(dirAbs, { version = '', builtAt = new Date().toISOString(), onFile = null } = {}) {
  const { files, count, bytes } = scanDir(dirAbs, { onFile });
  return { v: MANIFEST_VERSION, version, builtAt, count, bytes, files };
}

export function readManifestFile(fileAbs) {
  const data = JSON.parse(fs.readFileSync(fileAbs, 'utf8'));
  if (!data || typeof data !== 'object' || !data.files || typeof data.files !== 'object') {
    throw new Error(`${MANIFEST_NAME} 形状不对：缺 files`);
  }
  return {
    v: data.v || 1,
    version: String(data.version || ''),
    builtAt: String(data.builtAt || ''),
    count: Number(data.count || Object.keys(data.files).length),
    bytes: Number(data.bytes || 0),
    files: data.files,
  };
}

export function writeManifestFile(fileAbs, manifest) {
  /* 先写临时文件再改名：读的人永远看不到半份清单 */
  const tmp = fileAbs + '.part';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, '\t') + '\n', 'utf8');
  fs.renameSync(tmp, fileAbs);
  return fileAbs;
}

/**
 * 本地 vs 云端：要下哪些、要删哪些。
 * @param {object} local  { 路径: sha256 }
 * @param {object} remote { 路径: sha256 }
 * @param {object} o      { skip:Set 不动的本地路径（比如桌面版自己维护的文件） }
 */
export function diffManifests(local = {}, remote = {}, { skip = new Set() } = {}) {
  const toDownload = [];
  const same = [];
  for (const [rel, sha] of Object.entries(remote)) {
    if (skip.has(rel)) continue;
    if (local[rel] && local[rel] === sha) same.push(rel);
    else toDownload.push(rel);
  }
  const extra = Object.keys(local).filter((rel) => !remote[rel] && !skip.has(rel));
  return {
    toDownload,
    same,
    /* 本地多出来的：云端已经删了（页面下线/改名），离线副本要跟着删，否则会看到旧页面 */
    extra,
    changed: toDownload.length > 0 || extra.length > 0,
  };
}

/** 给界面看的一句话 */
export function describeDiff(diff, remote) {
  if (!diff.changed) return `已是最新（${remote.count} 个文件 · ${remote.version || '未标注版本'}）`;
  const parts = [];
  if (diff.toDownload.length) parts.push(`要下 ${diff.toDownload.length} 个`);
  if (diff.extra.length) parts.push(`要删 ${diff.extra.length} 个`);
  return `${parts.join(' · ')}（云端 ${remote.count} 个文件 · ${remote.version || '未标注版本'}）`;
}
