#!/usr/bin/env node
/**
 * android/tools/make-tar-fixtures.mjs —— 生成跨端 tar 的固定样本
 * ===========================================================
 * 为什么需要这个脚本：
 *   Kotlin 侧（`InboxTarGz.kt`）和 Node 侧（`sync/lib/tar.mjs`）是**两份实现**，
 *   收件箱的包两边都要读得懂。这种「两份实现约定一份字节格式」的地方，
 *   光靠「各写各的单测」证明不了兼容 —— 必须有一份**真产物**当共同基准。
 *
 * 做法：
 *   用 Node 那份实现打包 → 把结果（sha256 + base64）写进
 *   `android/app/src/test/resources/tar-fixtures.json` →
 *   Kotlin 单测读这份文件，断言
 *     ① `unpackTar(nodeTar)` 解出来的文件内容一字不差；
 *     ② `packTar(sameEntries, sameMtime)` 产出的字节与 nodeTar **逐字节相同**。
 *
 * 用法：
 *   node android/tools/make-tar-fixtures.mjs          # 重新生成
 *   node android/tools/make-tar-fixtures.mjs --check  # 只比对（CI 用；过期就红）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'tar-fixtures.json');

/* 直接从 sync/lib 引那一份实现 —— 「唯一来源」这条规矩在这儿也照办 */
const { packTar } = await import(path.join(ROOT, 'sync', 'lib', 'tar.mjs'));

/** 固定 mtime：不然每次生成的字节都不一样，--check 永远红 */
const MTIME = 1700000000;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 这些 key 是「怎么造内容」的记号，不是真内容 —— 内容由这里展开 */
function expandBody(key, value) {
  if (value === 'BOUNDARY_1024') return 'x'.repeat(1024);
  if (value === 'PAD_7') return 'y'.repeat(7);
  if (value === 'LONG_NAME') return 'z'.repeat(60);
  return value;
}

const CASES = [
  { id: 'single-small', why: '最小一档：一个文件、内容不足一个 512 块', files: { 'hwk/hwk-n261017.json': '{\n\t"id": "n261017"\n}\n' } },
  { id: 'block-boundary', why: '正好 1024 字节：数据块边界，padding 为 0 的那条路', files: { 'hwk/a.bin': 'BOUNDARY_1024' } },
  { id: 'need-padding', why: '不足一块但非空：要补 0 到 512', files: { 'hwk/b.bin': 'PAD_7' } },
  { id: 'utf8-name', why: '中文文件名：名称字段按 UTF-8 写', files: { 'hwk/作业-笔记.txt': '中文内容\n' } },
  {
    id: 'long-prefix',
    why: '路径超过 100 字节：走 ustar 的 prefix/name 两段切',
    /* 前缀 104 字节（≤155）+ 名字 60 字节（≤100），合起来 >100 —— 正好走 prefix 那条路。
       别把名字写太长：ustar 的 name 只有 100 字节，超了连 JS 那边也会抛。 */
    files: { ['hwk/' + 'a'.repeat(100) + '/' + 'b'.repeat(56) + '.txt']: 'long path\n' },
  },
  { id: 'empty-file', why: '空文件：size=0，没有数据块', files: { 'hwk/empty.json': '' } },
  {
    id: 'multi',
    why: '多文件 + 顺序敏感（顺序必须被保留）',
    files: {
      'hwk/index.json': '[]\n',
      'hwk/hwk-n261010.json': '{\n\t"id": "n261010"\n}\n',
      'hwk/hwk-n261017.json': '{\n\t"id": "n261017"\n}\n',
    },
  },
];

function build() {
  const cases = CASES.map((c) => {
    const entries = Object.entries(c.files).map(([name, body]) => ({
      name,
      data: Buffer.from(expandBody(name, body), 'utf8'),
    }));
    const tar = packTar(entries.map((e) => ({ ...e, mtime: MTIME })));
    return {
      id: c.id,
      why: c.why,
      files: Object.fromEntries(entries.map((e) => [e.name, e.data.toString('utf8')])),
      tarSha256: sha256(tar),
      tarBase64: tar.toString('base64'),
    };
  });
  return {
    note: '由 android/tools/make-tar-fixtures.mjs 生成（源头是 sync/lib/tar.mjs）。这些样本是 Node 侧的真产物 —— Kotlin 的 InboxTarGz 必须能原样解开，也必须能原样写出来。改 tar.mjs 之后要重新生成。',
    mtime: MTIME,
    cases,
  };
}

const next = build();
const text = JSON.stringify(next, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (now !== text) {
    console.error('✗ tar 样本过期了：sync/lib/tar.mjs 改过之后要重新生成');
    console.error('  跑：node android/tools/make-tar-fixtures.mjs');
    process.exit(1);
  }
  console.log(`✓ tar 样本是最新的（${next.cases.length} 组）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text, 'utf8');
console.log(`✓ 写了 ${path.relative(ROOT, OUT)}（${next.cases.length} 组）`);
for (const c of next.cases) console.log(`   · ${c.id.padEnd(16)} ${c.tarSha256.slice(0, 12)}…  ${c.why}`);
