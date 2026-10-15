/**
 * 本地目录 / U 盘后端
 * ---------------------------------------------------
 * 和 Gitee 后端**同一套接口**（get / put / del / list / exists），
 * 所以 `--to I:\某个目录` 就是一条完整的同步通道：学校网络全封时用 U 盘
 * 把 dist/ 和收件箱搬过去，家里的命令一行都不用改。
 *
 * 注意：这里**不认盘符、不自动探测可移动盘** —— U 盘不常住电脑，
 * 只有显式传了 `--to <路径>` 才会走这条通道。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 把 key（posix 相对路径）落到 base 下的绝对路径，越界一律拒掉 */
export function resolveKey(baseDir, key) {
  const rel = String(key == null ? '' : key).replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(baseDir, rel);
  const root = path.resolve(baseDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`越界路径：${key}`);
  return abs;
}

export function createFsTransport(dir) {
  const base = path.resolve(String(dir || ''));
  if (!base) throw new Error('本地通道要指定目录（--to <路径> 或 sync.json 的 local.dir）');

  const api = {
    kind: 'fs',
    base,
    async get(key) {
      return fs.readFileSync(resolveKey(base, key));
    },
    async exists(key) {
      try {
        return fs.statSync(resolveKey(base, key)).isFile();
      } catch {
        return false;
      }
    },
    async put(key, buf, { message } = {}) {
      const abs = resolveKey(base, key);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = abs + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, abs);            // 原子落盘：不会留下半份文件
      void message;
      return { path: key, size: buf.length };
    },
    async del(key) {
      try {
        fs.unlinkSync(resolveKey(base, key));
        return true;
      } catch {
        return false;
      }
    },
    async list(prefix = '') {
      const abs = resolveKey(base, prefix || '.');
      let entries = [];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return [];
      }
      return entries.map((e) => {
        const rel = (prefix ? prefix.replace(/\/+$/, '') + '/' : '') + e.name;
        return {
          name: e.name,
          path: rel,
          type: e.isDirectory() ? 'dir' : 'file',
          size: e.isFile() ? fs.statSync(path.join(abs, e.name)).size : 0,
        };
      });
    },
    url(key) {
      return path.join(base, key);
    },
  };
  return api;
}
