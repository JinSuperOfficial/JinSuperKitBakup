/**
 * Gitee 后端（学校那边唯一能通的通道）
 * ---------------------------------------------------
 * 只用到 Gitee OpenAPI v5 的两件事：
 *   · 读：`GET /repos/{owner}/{repo}/raw/{path}`（私有仓库带 access_token；
 *     公开仓库走 gitee.com 的免令牌 raw，快且不占接口额度）
 *   · 写：`contents` 接口（一个文件一次请求；收件箱因此打成 tar.gz 再传）
 *
 * 站点镜像**不走这里**：镜像体积大、变化又多，家里直接用 git push 第二个
 * remote（见 build/sync-cli.mjs）。这里只管收件箱和清单。
 *
 * 配额：社区版单文件 ≤ 50MB、单仓库 ≤ 500MB（2026 年 Gitee 帮助中心的配额表）。
 * 所以单次请求超过 CHUNK 的内容会分卷，见 transport.mjs 的 putChunked()。
 */
export const API = 'https://gitee.com/api/v5';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? '?' + s : '';
}

export function createGiteeTransport(cfg, { fetchImpl = globalThis.fetch, retries = 3, log = () => {} } = {}) {
  const { owner, repo, token, visibility } = cfg.gitee;
  if (!owner || !repo) throw new Error('Gitee 通道缺 owner / repo（sync.json）');

  async function request(url, init = {}, { tries = retries } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchImpl(url, {
          ...init,
          headers: {
            'User-Agent': 'JinSuperSync/1.0',
            ...(init.body ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
            ...(init.headers || {}),
          },
        });
        if (res.ok) return res;
        const text = await res.text().catch(() => '');
        let msg = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.message) msg = parsed.message;
        } catch { /* 不是 JSON 就用原文 */ }
        const err = new Error(`Gitee ${res.status}：${msg}`);
        err.status = res.status;
        /* 4xx 里除了 429 都是「重试也没用」，直接抛 */
        if (res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
      }
      if (i < tries - 1) {
        const wait = 700 * (i + 1);
        log(`Gitee 请求失败（${lastErr && lastErr.message}），${wait}ms 后重试`);
        await sleep(wait);
      }
    }
    throw lastErr || new Error('Gitee 请求失败');
  }

  const api = (p, params = {}, init = {}) =>
    request(`${API}/repos/${owner}/${repo}${p}${buildQuery({ ...params, access_token: token })}`, init);

  /** 公开仓库的免令牌 raw 地址（也能当「给人看的链接」） */
  const publicRaw = (key, branch) =>
    `https://gitee.com/${owner}/${repo}/raw/${encodeURIComponent(branch)}/${key.split('/').map(encodeURIComponent).join('/')}`;

  const transport = {
    kind: 'gitee',
    branch: cfg.gitee.branch,
    inboxBranch: cfg.gitee.inboxBranch,

    url(key, branch = cfg.gitee.branch) {
      if (cfg.gitee.publicBase) return `${cfg.gitee.publicBase}/${key}`;
      return publicRaw(key, branch);
    },

    async get(key, { branch = cfg.gitee.branch } = {}) {
      if (visibility === 'public' && !token) {
        const res = await request(publicRaw(key, branch));
        return Buffer.from(await res.arrayBuffer());
      }
      const res = await api(`/raw/${key}`, { ref: branch });
      return Buffer.from(await res.arrayBuffer());
    },

    /** 文件元信息（不存在返回 null） */
    async stat(key, { branch = cfg.gitee.branch } = {}) {
      try {
        const res = await api(`/contents/${key}`, { ref: branch });
        const data = await res.json();
        if (Array.isArray(data)) return { type: 'dir', sha: '' , size: 0 };
        return { type: 'file', sha: data.sha, size: data.size || 0 };
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },

    async exists(key, opts) {
      const at = await transport.stat(key, opts);
      return !!(at && at.type === 'file');
    },

    async put(key, buf, { message = 'sync', branch = cfg.gitee.branch } = {}) {
      const body = {
        access_token: token,
        content: buf.toString('base64'),
        message: String(message).slice(0, 200) || 'sync',
        branch,
      };
      const at = await api.stat(key, { branch });
      if (at && at.type === 'file') {
        await api(`/contents/${key}`, {}, { method: 'PUT', body: JSON.stringify({ ...body, sha: at.sha }) });
      } else {
        await api(`/contents/${key}`, {}, { method: 'POST', body: JSON.stringify(body) });
      }
      return { path: key, size: buf.length };
    },

    async del(key, { message = 'sync prune', branch = cfg.gitee.branch } = {}) {
      const at = await api.stat(key, { branch });
      if (!at || at.type !== 'file') return false;
      await api(`/contents/${key}`, {}, {
        method: 'DELETE',
        body: JSON.stringify({ access_token: token, sha: at.sha, message, branch }),
      });
      return true;
    },

    async list(prefix = '', { branch = cfg.gitee.branch } = {}) {
      try {
        const res = await api(`/contents/${prefix}`, { ref: branch });
        const data = await res.json();
        const list = Array.isArray(data) ? data : [data];
        return list.filter((d) => d && d.path).map((d) => ({
          name: d.name,
          path: d.path,
          type: d.type === 'dir' ? 'dir' : 'file',
          size: d.size || 0,
          sha: d.sha || '',
        }));
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    },
  };
  return transport;
}
