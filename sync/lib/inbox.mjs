/**
 * 收件箱（学校 → 家）
 * ---------------------------------------------------
 * 学校那边（桌面版的「作业编辑器」/「同步」面板）把选中的文件打成
 * **一个 tar.gz**，写到 Gitee 的收件箱分支：
 *
 *   inbox/<时间戳>/<root>.tar.gz      root ∈ hwk | site | misc
 *   inbox/<时间戳>/_manifest.json     谁传的、什么时候、里面有哪些文件、sha256
 *
 * 规矩：**描述文件最后写** —— 家里只认有 `_manifest.json` 的时间戳，所以
 * 传到一半断线不会产生「半个收件箱」。
 *
 * 家里 `sync pull` 把它下到 `sync/inbox/<时间戳>/`（不直接动仓库），
 * `sync apply` 再按 roots 映射落进仓库，默认先 dry-run 打一份 diff。
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './hash.mjs';
import { packTarGz, unpackTarGz, safeRel } from './tar.mjs';
import { putChunked, getChunked } from './transport.mjs';
import { INBOX_DIR, INBOX_MANIFEST, INBOX_ROOTS } from './config.mjs';

/** 时间戳目录名：20261015-2218（本地时间，人看得懂） */
export function defaultStamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 把一个目录下（或一批文件）读成 tar 条目 */
export function collectFiles(baseDirAbs, rels) {
  const out = [];
  for (const rel of rels) {
    const safe = safeRel(rel);
    const abs = path.join(baseDirAbs, safe.split('/').join(path.sep));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    out.push({ name: safe, data: fs.readFileSync(abs) });
  }
  return out;
}

export function collectDir(dirAbs, { rel = '' } = {}) {
  const out = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      const name = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(abs, name);
      else if (e.isFile()) out.push({ name, data: fs.readFileSync(abs) });
    }
  };
  if (fs.existsSync(dirAbs)) walk(dirAbs, rel);
  return out;
}

/**
 * 上传一批文件到收件箱。
 * @param {object} t      通道（transport.mjs）
 * @param {object} o      { root, entries:[{name,data}], stamp, from, branch }
 */
export async function pushInbox(t, o) {
  const root = INBOX_ROOTS.includes(o.root) ? o.root : 'misc';
  const stamp = o.stamp || defaultStamp();
  const entries = (o.entries || []).filter((e) => e && e.name && e.data);
  if (!entries.length) throw new Error('没有要上传的文件');

  const dir = `${INBOX_DIR}/${stamp}`;
  const tarball = packTarGz(entries.map((e) => ({ name: safeRel(e.name), data: e.data })));
  const key = `${dir}/${root}.tar.gz`;
  const info = await putChunked(t, key, tarball, {
    branch: o.branch,
    message: `inbox(${root}) ${stamp}：${entries.length} 个文件`,
  });

  const manifest = {
    v: 1,
    stamp,
    root,
    from: String(o.from || '未知设备'),
    createdAt: new Date().toISOString(),
    files: entries.map((e) => ({ path: safeRel(e.name), size: e.data.length, sha256: sha256(e.data) })).sort((a, b) => a.path.localeCompare(b.path)),
    pack: { key, size: tarball.length, sha256: sha256(tarball), parts: info.parts },
  };
  /* 描述文件最后写：家里只认它 */
  await t.put(`${dir}/${INBOX_MANIFEST}`, Buffer.from(JSON.stringify(manifest, null, '\t') + '\n'), {
    branch: o.branch,
    message: `inbox(${root}) ${stamp}：清单`,
  });
  return { stamp, root, key, dir, count: entries.length, size: tarball.length, parts: info.parts };
}

/** 列出收件箱里**完整**的几份（按时间戳倒序） */
export async function listInbox(t, { branch } = {}) {
  const dirs = (await t.list(INBOX_DIR, { branch })).filter((d) => d.type === 'dir');
  const out = [];
  for (const d of dirs.sort((a, b) => b.name.localeCompare(a.name))) {
    let manifest;
    try {
      manifest = JSON.parse((await t.get(`${d.path}/${INBOX_MANIFEST}`, { branch })).toString('utf8'));
    } catch {
      out.push({ stamp: d.name, dir: d.path, complete: false, reason: '还没有 _manifest.json（在传或传挂了）' });
      continue;
    }
    out.push({
      stamp: manifest.stamp || d.name,
      dir: d.path,
      complete: true,
      root: manifest.root,
      from: manifest.from,
      createdAt: manifest.createdAt,
      files: manifest.files || [],
      pack: manifest.pack || null,
    });
  }
  return out;
}

/** 拉一份收件箱到本地目录（<into>/<stamp>/<root>/…） */
export async function pullInbox(t, { into, stamp, branch, log = () => {} } = {}) {
  const list = await listInbox(t, { branch });
  const want = stamp ? list.filter((x) => x.stamp === stamp) : list;
  if (!want.length) return [];
  const done = [];
  for (const item of want) {
    if (!item.complete) {
      log(`跳过 ${item.stamp}：${item.reason}`);
      continue;
    }
    const dir = path.join(into, item.stamp);
    fs.mkdirSync(dir, { recursive: true });
    const key = item.pack ? item.pack.key : `${item.dir}/${item.root}.tar.gz`;
    const buf = await getChunked(t, key, { branch });
    if (item.pack && item.pack.sha256 && sha256(buf) !== item.pack.sha256) {
      throw new Error(`${item.stamp} 的包校验不过（下载可能断了）：${key}`);
    }
    const files = unpackTarGz(buf);
    for (const f of files) {
      const rel = safeRel(`${item.root || 'misc'}/${f.name}`);
      const abs = path.join(dir, rel.split('/').join(path.sep));
      if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error(`解包越界：${rel}`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = abs + '.part';
      fs.writeFileSync(tmp, f.data);
      fs.renameSync(tmp, abs);
    }
    /* 把清单也留一份，apply 时不用再联网 */
    fs.writeFileSync(path.join(dir, INBOX_MANIFEST), JSON.stringify(item, null, '\t') + '\n', 'utf8');
    done.push({ stamp: item.stamp, dir, count: files.length, root: item.root });
  }
  return done;
}

/**
 * 把已拉下来的收件箱按 roots 映射落进仓库。
 * @param {object} o
 *   stampDir   sync/inbox/<时间戳>/
 *   roots      { hwk:'jinsuper.rth1.xyz/class/data/hwk', … }
 *   repoRoot   仓库根
 *   dryRun     true 只算不写（默认 false，由命令决定）
 * @returns {{actions:Array<{root,from,to,state}>, counts}}
 */
export function applyInbox({ stampDir, roots, repoRoot, dryRun = true, only = null }) {
  const actions = [];
  const counts = { added: 0, updated: 0, identical: 0, skipped: 0 };
  if (!fs.existsSync(stampDir)) throw new Error(`没有这份收件箱：${stampDir}`);

  for (const root of Object.keys(roots)) {
    const from = path.join(stampDir, root);
    if (!fs.existsSync(from)) continue;
    const target = path.resolve(repoRoot, roots[root]);
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        const sub = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { walk(abs, sub); continue; }
        if (only && !sub.includes(only)) continue;
        const dest = path.join(target, sub.split('/').join(path.sep));
        const srcBuf = fs.readFileSync(abs);
        const state = !fs.existsSync(dest) ? 'added'
          : (sha256(fs.readFileSync(dest)) === sha256(srcBuf) ? 'identical' : 'updated');
        counts[state]++;
        actions.push({ root, rel: sub, from: abs, to: dest, state });
        if (!dryRun && state !== 'identical') {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const tmp = dest + '.part';
          fs.writeFileSync(tmp, srcBuf);
          fs.renameSync(tmp, dest);
        }
      }
    };
    walk(from, '');
  }
  return { actions, counts };
}
