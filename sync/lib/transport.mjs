/**
 * 通道工厂 + 分卷读写
 * ---------------------------------------------------
 * 家里的命令、控制台、桌面版都从这里拿通道，所以「换通道」只改 sync.json：
 *   · provider=gitee（默认）→ Gitee 仓库（学校实测可达）
 *   · provider=local / --to <路径> → 本地目录 / U 盘（网络全断时的兜底）
 *
 * 分卷：Gitee 的 contents 接口一次请求写一个文件，社区版单文件上限 50MB。
 * 收件箱里的 tar.gz 一般只有几百 KB，但作业里带图片/音频就不好说了 ——
 * 超过 CHUNK 就切成 `key.part001…` 再写一个 `key.parts` 描述文件
 * （**描述文件最后写**，所以半份上传永远不会被当成完整的一份）。
 */
import { createFsTransport } from './fs.mjs';
import { createGiteeTransport } from './gitee.mjs';
import { sha256 } from './hash.mjs';

export const CHUNK = 16 * 1024 * 1024;

/** 单次请求的上限：base64 会把体积撑大约 1/3，留足余量 */
export function createTransport(config, opts = {}) {
  const dir = opts.dir || config.local.dir;
  let t;
  if (config.provider === 'local' || dir) {
    if (!dir) throw new Error('走本地通道要指定目录：`--to <路径>` 或 sync.json 的 local.dir');
    t = createFsTransport(dir);
  } else {
    t = createGiteeTransport(config, opts);
  }
  /* 两个后端对「哪个分支」要有同样的说法：本地目录通道其实不分分支，
     但调用方（state/inbox/CLI）不想为此写 if */
  if (!t.branch) t.branch = config.gitee.branch;
  if (!t.inboxBranch) t.inboxBranch = config.gitee.inboxBranch;
  return t;
}

const partName = (key, i) => `${key}.part${String(i).padStart(3, '0')}`;

export async function putChunked(t, key, buf, { message, branch } = {}) {
  if (buf.length <= CHUNK) {
    await t.put(key, buf, { message, branch });
    return { path: key, size: buf.length, parts: 1 };
  }
  const parts = Math.ceil(buf.length / CHUNK);
  for (let i = 0; i < parts; i++) {
    await t.put(partName(key, i + 1), buf.subarray(i * CHUNK, (i + 1) * CHUNK), { message, branch });
  }
  const desc = Buffer.from(JSON.stringify({ parts, size: buf.length, sha256: sha256(buf) }));
  await t.put(`${key}.parts`, desc, { message, branch });
  return { path: key, size: buf.length, parts };
}

export async function getChunked(t, key, { branch } = {}) {
  if (await t.exists(`${key}.parts`, { branch })) {
    const desc = JSON.parse((await t.get(`${key}.parts`, { branch })).toString('utf8'));
    const bufs = [];
    for (let i = 1; i <= desc.parts; i++) bufs.push(await t.get(partName(key, i), { branch }));
    const buf = Buffer.concat(bufs);
    if (buf.length !== desc.size) throw new Error(`分卷文件拼起来大小不对：${key}`);
    if (desc.sha256 && sha256(buf) !== desc.sha256) throw new Error(`分卷文件校验不过：${key}`);
    return buf;
  }
  return t.get(key, { branch });
}

/** 删掉分卷（连描述文件一起），换新版本前用 */
export async function delChunked(t, key, { branch, message } = {}) {
  const desc = await t.exists(`${key}.parts`, { branch });
  if (!desc) return t.del(key, { branch, message });
  const info = JSON.parse((await t.get(`${key}.parts`, { branch })).toString('utf8'));
  for (let i = 1; i <= info.parts; i++) await t.del(partName(key, i), { branch, message });
  return t.del(`${key}.parts`, { branch, message });
}
