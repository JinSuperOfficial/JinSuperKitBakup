/**
 * tar.gz 打包 / 解包（自己实现，不引依赖）
 * ---------------------------------------------------
 * 收件箱里「学校传上来的一批文件」打成**一个** tar.gz 再传：
 *   · Gitee 的 contents 接口一次请求写一个文件 —— 一个包 = 一次请求，
 *     不会被「文件数 × 接口限流」卡住；
 *   · 家里那边一个包解一次，也不会产生半份收件箱。
 *
 * 为什么是 tar.gz 而不是 zip：Node 自带 zlib，tar 的格式只有 512 字节头 +
 * 数据块，读写都能用几十行说清楚；zip 要另实现中央目录和 DEFLATE 封装。
 *
 * 安全：解包时**只认普通文件**，绝对路径、`..`、软/硬链接一律拒掉
 * （收件箱内容来自另一台机器，不能让它往上级目录写东西）。
 */
import zlib from 'node:zlib';

const BLOCK = 512;
const MAX_FILE = 256 * 1024 * 1024;   // 单文件上限，防手滑解出一个巨型包

/* ── 头里的数字都是「八进制 + NUL/空格」 ── */
function octal(value, length) {
  const s = Math.max(0, Math.floor(value)).toString(8);
  if (s.length > length - 1) throw new Error(`tar：数字放不下（${value} > ${length} 位八进制）`);
  return s.padStart(length - 1, '0') + '\0';
}

/** 路径太长时按 ustar 的 prefix/name 两段切 */
function splitName(name) {
  const raw = String(name).replace(/\\/g, '/').replace(/^\.\//, '');
  if (Buffer.byteLength(raw) <= 100) return { name: raw, prefix: '' };
  for (let i = raw.length - 1; i > 0; i--) {
    if (raw[i] !== '/') continue;
    const head = raw.slice(0, i);
    const tail = raw.slice(i + 1);
    if (Buffer.byteLength(head) <= 155 && Buffer.byteLength(tail) <= 100) return { name: tail, prefix: head };
  }
  throw new Error(`tar：路径太长了，放不进 ustar 头：${raw}`);
}

function makeHeader({ name, size, mode = 0o644, mtime = 0, type = '0', prefix = '' }) {
  const buf = Buffer.alloc(BLOCK, 0);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(mode, 8), 100, 8, 'latin1');
  buf.write(octal(0, 8), 108, 8, 'latin1');          // uid
  buf.write(octal(0, 8), 116, 8, 'latin1');          // gid
  buf.write(octal(size, 12), 124, 12, 'latin1');
  buf.write(octal(mtime, 12), 136, 12, 'latin1');
  buf.write('        ', 148, 8, 'latin1');           // chksum 先填空格
  buf.write(type, 156, 1, 'latin1');
  buf.write('ustar\0', 257, 6, 'latin1');
  buf.write('00', 263, 2, 'latin1');
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return buf;
}

/**
 * @param {Array<{name:string, data:Buffer|string, mtime?:number}>} entries
 * @returns {Buffer} tar（未压缩）
 */
export function packTar(entries) {
  const parts = [];
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data == null ? '' : e.data), 'utf8');
    const { name, prefix } = splitName(e.name);
    parts.push(makeHeader({ name, prefix, size: data.length, mtime: Math.floor((e.mtime || Date.now()) / 1000) }));
    parts.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));   // 结束标记
  return Buffer.concat(parts);
}

export function packTarGz(entries) {
  return zlib.gzipSync(packTar(entries), { level: 9 });
}

/** 路径安全：相对、无 `..`、无盘符、无控制字符 */
export function safeRel(name) {
  const raw = String(name == null ? '' : name).replace(/\\/g, '/').trim();
  if (!raw) throw new Error('tar：空路径');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw new Error(`tar：不接受绝对路径：${raw}`);
  const out = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') throw new Error(`tar：不接受上级目录：${raw}`);
    if (/[\0-\x1f]/.test(seg)) throw new Error(`tar：路径里有控制字符：${raw}`);
    out.push(seg);
  }
  if (!out.length) throw new Error(`tar：路径归一后是空的：${raw}`);
  return out.join('/');
}

function parseOctal(buf) {
  const s = buf.toString('latin1').replace(/\0.*$/, '').trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

/**
 * @param {Buffer} buf tar
 * @returns {Array<{name:string, data:Buffer, type:'file'}>} 只有普通文件
 */
export function unpackTar(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const out = [];
  let at = 0;
  while (at + BLOCK <= buf.length) {
    const head = buf.subarray(at, at + BLOCK);
    if (head.every((b) => b === 0)) break;               // 结束
    const nameField = head.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = head.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseOctal(head.subarray(124, 136));
    const type = head.subarray(156, 157).toString('latin1') || '0';
    const full = prefix ? prefix + '/' + nameField : nameField;
    at += BLOCK;
    if (size > MAX_FILE) throw new Error(`tar：包里有个 ${Math.round(size / 1048576)}MB 的文件，超上限`);
    const data = buf.subarray(at, at + size);
    at += Math.ceil(size / BLOCK) * BLOCK;

    if (type === '1' || type === '2') throw new Error(`tar：不接受链接（${full}）`);
    if (type === '5') continue;                           // 目录不用建，文件路径会带上
    if (type !== '0' && type !== '\0' && type !== '') continue;   // 其它类型（pax 头等）跳过
    out.push({ name: safeRel(full), data: Buffer.from(data), type: 'file' });
  }
  return out;
}

export function unpackTarGz(buf) {
  return unpackTar(zlib.gunzipSync(buf));
}
