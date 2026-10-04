/**
 * 域名可达性 / 证书检查
 * ---------------------------------------------------
 * 从 deploy.mjs 的 `[4/4] 检查域名` 那段抽出来，
 * 让「部署脚本」和「控制台 · 部署前预检」用同一套判断与同一套人话解释。
 *
 * 两个平台相关的坑（都在这里处理掉）：
 *   · 热铁盒对**非浏览器 UA** 会甩 403 拦截页 → 必须装成浏览器
 *   · 静态资源会 302 跳到 cdn.rthe.cn/cached-<hash>/… → 必须 redirect: 'follow'
 */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 抓一段 HTML（不抛，返回结构化结果） */
export function fetchText(url, timeout = 12000) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
    })
      .then(async (r) => {
        const body = await r.text();
        clearTimeout(timer);
        resolve({ ok: true, status: r.status, body, url: r.url || url });
      })
      .catch((e) => {
        clearTimeout(timer);
        const cause = (e && e.cause) || {};
        resolve({
          ok: false,
          code: cause.code || e.code || '',
          msg: cause.message || e.message || String(e),
        });
      });
  });
}

/** 把 TLS/网络错误翻译成人能看懂的话 */
export function explain(r) {
  const c = String((r && r.code) || '');
  const m = String((r && r.msg) || '');
  if (/ALTNAME|ERR_TLS_CERT_ALTNAME_INVALID/i.test(c + m)) {
    return '证书不含这个域名（多半只给 www 签了，裸域要单独申请）';
  }
  if (/CERT_HAS_EXPIRED/i.test(c)) return '证书过期了';
  if (/UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(c)) return '证书链不被信任';
  if (/ENOTFOUND|EAI_AGAIN/i.test(c)) return 'DNS 解析不了';
  if (/ECONNREFUSED/i.test(c)) return '连接被拒绝';
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(c)) return '连接超时';
  if (/ABORT_ERR/i.test(c + m)) return '超时（12 秒没响应）';
  return c || m || '未知错误';
}

/**
 * 逐个域名探一遍。
 * @param {string[]} domains
 * @returns {Promise<Array<{domain:string, ok:boolean, status?:number, reason?:string, url?:string}>>}
 */
export async function checkDomains(domains, { timeout = 12000 } = {}) {
  const out = [];
  for (const domain of domains) {
    const r = await fetchText(`https://${domain}/`, timeout);
    if (!r.ok) out.push({ domain, ok: false, reason: explain(r), code: r.code || '', msg: r.msg || '' });
    else out.push({ domain, ok: r.status === 200, status: r.status, url: r.url });
  }
  return out;
}
