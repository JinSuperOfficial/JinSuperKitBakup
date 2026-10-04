/**
 * 本地 ↔ 云端：比对、拉取、部署前预检
 * ---------------------------------------------------
 * 三方比较模型（这是整个功能的核心）：
 *
 *   local = 本机站点源树（jinsuper.rth1.xyz/ + 项目根 asset/，规则见 build/lib/deploy-files.mjs）
 *   base  = dist/ 里的那份（＝**上次部署**出去的快照，push-github 也认它）
 *   cloud = 线上真正躺着的那份
 *
 *   local==base && cloud!=base   → 云端改了     → 建议“取回云端”
 *   cloud==base && local!=base   → 本地改了     → 建议“部署”
 *   local==cloud                 → 一致
 *   三个都不同                    → 冲突（人工看差异再决定）
 *
 * 两个来源：
 *   · github   —— dist/.git 的 origin/main，一条 ls-tree 就有全部路径+哈希，
 *                 精确、能列出「云端有本地没有」的文件（首选）
 *   · retinbox —— 热铁盒**没有列目录接口**（官方文档只有 init/deploy/watch），
 *                 所以候选集 = 本地全集 ∪ 线上 sk.json / sitemap.xml /
 *                 docs/info/site-index.js 里引用到的路径 ∪ dist 历史上删过的路径。
 *                 枚举不到的「没登记又没人引用的孤儿文件」会如实写在 limits 里。
 *
 * 所有写盘都先备份到 <stateDir>/backups/<时间戳>/，并且只允许落在站点根或
 * 项目根 asset/ 里 —— 绝不碰 dist/。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS, isFile, pDir, siteRoot, stateDir, workspaceRoot,
} from './paths.mjs';
import { uploadSet, sha256 } from '../../build/lib/deploy-files.mjs';
import {
  distDir, ensureRepo, fetchRemote, git, hasRepo, remoteFile, remoteTree, everDeletedPaths,
} from '../../build/lib/git-dist.mjs';
import { BROWSER_UA, checkDomains, fetchText } from '../../build/lib/domain-check.mjs';

/* ═══════════════════════════════════════════════════
   站点配置（域名从 rth-sites.json 来）
   ═══════════════════════════════════════════════════ */

export function sites() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'rth-sites.json'), 'utf8'));
    return (j.sites || [])
      .map((s) => (typeof s === 'string' ? { site: s, domains: [] } : s))
      .filter((s) => s && s.site);
  } catch {
    return [];
  }
}

export function domains() {
  const out = [];
  for (const s of sites()) for (const d of s.domains || []) out.push(d);
  return out;
}

/** 界面里选域名用（控制台「同步与合并」「对照」两个面板都读它） */
export function domainOptions() {
  return { domains: domains(), sites: sites().map((s) => s.site) };
}

function pickDomain(asked) {
  const list = domains();
  if (asked && list.includes(asked)) return asked;
  /* 默认挑 www 优先（裸域常有证书问题），没有就用第一个 */
  return list.find((d) => d.startsWith('www.')) || list[0] || null;
}

/* ═══════════════════════════════════════════════════
   local / base 两侧
   ═══════════════════════════════════════════════════ */

/** 本地源树 → Map<站点相对路径, 绝对路径>（与 prep-deploy 的上传集一致） */
export function localFiles() {
  return uploadSet(siteRoot, path.join(workspaceRoot, 'asset'));
}

/** dist/（上次部署的快照）→ Map<路径, {hash, abs}>；没有 dist 就返回空 */
export function baseFiles() {
  const out = new Map();
  if (!fs.existsSync(distDir)) return out;
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const child = rel ? rel + '/' + e.name : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) { walk(childAbs, child); continue; }
      if (!e.isFile()) continue;
      out.set(child, { abs: childAbs, hash: sha256(fs.readFileSync(childAbs)) });
    }
  };
  walk(distDir, '');
  return out;
}

/* ═══════════════════════════════════════════════════
   cloud 侧：GitHub
   ═══════════════════════════════════════════════════ */

async function cloudGithub() {
  const notes = [];
  try {
    ensureRepo();
  } catch (e) {
    const err = new Error('准备 dist/.git 失败：' + e.message);
    err.status = 500;
    throw err;
  }
  const fetched = fetchRemote();
  if (!fetched.ok && !hasRepo()) {
    const err = new Error('读不到 GitHub 上的内容：' + fetched.error);
    err.status = 502;
    throw err;
  }
  if (!fetched.ok) notes.push('这次没能 fetch 到远程，用的是本地已有的 origin/main 快照：' + fetched.error);

  const tree = remoteTree();
  const out = new Map();
  for (const [rel, info] of tree) out.set(rel, { hash: info.hash, size: info.size });
  return { files: out, notes, kind: 'github' };
}

/* ═══════════════════════════════════════════════════
   cloud 侧：热铁盒（只能探测）
   ═══════════════════════════════════════════════════ */

async function cloudRetinbox(domain, { concurrency = 6 } = {}) {
  const notes = [];
  const base = `https://${domain}`;

  /* ① 候选：本地全集 + 根 asset（同名以项目根那份为准，和 prep 的顺序一致） */
  const candidates = new Set(localFiles().keys());

  /* ② 线上清单 / 入口页里引用到的路径：这是「云端有、本地没有」唯一的线索来源 */
  const referenced = new Set();
  const addRef = (p) => {
    const clean = String(p || '').replace(/^[/\\]+/, '').split('?')[0].split('#')[0];
    if (clean && !clean.endsWith('/')) referenced.add(clean);
  };

  const skRes = await fetchText(`${base}/sk.json`, 12000);
  if (skRes.ok) {
    try {
      const sk = JSON.parse(skRes.body);
      for (const g of Object.values(sk || {})) {
        if (!g || typeof g !== 'object') continue;
        for (const p of Object.values(g)) {
          addRef(p);
          /* 登记的是相对 /p 的写法，线上路径要补 p/ */
          const s = String(p || '').replace(/^[/\\]+/, '');
          if (!/^\.\.\//.test(s)) addRef(s.startsWith('p/') ? s : 'p/' + s);
        }
      }
    } catch { notes.push('线上 sk.json 解析不了，跳过清单引用这一路'); }
  } else {
    notes.push(`线上 sk.json 没取到（${skRes.reason || skRes.status}），清单引用这一路结果会偏少`);
  }

  const smRes = await fetchText(`${base}/sitemap.xml`, 12000);
  if (smRes.ok) {
    for (const m of String(smRes.body).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      try { addRef(new URL(m[1]).pathname); } catch { /* 不是 URL 就算了 */ }
    }
  }

  const siRes = await fetchText(`${base}/docs/info/site-index.js`, 12000);
  if (siRes.ok) {
    const m = /\{[\s\S]*\}/.exec(String(siRes.body));
    if (m) {
      try {
        const walk = (node, prefix) => {
          const p = prefix + node.name;
          if (node.dir) for (const c of node.children || []) walk(c, p);
          else addRef(p);
        };
        walk(JSON.parse(m[0]), '/');
      } catch { notes.push('线上 site-index.js 解析不了，跳过它引用的路径'); }
    }
  }

  /* ③ dist 历史上删过的路径：那些文件很可能还在线上（本地已经没有记录了） */
  let historical = [];
  try { historical = everDeletedPaths(300); } catch { historical = []; }

  for (const p of referenced) candidates.add(p);
  for (const p of historical) candidates.add(p);

  /* ④ 逐个探测（HEAD 拿 Content-Length 太不可靠，直接 GET 比字节；并发 6） */
  const list = [...candidates].filter((p) => !p.includes('..'));
  const files = new Map();
  const errors = [];
  let i = 0;

  async function worker() {
    while (i < list.length) {
      const rel = list[i++];
      try {
        const res = await fetch(`${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, {
          redirect: 'follow',
          headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
        });
        if (!res.ok) continue;                       /* 404：线上没有这个文件 */
        const buf = Buffer.from(await res.arrayBuffer());
        files.set(rel, { hash: sha256(buf), size: buf.length });
      } catch (e) {
        if (errors.length < 5) errors.push(`${rel}：${(e && e.message) || e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));

  if (errors.length) notes.push(`有请求出错（最多记 5 条）：${errors.join('；')}`);
  notes.push(`热铁盒没有列目录接口，这次比了 ${list.length} 个候选路径：本地全集 + 线上 sk.json/sitemap/site-index 引用 + dist 历史删除记录。`);
  notes.push('没被任何清单引用、也不在本地和历史记录里的云端孤儿文件，这一路**枚举不到**（部署会把它删掉，所以预检里请留意）。');

  return { files, notes, kind: 'retinbox', domain, probed: list.length };
}

/* ═══════════════════════════════════════════════════
   比对
   ═══════════════════════════════════════════════════ */

function classify(localHash, baseHash, cloudHash) {
  const L = localHash || null;
  const B = baseHash || null;
  const C = cloudHash || null;
  if (L && !C && !B) return 'local-new';
  if (!L && C && !B) return 'cloud-only';
  if (!L && C && B) return 'cloud-only';
  if (L && !C && B) return 'local-deleted';
  if (L && C && L === C) return 'same';
  if (L && C && B) {
    if (L === B) return 'cloud-changed';
    if (C === B) return 'local-changed';
    return 'conflict';
  }
  if (L && C && !B) return 'conflict';           /* 没有基准，两边都有但不同 */
  return 'same';
}

export const STATUS_TEXT = {
  same: '一致',
  'cloud-changed': '云端更新',
  'local-changed': '本地更新',
  'cloud-only': '云端独有',
  'local-new': '本地新增',
  'local-deleted': '本地已删（云端还在）',
  conflict: '两边都改了',
};

/**
 * 比对三方。返回差异表 + 统计 + 基准信息 + 限制说明。
 * @param {{source:'github'|'retinbox', domain?:string}} o
 */
export async function scan({ source = 'github', domain = null } = {}) {
  const local = localFiles();
  const base = baseFiles();
  const chosenDomain = source === 'retinbox' ? pickDomain(domain) : null;
  if (source === 'retinbox' && !chosenDomain) {
    const e = new Error('rth-sites.json 里没有可用的域名，没法比对热铁盒');
    e.status = 400;
    throw e;
  }

  const cloud = source === 'github' ? await cloudGithub() : await cloudRetinbox(chosenDomain);

  const localHash = new Map();
  for (const [rel, abs] of local) localHash.set(rel, sha256(fs.readFileSync(abs)));

  const paths = new Set([...local.keys(), ...base.keys(), ...cloud.files.keys()]);
  const diffs = [];
  for (const rel of [...paths].sort()) {
    const lh = localHash.get(rel) || null;
    const bh = base.has(rel) ? base.get(rel).hash : null;
    const ch = cloud.files.has(rel) ? cloud.files.get(rel).hash : null;
    const status = classify(lh, bh, ch);
    if (status === 'same' && lh && ch && lh === ch) continue;      /* 一致的不列，省得刷屏 */
    diffs.push({
      path: rel,
      status,
      localBytes: local.has(rel) ? fs.statSync(local.get(rel)).size : null,
      cloudBytes: cloud.files.has(rel) ? cloud.files.get(rel).size : null,
      baseBytes: base.has(rel) ? (() => { try { return fs.statSync(base.get(rel).abs).size; } catch { return null; } })() : null,
    });
  }

  const counts = diffs.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
  return {
    source,
    domain: chosenDomain,
    cloudKind: cloud.kind,
    base: {
      kind: 'dist',
      exists: fs.existsSync(distDir),
      files: base.size,
      at: (() => {
        try {
          const r = git(['log', '-1', '--format=%cI']);
          return r.status === 0 ? r.stdout.trim() : null;
        } catch { return null; }
      })(),
    },
    counts: { local: local.size, base: base.size, cloud: cloud.files.size, ...counts },
    diffs,
    notes: cloud.notes || [],
    limits: source === 'retinbox' ? [
      '热铁盒没有列目录/下载接口（官方文档只有 init / deploy / watch），所以「云端全集」是推导出来的，不是问出来的。',
      '推导不到的：从没被清单/入口页引用、也不在本地与 dist 历史里的孤儿文件。',
      '部署（镜像上传）会把云端多出来的文件删掉 —— 预检面板会列出能看到的那些。',
    ] : [
      'GitHub 侧以 dist/.git 的 origin/main 为准（push-github 维护的那个仓库）。',
      '这里比的是「仓库里的内容」，Pages 生效可能有几十秒延迟。',
    ],
  };
}

/* ═══════════════════════════════════════════════════
   取单个文件的内容 + 行级差异
   ═══════════════════════════════════════════════════ */

async function fetchCloudBuffer(source, domain, rel) {
  if (source === 'github') return remoteFile(rel);
  const res = await fetch(`https://${domain}/${rel.split('/').map(encodeURIComponent).join('/')}`, {
    redirect: 'follow',
    headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
  });
  if (!res.ok) {
    const e = new Error(`线上没有这个文件（HTTP ${res.status}）`);
    e.status = 404;
    throw e;
  }
  return Buffer.from(await res.arrayBuffer());
}

const TEXTY = /\.(md|markdown|mdown|txt|json|js|mjs|cjs|css|html?|svg|php|ya?ml|xml|csv)$/i;

/** 简易行级 diff（LCS），给界面看个大概；大文件只给摘要 */
export function lineDiff(a, b, { maxLines = 400 } = {}) {
  const A = String(a).split(/\r?\n/);
  const B = String(b).split(/\r?\n/);
  const n = A.length;
  const m = B.length;
  if (n * m > 4_000_000) {
    return { tooBig: true, summary: `行数 ${n} → ${m}（太大，没做逐行比较）`, hunks: [] };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; continue; }
    if (dp[i + 1][j] >= dp[i][j + 1]) { hunks.push({ type: 'del', line: i + 1, text: A[i] }); i++; }
    else { hunks.push({ type: 'add', line: j + 1, text: B[j] }); j++; }
    if (hunks.length >= maxLines) break;
  }
  while (i < n && hunks.length < maxLines) { hunks.push({ type: 'del', line: i + 1, text: A[i] }); i++; }
  while (j < m && hunks.length < maxLines) { hunks.push({ type: 'add', line: j + 1, text: B[j] }); j++; }
  return {
    tooBig: false,
    summary: `${n} 行 → ${m} 行，差异 ${hunks.length} 处${hunks.length >= maxLines ? '（已截断）' : ''}`,
    hunks,
  };
}

/** 看某个文件的差异（云端 vs 本地） */
export async function diffFile({ source = 'github', domain = null, path: rel } = {}) {
  if (!rel) { const e = new Error('要给路径'); e.status = 400; throw e; }
  const chosen = source === 'retinbox' ? pickDomain(domain) : null;
  const local = localFiles();
  const localAbs = local.get(rel);

  if (!TEXTY.test(rel)) {
    return {
      path: rel, binary: true,
      summary: `这是二进制/素材文件，只能比大小：本地 ${localAbs ? fs.statSync(localAbs).size : '无'} B · 云端 ?`,
      hunks: [],
    };
  }

  let cloudBuf = null;
  try { cloudBuf = await fetchCloudBuffer(source, chosen, rel); }
  catch (e) { return { path: rel, binary: false, missing: true, summary: '取不到云端内容：' + e.message, hunks: [] }; }

  const localText = localAbs && isFile(localAbs) ? fs.readFileSync(localAbs, 'utf8') : '';
  const d = lineDiff(localText, cloudBuf.toString('utf8'));
  return { path: rel, binary: false, ...d, cloudBytes: cloudBuf.length, localBytes: localAbs && isFile(localAbs) ? fs.statSync(localAbs).size : 0 };
}

/* ═══════════════════════════════════════════════════
   拉取：云端 → 本地（先备份）
   ═══════════════════════════════════════════════════ */

function backupTo(stateRoot, rel, abs) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(stateRoot, 'backups', stamp);
  const dest = path.join(dir, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
  return path.relative(stateRoot, dest).split(path.sep).join('/');
}

/**
 * 把云端文件写回本地。
 * 落点规则（和 prep-deploy 的镜像顺序对齐）：
 *   · 项目根 asset/ 里已有同名 → 写项目根那份（它会在组装时覆盖站点里的）
 *   · 否则写站点里对应位置
 * dist/ 一律拒绝。
 */
export async function pull({ source = 'github', domain = null, paths = [], force = false } = {}) {
  if (!paths.length) { const e = new Error('没有选中任何文件'); e.status = 400; throw e; }
  const chosen = source === 'retinbox' ? pickDomain(domain) : null;
  const local = localFiles();
  const base = baseFiles();
  const results = [];

  for (const rel of paths) {
    const clean = String(rel).replace(/^[/\\]+/, '');
    if (!clean || clean.includes('..') || clean.startsWith('dist/') || clean.startsWith('.git')) {
      results.push({ path: rel, ok: false, reason: '这个路径不允许写入' });
      continue;
    }

    /* 本地被改过、而云端也不是"上次部署那一份"时，必须显式 force */
    const localAbs = local.get(clean);
    if (localAbs && isFile(localAbs) && !force) {
      const lh = sha256(fs.readFileSync(localAbs));
      const bh = base.has(clean) ? base.get(clean).hash : null;
      if (bh && lh !== bh) {
        results.push({ path: clean, ok: false, reason: '本地这一份在上次部署之后改过，覆盖会丢改动（要覆盖请显式确认）' });
        continue;
      }
    }

    let buf;
    try { buf = await fetchCloudBuffer(source, chosen, clean); }
    catch (e) { results.push({ path: clean, ok: false, reason: '取不到云端内容：' + e.message }); continue; }

    /* 落点 */
    let destAbs;
    const inRootAsset = path.join(workspaceRoot, 'asset', clean.replace(/^asset\//, ''));
    if (clean.startsWith('asset/') && isFile(inRootAsset)) destAbs = inRootAsset;
    else destAbs = path.join(siteRoot, clean.split('/').join(path.sep));

    const insideSite = destAbs.startsWith(siteRoot + path.sep);
    const insideRootAsset = destAbs.startsWith(path.join(workspaceRoot, 'asset') + path.sep);
    if (!insideSite && !insideRootAsset) {
      results.push({ path: clean, ok: false, reason: '解析出来的落点越界了，已拒绝' });
      continue;
    }

    let backup = null;
    if (isFile(destAbs)) {
      try { backup = backupTo(stateDir, clean, destAbs); }
      catch (e) { results.push({ path: clean, ok: false, reason: '备份失败，没敢覆盖：' + e.message }); continue; }
    }
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, buf);
    results.push({
      path: clean,
      ok: true,
      bytes: buf.length,
      wrote: path.relative(workspaceRoot, destAbs).split(path.sep).join('/'),
      backup,
    });
  }

  return {
    ok: results.every((r) => r.ok),
    pulled: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/* ═══════════════════════════════════════════════════
   部署前预检
   ═══════════════════════════════════════════════════ */

export async function precheck({ source = 'github', domain = null } = {}) {
  const cmp = await scan({ source, domain });
  const byStatus = (s) => cmp.diffs.filter((d) => d.status === s);

  /* 会覆盖云端改动的文件：本地要发的这一份 ≠ 上次部署那一份，而云端又是第三份 */
  const overwrite = [
    ...byStatus('conflict'),
    ...byStatus('cloud-changed'),
  ].map((d) => ({ path: d.path, status: d.status }));

  /* 会被删掉的云端文件（能看到的那些） */
  const deleteOnCloud = [
    ...byStatus('cloud-only'),
    ...byStatus('local-deleted'),
  ].map((d) => ({ path: d.path, status: d.status }));

  /* 清单问题 */
  const { scanManifest } = await import('./manifest.mjs');
  const man = scanManifest();

  /* 域名 / 证书 */
  const domainList = source === 'retinbox' && cmp.domain ? [cmp.domain] : domains();
  let domainStatus = [];
  if (domainList.length) {
    try { domainStatus = await checkDomains(domainList); } catch { domainStatus = []; }
  }

  return {
    source,
    domain: cmp.domain,
    base: cmp.base,
    counts: cmp.counts,
    overwrite,
    deleteOnCloud,
    cloudOnly: byStatus('cloud-only').map((d) => d.path),
    manifest: { problems: man.problems, errors: man.problems.filter((p) => p.level === 'error').length },
    domains: domainStatus,
    limits: cmp.limits,
    notes: cmp.notes,
    ok: overwrite.length === 0 && man.problems.filter((p) => p.level === 'error').length === 0,
    siteFiles: localFiles().size,
  };
}
