'use strict';
/**
 * src/hwk-store.js —— 作业编辑器在本机的存储（**先落本地，再谈上云**）
 * ---------------------------------------------------------------
 * 学校那台机器上没有仓库、也常常没有网，所以作业先写进本机的 userData：
 *
 *   <userData>/hwk/index.json        目录（新的在前），形状和站点里那份一致
 *   <userData>/hwk/hwk-<id>.json     一天一份，字段/键序和站点里那份一模一样
 *   <userData>/hwk/.state.json       内部记账：哪些天还没同步、有没有导过基线
 *
 * 三件事保证「两边写出来的文件是同一份」：
 *   1. 归一/校验用 sync/lib/hwk-schema.mjs（页面、控制台、桌面版共用那一份）；
 *   2. 写文件用同一套 JSON 缩进（制表符 + 结尾换行），diff 才干净；
 *   3. 第一次打开时从随包的站点副本（resources/site/class/data/hwk）导一份
 *      **基线**进来（只导一次、只读源），所以打开就有历史可看。
 *
 * 同步：`snapshot()` 把当前所有改动复制到 `<userData>/sync/outbox/<时间戳>/hwk/`，
 * 这就是「先同步到本地」那一步 —— 上云是另一次动作，失败了本地快照还在。
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadSyncLib } = require('./lib-path');

let schemaPromise = null;
function schema() {
  if (!schemaPromise) schemaPromise = loadSyncLib('hwk-schema.mjs');
  return schemaPromise;
}

function writeAtomic(file, text) {
  const tmp = file + '.part';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * @param {object} o
 *   dir          本机存储目录（一般是 <userData>/hwk）
 *   baselineDir  随包站点里的 class/data/hwk（可以是空的/不存在）
 *   outboxDir    本地快照目录（一般是 <userData>/sync/outbox）
 */
function createHwkStore({ dir, baselineDir, outboxDir }) {
  const stateFile = path.join(dir, '.state.json');

  const readState = () => {
    const raw = readJson(stateFile, {});
    return {
      seeded: !!raw.seeded,
      dirty: Array.isArray(raw.dirty) ? raw.dirty.map(String) : [],
      lastSyncAt: String(raw.lastSyncAt || ''),
      lastSyncStamp: String(raw.lastSyncStamp || ''),
    };
  };

  const writeState = (next) => {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(stateFile, JSON.stringify(next, null, '\t') + '\n');
    return next;
  };

  const recordFile = (id) => path.join(dir, `hwk-${id}.json`);

  function listIds() {
    try {
      return fs.readdirSync(dir)
        .filter((n) => /^hwk-.+\.json$/.test(n))
        .map((n) => n.replace(/^hwk-/, '').replace(/\.json$/, ''))
        .sort();
    } catch {
      return [];
    }
  }

  function readIndex() {
    const raw = readJson(path.join(dir, 'index.json'), []);
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.entries) ? raw.entries : []);
    return list;
  }

  /** 第一次打开：把随包的基线导进来（只导一次），已经有记录就不动 */
  async function seed() {
    const s = await schema();
    const state = readState();
    if (state.seeded) return { seeded: false, reason: '已经导过' };
    if (listIds().length) {
      writeState({ ...state, seeded: true });
      return { seeded: false, reason: '本机已经有作业了' };
    }
    let count = 0;
    let index = [];
    try {
      const names = fs.readdirSync(baselineDir).filter((n) => /^hwk-.+\.json$/.test(n));
      for (const n of names) {
        const data = readJson(path.join(baselineDir, n), null);
        if (!data || typeof data !== 'object') continue;
        fs.mkdirSync(dir, { recursive: true });
        writeAtomic(path.join(dir, n), s.dumpJson(data));
        const id = n.replace(/^hwk-/, '').replace(/\.json$/, '');
        index = s.mergeIndex(index, {
          id,
          name: n,
          date: s.normalizeDate(data.date) || s.dateFromId(id),
          title: String(data.title || ''),
        });
        count++;
      }
      const baseIndex = readJson(path.join(baselineDir, 'index.json'), null);
      if (Array.isArray(baseIndex)) {
        for (const e of baseIndex) {
          const meta = s.normalizeEntry(e);
          if (meta && listIds().includes(meta.id)) index = s.mergeIndex(index, meta);
        }
      }
      if (count) writeAtomic(path.join(dir, 'index.json'), s.dumpJson(index));
    } catch {
      /* 没有随包副本（比如开发机上没构建）就当没有基线 */
    }
    writeState({ ...readState(), seeded: true });
    return { seeded: count > 0, count };
  }

  /** 列表：按日期倒序（页面 / 控制台同一套排序） */
  async function list() {
    const s = await schema();
    const state = readState();
    const index = readIndex().map((e) => s.normalizeEntry(e)).filter(Boolean);
    const known = new Set(index.map((e) => e.id));
    const records = index.map((e) => {
      const file = recordFile(e.id);
      let bytes = 0;
      try {
        bytes = fs.statSync(file).size;
      } catch {
        bytes = 0;
      }
      return { ...e, bytes, exists: bytes > 0 };
    });
    for (const id of listIds()) {
      if (known.has(id)) continue;
      let data = null;
      try {
        data = readJson(recordFile(id), null);
      } catch {
        data = null;
      }
      records.push(s.normalizeEntry({
        id,
        name: `hwk-${id}.json`,
        date: (data && data.date) || s.dateFromId(id),
        title: (data && data.title) || '',
      }));
    }
    records.sort(s.byDateDesc);
    return {
      dir,
      records,
      today: s.todayOf(),
      defaultSubjects: s.DEFAULT_SUBJECTS.slice(),
      notesKey: s.NOTES_KEY,
      eggKey: s.EGG_KEY,
      bgKnown: s.BG_KNOWN.slice(),
      dirty: state.dirty,
      lastSyncAt: state.lastSyncAt,
      lastSyncStamp: state.lastSyncStamp,
      baselineDir,
    };
  }

  async function read(id) {
    const s = await schema();
    const key = String(id || '').trim();
    if (!s.ID_RE.test(key)) throw new Error('id 不合法：' + key);
    const data = readJson(recordFile(key), null);
    if (!data) throw new Error('本机没有这一天：hwk-' + key + '.json');
    return { id: key, record: data, form: s.recordToForm(data) };
  }

  /**
   * 保存一天：写记录 + 把这条顶到 index.json 最前 + 记一笔「还没同步」。
   * 校验用的就是 sync/lib/hwk-schema.mjs（和控制台/页面同一套），
   * 所以这里不需要自己再判一遍字段。
   */
  async function save(input) {
    const s = await schema();
    const { record, meta, notes } = s.normalizeInput(input || {});
    fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(recordFile(record.id));
    if (existed) {
      /* 覆盖前留一份旧版（不进任何会被上传的目录） */
      const backupDir = path.join(dir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(recordFile(record.id), path.join(backupDir, `hwk-${record.id}.json`));
    }
    writeAtomic(recordFile(record.id), s.dumpJson(record));

    const index = s.mergeIndex(readIndex(), {
      id: record.id,
      name: `hwk-${record.id}.json`,
      date: record.date,
      title: record.title,
    });
    writeAtomic(path.join(dir, 'index.json'), s.dumpJson(index));

    const state = readState();
    const dirty = Array.from(new Set([...state.dirty, record.id]));
    writeState({ ...state, dirty });

    return { record, meta, notes, existed, dirty };
  }

  /**
   * 「先同步到本地」：把改动快照到 outbox/<时间戳>/hwk/。
   * 上云（sync.js）只从这份快照读，上传失败也不会影响本机数据。
   */
  async function snapshot() {
    const s = await schema();
    const state = readState();
    const ids = state.dirty.length ? state.dirty : listIds();
    const stamp = stampOf(new Date());
    const target = path.join(outboxDir, stamp, 'hwk');
    const files = [];
    const indexPath = path.join(dir, 'index.json');
    if (fs.existsSync(indexPath)) {
      files.push({ name: 'index.json', abs: indexPath });
    }
    for (const id of ids) {
      const file = recordFile(id);
      if (!fs.existsSync(file)) continue;
      files.push({ name: `hwk-${id}.json`, abs: file });
    }
    fs.mkdirSync(target, { recursive: true });
    for (const f of files) {
      fs.copyFileSync(f.abs, path.join(target, f.name));
    }
    void s;
    return { stamp, dir: target, ids, files: files.map((f) => f.name) };
  }

  function dirtyIds() {
    return readState().dirty;
  }

  function markSynced(stamp) {
    const state = readState();
    return writeState({ ...state, dirty: [], lastSyncAt: new Date().toISOString(), lastSyncStamp: String(stamp || '') });
  }

  function stats() {
    const state = readState();
    return { dir, records: listIds().length, dirty: state.dirty.length, lastSyncAt: state.lastSyncAt };
  }

  return { dir, seed, list, read, save, snapshot, dirtyIds, markSynced, stats, recordFile, readState };
}

/** 20261015-2218（人看得懂、也能当目录名） */
function stampOf(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

module.exports = { createHwkStore, stampOf };
