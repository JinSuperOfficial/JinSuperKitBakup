/**
 * HTTP 静态服务：公共实现（控制台 UI 与预览服务共用）
 * ---------------------------------------------------
 * 控制台自己（console/web/ + 站点根）和「预览」那个独立端口的服务
 * （只服务站点根）用的是同一套 MIME 表、同一套越界判断、同一套
 * Range 流。抽出来一份，免得两边各长一版，改了一边忘了另一边。
 *
 * 安全约定（和原来 server.mjs 里那段一字不差）：
 *   · 越界判断用「解析后的文本路径是否以根目录为前缀」，
 *     而不是把 `..` 归一后再说 —— `/%2e%2e/sk.json` 解码后是
 *     `/../sk.json`，path.resolve 会老实爬到上级目录，必须在这里挡住。
 *   · 只提供 GET/HEAD 语义，不做目录列表。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.php': 'text/plain; charset=utf-8',
};

export function contentTypeOf(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * 把 URL 路径解析成磁盘文件。
 * @param {string} urlPath 形如 /p/docs.html
 * @param {string[]} roots 按顺序找的根（前一个没有再看下一个）
 * @returns {{file:string, root:string}|null}
 */
export function resolveStatic(urlPath, roots) {
  const rel = String(urlPath).replace(/^[/\\]+/, '');
  for (const root of roots) {
    const cand = path.resolve(root, rel);
    const r = path.resolve(root);
    if (cand !== r && !cand.startsWith(r + path.sep)) continue;   /* 爬到根外面了 */
    try {
      if (fs.statSync(cand).isFile()) return { file: cand, root };
    } catch { /* 不存在就试下一个根 */ }
  }
  return null;
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 带 Range 的文件流（音频/视频拖动进度要用）。
 * 浏览器原生 <audio> 就是靠这个 seek 的 —— 所以控制台不需要任何音频 API。
 */
export function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = contentTypeOf(file);
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}
