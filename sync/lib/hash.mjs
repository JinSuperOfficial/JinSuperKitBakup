/**
 * 内容哈希（唯一来源）
 * ---------------------------------------------------
 * 同步（sync/）与部署（build/lib/deploy-files.mjs）判「文件变了没有」用的是
 * 同一个算法：sha256 十六进制。以前它只写在 deploy-files.mjs 里，现在同步
 * 也要用，就抽到这里，deploy-files.mjs 反过来 import 这一份 —— 一份实现，
 * 两处调用（桌面版打包时只带 sync/，所以实现必须住在 sync/ 这边）。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 磁盘上的文件和这段内容一样吗（读不到就是不一样） */
export function sameAs(fileAbs, buf) {
  try {
    return sha256(fs.readFileSync(fileAbs)) === sha256(buf);
  } catch {
    return false;
  }
}
