'use strict';
/**
 * src/sync.js —— 桌面版的跨网同步（学校那一侧）
 * ---------------------------------------------------------------
 * 学校那台机器只能上 Gitee，而且**不该让人登录任何账号**：令牌在打包时
 * 从家里的 .env 注进 `resources/sync-config.json`，装完即用。
 *
 * 它做两件事：
 *   取：把站点镜像里变化的文件拉到本机离线副本（<userData>/offline-site），
 *       下一次打开班级百宝箱就是最新内容（不需要重新打包 exe）；
 *   送：把作业/文件打成 tar.gz 传进 Gitee 收件箱，家里 `部署.cmd sync pull`
 *       就能拿到。
 *
 * 断网时：不上报错、不丢数据 —— 改动写进队列（<userData>/sync/queue/），
 * 恢复网络后「上传」一下就走。
 *
 * 实现全部复用 sync/lib（和 CLI / 控制台同一份），这里只是把它接到
 * 本机路径、本机设置和界面进度上。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSyncLib, bundledConfigFile } = require('./lib-path');

/* ─────────────────────────── 路径 ─────────────────────────── */

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAtomic(file, buf) {
  ensureDir(path.dirname(file));
  const tmp = file + '.part';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/* ─────────────────────── 本机设置（同步用） ─────────────────────── */

/**
 * 桌面版自己的同步设置：<userData>/sync-settings.json
 * 和浏览器的 settings.json（窗口位置/来源）分开存 —— 两件事互不干扰，
 * 也不会去动 origins.js 那份被单测钉住的默认值。
 */
function createSyncSettings(userDataDir) {
  const file = path.join(userDataDir, 'sync-settings.json');
  const DEFAULTS = {
    token: '',
    owner: '',
    repo: '',
    branch: '',
    inboxBranch: '',
    visibility: '',
    publicBase: '',
    autoCheck: true,
  };
  const load = () => ({ ...DEFAULTS, ...readJson(file, {}) });
  const save = (patch) => {
    const next = { ...load(), ...(patch || {}) };
    ensureDir(userDataDir);
    writeAtomic(file, Buffer.from(JSON.stringify(next, null, '\t') + '\n', 'utf8'));
    return next;
  };
  return { file, load, save };
}

/* ─────────────────────────── 服务 ─────────────────────────── */

/**
 * @param {object} o
 *   userDataDir  本机可写目录
 *   siteRoot()   当前站点根（随包副本或已更新的离线副本）
 *   projectRoot  开发态的仓库根（读 sync.json / .env；打包后不用）
 *   log          可选日志
 */
function createSyncService({ userDataDir, siteRoot, projectRoot, log = () => {} }) {
  const settings = createSyncSettings(userDataDir);
  const offlineDir = path.join(userDataDir, 'offline-site');
  const queueDir = path.join(userDataDir, 'sync', 'queue');
  const manifestCache = path.join(userDataDir, 'sync', 'site-manifest.json');
  const device = (() => {
    try {
      return `${os.hostname()}（${process.platform === 'win32' ? 'Windows' : process.platform}）`;
    } catch {
      return '设备';
    }
  })();

  /** 配置来源：界面里填的 > 随包带进来的 > 开发态仓库 */
  function rawConfig() {
    const local = settings.load();
    const bundled = readJson(bundledConfigFile(), null);
    const base = bundled && typeof bundled === 'object' ? bundled : {};
    const gitee = { ...(base.gitee || {}) };
    for (const key of ['owner', 'repo', 'branch', 'inboxBranch', 'visibility', 'publicBase']) {
      if (local[key]) gitee[key] = local[key];
    }
    const cfg = { ...base, gitee, provider: base.provider || 'gitee' };
    const token = local.token || gitee.token || '';
    return { cfg, token };
  }

  async function context() {
    const { loadConfig, describeConfig } = await loadSyncLib('config.mjs');
    const { cfg, token } = rawConfig();
    const loaded = loadConfig({
      root: projectRoot || process.cwd(),
      config: Object.keys(cfg).length ? cfg : null,
      token,
    });
    const config = loaded.config;
    const problems = loaded.problems.slice();
    const { createTransport } = await loadSyncLib('transport.mjs');
    let transport = null;
    let error = '';
    if (!problems.length) {
      try {
        transport = createTransport(config, { log });
      } catch (e) {
        error = e.message;
      }
    }
    return {
      config,
      problems,
      error,
      transport,
      channel: problems.length ? '还没配好' : describeConfig(config),
      file: settings.file,
      settingsFile: settings.file,
    };
  }

  /** 本地站点根：优先已更新的离线副本，其次随包副本 */
  function localRoot() {
    const updated = path.join(offlineDir, 'index.html');
    if (fs.existsSync(updated)) return offlineDir;
    return siteRoot();
  }

  async function manifestTools() {
    return loadSyncLib('manifest.mjs');
  }

  /** 本地站点清单（带缓存：站点根没变、文件数一样就用缓存 — 758 个文件的 sha 不必每次重算） */
  async function localManifest() {
    const { scanDir } = await manifestTools();
    const root = localRoot();
    const cached = readJson(manifestCache, null);
    let stamp = '';
    try {
      stamp = `${root}|${fs.statSync(root).mtimeMs}`;
    } catch {
      stamp = root;
    }
    if (cached && cached.stamp === stamp && cached.files) return { root, manifest: cached };
    const { files, count, bytes } = scanDir(root);
    const manifest = { root, stamp, files, count, bytes, at: new Date().toISOString() };
    try {
      writeAtomic(manifestCache, Buffer.from(JSON.stringify(manifest), 'utf8'));
    } catch {
      /* 缓存写不进去不算错 */
    }
    return { root, manifest };
  }

  /** 队列里有多少东西等着上传 */
  function queueList() {
    const out = [];
    let stamps = [];
    try {
      stamps = fs.readdirSync(queueDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return out;
    }
    for (const stamp of stamps.sort()) {
      const meta = readJson(path.join(queueDir, stamp, '_queue.json'), null);
      const files = (meta && meta.files) || [];
      out.push({ stamp, root: (meta && meta.root) || 'misc', files, createdAt: (meta && meta.createdAt) || '' });
    }
    return out;
  }

  /**
   * 看看云端和本地差多少（不下载）。
   * @returns {Promise<object>}
   */
  async function state() {
    const ctx = await context();
    const { root, manifest } = await localManifest();
    const out = {
      ready: !ctx.problems.length && !!ctx.transport,
      channel: ctx.channel,
      problems: ctx.problems,
      error: ctx.error,
      settings: { ...settings.load() },
      settingsFile: settings.file,
      localRoot: root,
      offlineDir,
      local: { count: manifest.count, bytes: manifest.bytes || 0 },
      cloud: null,
      diff: null,
      queue: queueList(),
      device,
    };
    if (!out.ready) return out;
    try {
      const { cloudManifest } = await loadSyncLib('state.mjs');
      const cloud = await cloudManifest(ctx.transport, ctx.transport.branch || ctx.config.gitee.branch);
      out.cloud = cloud
        ? { version: cloud.version || '', count: cloud.count || 0, builtAt: cloud.builtAt || '' }
        : null;
      if (cloud && cloud.files) {
        const { diffManifests } = await manifestTools();
        const diff = diffManifests(manifest.files, cloud.files);
        out.diff = { toDownload: diff.toDownload.length, extra: diff.extra.length, changed: diff.changed };
      }
    } catch (e) {
      out.ready = false;
      out.error = e.message;
    }
    return out;
  }

  /**
   * 更新本机离线副本：第一次先把随包那份整树复制过来（保证是完整的一份），
   * 之后只下变化的文件、删掉云端已经没有的文件。
   */
  async function updateSite({ onProgress = () => {} } = {}) {
    const ctx = await context();
    if (ctx.problems.length) throw new Error(ctx.problems.join('；'));
    if (!ctx.transport) throw new Error(ctx.error || '通道没建起来');

    const { scanDir, diffManifests } = await manifestTools();
    const { cloudManifest } = await loadSyncLib('state.mjs');
    const branch = ctx.transport.branch || ctx.config.gitee.branch;
    const cloud = await cloudManifest(ctx.transport, branch);
    if (!cloud || !cloud.files) {
      return { ok: false, reason: '云端还没有镜像清单（家里要先跑一次 `部署.cmd sync push`）' };
    }

    /* ① 第一次：把当前站点根整树复制成可写的离线副本 */
    const seededNow = !fs.existsSync(path.join(offlineDir, 'index.html'));
    if (seededNow) {
      const src = siteRoot();
      const files = scanDir(src).files;
      let i = 0;
      for (const rel of Object.keys(files)) {
        const from = path.join(src, rel.split('/').join(path.sep));
        const to = path.join(offlineDir, rel.split('/').join(path.sep));
        try {
          writeAtomic(to, fs.readFileSync(from));
        } catch (e) {
          log(`复制 ${rel} 失败：${e.message}`);
        }
        i++;
        if (i % 50 === 0) onProgress({ phase: 'seed', done: i, total: Object.keys(files).length });
      }
    }

    /* ② 只下变化的文件 */
    const local = scanDir(offlineDir);
    const diff = diffManifests(local.files, cloud.files);
    let done = 0;
    for (const rel of diff.toDownload) {
      const buf = await ctx.transport.get(rel, { branch });
      writeAtomic(path.join(offlineDir, rel.split('/').join(path.sep)), buf);
      done++;
      if (done % 5 === 0 || done === diff.toDownload.length) {
        onProgress({ phase: 'download', done, total: diff.toDownload.length, rel });
      }
    }
    /* ③ 云端删过的，本地也删（否则会看到已经下线的旧页面） */
    for (const rel of diff.extra) {
      try {
        fs.unlinkSync(path.join(offlineDir, rel.split('/').join(path.sep)));
      } catch {
        /* 删不掉就算了 */
      }
    }
    /* 缓存作废：下次重新算一份 */
    try {
      fs.unlinkSync(manifestCache);
    } catch {
      /* 没有就算了 */
    }
    return {
      ok: true,
      seeded: seededNow,
      downloaded: diff.toDownload.length,
      deleted: diff.extra.length,
      version: cloud.version || '',
      count: cloud.count || 0,
    };
  }

  /**
   * 上传一批文件到收件箱。
   * @param {object} o { root, files:[绝对路径…], stamp, onProgress }
   */
  async function upload({ root = 'misc', files = [], stamp = '', onProgress = () => {} } = {}) {
    const ctx = await context();
    if (ctx.problems.length) throw new Error(ctx.problems.join('；'));
    if (!ctx.transport) throw new Error(ctx.error || '通道没建起来');
    const { pushInbox, collectDir, defaultStamp } = await loadSyncLib('inbox.mjs');

    const entries = [];
    for (const p of files) {
      const abs = path.resolve(String(p));
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) entries.push(...collectDir(abs));
      else entries.push({ name: path.basename(abs), data: fs.readFileSync(abs) });
    }
    if (!entries.length) throw new Error('没有可上传的文件');

    const theStamp = stamp || defaultStamp();
    onProgress({ phase: 'upload', done: 0, total: entries.length });
    const res = await pushInbox(ctx.transport, {
      root,
      entries,
      stamp: theStamp,
      branch: ctx.transport.inboxBranch || ctx.config.gitee.inboxBranch,
      from: device,
    });
    onProgress({ phase: 'upload', done: entries.length, total: entries.length });
    return { ...res, root };
  }

  /** 断网时先把改动收进队列（不丢数据），恢复后 flush 一次就传上去 */
  function enqueue({ root = 'misc', files = [], stamp }) {
    const theStamp = stamp || String(Date.now());
    const dir = path.join(queueDir, theStamp, root);
    ensureDir(dir);
    const names = [];
    for (const p of files) {
      const abs = path.resolve(String(p));
      let stat = null;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const walk = (d, rel) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const sub = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) walk(path.join(d, e.name), sub);
            else {
              const target = path.join(dir, sub.split('/').join(path.sep));
              ensureDir(path.dirname(target));
              fs.copyFileSync(path.join(d, e.name), target);
              names.push(sub);
            }
          }
        };
        walk(abs, '');
        continue;
      }
      const target = path.join(dir, path.basename(abs));
      fs.copyFileSync(abs, target);
      names.push(path.basename(abs));
    }
    writeAtomic(path.join(queueDir, theStamp, '_queue.json'), Buffer.from(JSON.stringify({
      stamp: theStamp, root, createdAt: new Date().toISOString(), files: names,
    }, null, '\t') + '\n', 'utf8'));
    return { stamp: theStamp, root, files: names };
  }

  /** 把队列里的东西都传上去 */
  async function flushQueue({ onProgress = () => {} } = {}) {
    const items = queueList();
    const done = [];
    for (const item of items) {
      const dir = path.join(queueDir, item.stamp, item.root);
      if (!fs.existsSync(dir)) continue;
      const res = await upload({ root: item.root, files: [dir], stamp: item.stamp, onProgress });
      try {
        fs.rmSync(path.join(queueDir, item.stamp), { recursive: true, force: true });
      } catch {
        /* 删不掉下次还会传一次，无害 */
      }
      done.push({ stamp: item.stamp, root: item.root, count: res.count });
    }
    return done;
  }

  return {
    settings, settingsFile: settings.file,
    offlineDir, queueDir,
    state, updateSite, upload, enqueue, flushQueue, queueList,
    localRoot, context,
  };
}

module.exports = { createSyncService, createSyncSettings };
