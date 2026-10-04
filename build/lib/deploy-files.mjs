/**
 * 部署产物的文件规则（唯一来源）
 * ---------------------------------------------------
 * 「哪些文件会被上传」这件事以前只写在 prep-deploy.mjs 里，
 * 现在控制台的「与云端合并」也要按同一套规则算「本地全集」，
 * 所以抽到这里共用 —— 两处各写一份必然慢慢长歪。
 *
 * 规则本身没变：
 *   · jinsuper.rth1.xyz/  → dist/          （网站本体）
 *   · 项目根 asset/        → dist/asset/     （后写入，覆盖同名，见 project.md §10.3）
 *   · EXCLUDE 里的名字在**任意层级**都跳过
 *   · prune 时 dist/.git 整个跳过，根部 CNAME / .nojekyll / .gitignore 保留
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 永远不进部署产物的名字 */
export const EXCLUDE = new Set([
  '.git', '.gitignore', '.env', '.env.local', '.NEWTHINGS',
  'node_modules', '.npm-cache', 'build', 'dist', '.github',
  '.vscode', '.idea', 'package.json', 'package-lock.json',
  'rth-host.json', 'rth-sites.json', '.newthings-filelist.txt',
  /* 发布控制台是本地工具，和 build/ 一样不该被上传 */
  'console',
  /* TUI 的日志目录（build/ 的工具产物，不是站点内容） */
  '.deploy-logs',
]);

/** dist 根部要保住的手工文件（GitHub Pages 的配置，不属于源站内容） */
export const KEEP_ROOT = new Set(['CNAME', '.nojekyll', '.gitignore']);

/** 上次组装「真正变了什么」的清单文件（在项目根，不在 dist 里） */
export const CHANGED_FILE = '.deploy-changed.txt';

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 内容一样就不动（增量部署的关键：别刷新时间戳） */
export function sameAs(fileAbs, buf) {
  try {
    return sha256(fs.readFileSync(fileAbs)) === sha256(buf);
  } catch {
    return false;
  }
}

/**
 * 算出「这次会上传的文件」：dist 相对路径 → 磁盘绝对路径。
 * 和 prep-deploy 的镜像顺序一致：站点本体先，项目根 asset/ 后（同名后者胜）。
 * @param {string} siteRootAbs
 * @param {string} assetDirAbs 项目根 asset/（可以不存在）
 * @returns {Map<string,string>}
 */
export function uploadSet(siteRootAbs, assetDirAbs) {
  const out = new Map();
  collect(siteRootAbs, '', out);
  if (assetDirAbs && fs.existsSync(assetDirAbs)) collect(assetDirAbs, 'asset', out);
  return out;
}

function collect(dirAbs, rel, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const childRel = rel ? rel + '/' + entry.name : entry.name;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) { collect(abs, childRel, out); continue; }
    if (!entry.isFile()) continue;
    out.set(childRel, abs);
  }
}

/**
 * 把源站镜像进 dist/（增量 + 清理）。
 * 行为与旧版 prep-deploy.mjs 逐条对齐，只是输出交给调用方。
 * @returns {{added:number,updated:number,identical:number,changed:string[],pruned:string[]}}
 */
export function mirrorInto(distDirAbs, { siteRootAbs, assetDirAbs, onFile = null }) {
  let added = 0;
  let updated = 0;
  let identical = 0;
  const changed = [];
  const written = new Set();

  const mirror = (srcDirAbs, dstRel) => {
    if (!fs.existsSync(srcDirAbs)) return;
    for (const entry of fs.readdirSync(srcDirAbs, { withFileTypes: true })) {
      if (EXCLUDE.has(entry.name)) continue;
      const srcAbs = path.join(srcDirAbs, entry.name);
      const rel = dstRel ? dstRel + '/' + entry.name : entry.name;
      const dstAbs = path.join(distDirAbs, rel.split('/').join(path.sep));

      if (entry.isDirectory()) {
        fs.mkdirSync(dstAbs, { recursive: true });
        mirror(srcAbs, rel);
        continue;
      }
      if (!entry.isFile()) continue;

      written.add(rel);
      const buf = fs.readFileSync(srcAbs);
      if (fs.existsSync(dstAbs)) {
        if (sameAs(dstAbs, buf)) { identical++; if (onFile) onFile(rel, 'same'); continue; }
        updated++;
        changed.push(rel);
        if (onFile) onFile(rel, 'updated');
      } else {
        added++;
        changed.push(rel);
        if (onFile) onFile(rel, 'added');
      }
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.writeFileSync(dstAbs, buf);
    }
  };

  const prune = (dirAbs, rel) => {
    const removed = [];
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      const childAbs = path.join(dirAbs, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        removed.push(...prune(childAbs, childRel));
        try {
          if (fs.readdirSync(childAbs).length === 0) fs.rmdirSync(childAbs);
        } catch { /* 非空或权限问题，留着无妨 */ }
        continue;
      }
      if (!entry.isFile()) continue;
      if (written.has(childRel)) continue;
      if (!rel && KEEP_ROOT.has(entry.name)) continue;
      fs.unlinkSync(childAbs);
      removed.push(childRel);
    }
    return removed;
  };

  fs.mkdirSync(distDirAbs, { recursive: true });
  mirror(siteRootAbs, '');
  if (assetDirAbs && fs.existsSync(assetDirAbs)) {
    fs.mkdirSync(path.join(distDirAbs, 'asset'), { recursive: true });
    mirror(assetDirAbs, 'asset');
  }

  const pruned = prune(distDirAbs, '');
  return { added, updated, identical, changed, pruned };
}

/** 数文件（跳过 dist/.git）：部署工具报的数要和核对的数一致 */
export function countFiles(dirAbs) {
  let n = 0;
  if (!fs.existsSync(dirAbs)) return 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dirAbs);
  return n;
}

/** 读上次组装留下的变更清单（没有或没变化就返回 []） */
export function readChangedFile(projectRootAbs, limit = 0) {
  const f = path.join(projectRootAbs, CHANGED_FILE);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(2).filter(Boolean);
  return limit > 0 ? lines.slice(0, limit) : lines;
}

/** 写变更清单；内容没变时**不要**覆盖（部署工具此刻用的正是上一次的组装结果） */
export function writeChangedFile(projectRootAbs, changed) {
  if (!changed.length) return false;
  fs.writeFileSync(
    path.join(projectRootAbs, CHANGED_FILE),
    `本次部署变化的文件（相对网站根）：\n\n${changed.join('\n')}\n`,
    'utf8',
  );
  return true;
}
