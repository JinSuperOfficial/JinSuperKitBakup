'use strict';
/**
 * src/origins.js —— 「网页来源」表 + 回落链
 * ---------------------------------------------------------------
 * 这一个文件是纯逻辑，不 require('electron')，所以 `node --test` 能直接跑它
 * （见 test/origins.test.mjs）。主进程与设置页都从这里取来源定义，别在别处再抄一份。
 *
 * 一个来源 = 一个站点根地址：
 *   cn    主站（默认）      https://www.jinsuper.cn
 *   rth   热铁盒            https://jinsuper.rth1.xyz
 *   gh    GitHub Pages      https://jinsuperofficial.github.io
 *   local 内置离线副本       随应用打包的快照，运行时才由本地服务定端口
 */

const DEFAULT_ORIGIN = 'cn';

const ORIGINS = [
  {
    id: 'cn',
    label: '主站',
    host: 'www.jinsuper.cn',
    url: 'https://www.jinsuper.cn',
    desc: '默认入口，一级域名，走 CDN。',
  },
  {
    id: 'rth',
    label: '热铁盒',
    host: 'jinsuper.rth1.xyz',
    url: 'https://jinsuper.rth1.xyz',
    desc: '热铁盒托管，内容和主站一致。',
  },
  {
    id: 'gh',
    label: 'GitHub Pages',
    host: 'jinsuperofficial.github.io',
    url: 'https://jinsuperofficial.github.io',
    desc: 'GitHub Pages 托管，国内访问偶尔慢。',
  },
  {
    id: 'local',
    label: '内置离线副本',
    host: '127.0.0.1',
    url: '', // 运行时由 local-server.js 起一个 127.0.0.1 的静态服务
    desc: '随应用打包的整站快照，断网也能用。',
  },
];

/** topbar 上的固定入口（站点根绝对路径，回调里再拼当前来源的根） */
const NAV = [
  { id: 'home', label: '主页', path: '/', hint: '百宝箱首页' },
  { id: 'skills', label: '工具站', path: '/Skills/', hint: 'Skills 里的全部小工具' },
  { id: 'class', label: '班级工具箱', path: '/class/index.html', hint: '811 专区' },
  { id: 'blog', label: '博客', path: '/p/', hint: 'JinSuper 奇思妙想' },
];

const DEFAULT_SETTINGS = {
  originId: DEFAULT_ORIGIN,
  autoFallback: true, // 主站打不开时依次试其它云端源
  offlineFallback: true, // 云端都打不开时用内置离线副本
  zoom: 1,
  bounds: null,
};

function getOrigin(id) {
  return ORIGINS.find((o) => o.id === id) || ORIGINS.find((o) => o.id === DEFAULT_ORIGIN);
}

function isCloud(id) {
  return id !== 'local';
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULT_SETTINGS };
  if (ORIGINS.some((o) => o.id === src.originId)) out.originId = src.originId;
  if (typeof src.autoFallback === 'boolean') out.autoFallback = src.autoFallback;
  if (typeof src.offlineFallback === 'boolean') out.offlineFallback = src.offlineFallback;
  const z = Number(src.zoom);
  if (Number.isFinite(z) && z >= 0.5 && z <= 3) out.zoom = Math.round(z * 100) / 100;
  const b = src.bounds;
  if (b && typeof b === 'object') {
    const width = Math.round(Number(b.width));
    const height = Math.round(Number(b.height));
    if (width >= 360 && height >= 320 && width <= 10000 && height <= 10000) {
      out.bounds = {
        width,
        height,
        ...(Number.isFinite(Number(b.x)) ? { x: Math.round(Number(b.x)) } : {}),
        ...(Number.isFinite(Number(b.y)) ? { y: Math.round(Number(b.y)) } : {}),
        maximized: !!b.maximized,
      };
    }
  }
  return out;
}

/**
 * 打开某个来源时要依次尝试的清单。
 *   · 第一个永远是用户选中的那个
 *   · 选中「内置离线副本」就只走本地 —— 明确选了离线，就别再跳回云端
 *   · autoFallback：云端之间互相顶替（cn → rth → gh）
 *   · offlineFallback：云端全挂 → local
 */
function buildChain(settings, startId) {
  const s = normalizeSettings(settings);
  const first = startId && ORIGINS.some((o) => o.id === startId) ? startId : s.originId;
  if (first === 'local') return ['local'];

  const chain = [first];
  if (s.autoFallback) {
    for (const o of ORIGINS) {
      if (o.id === 'local' || chain.includes(o.id)) continue;
      chain.push(o.id);
    }
  }
  if (s.offlineFallback && !chain.includes('local')) chain.push('local');
  return chain;
}

/** 云端来源的根地址；本地来源要等本地服务起来（传 localBase） */
function originUrl(id, localBase) {
  if (id === 'local') {
    if (!localBase) throw new Error('内置离线副本还没起来（缺 localBase）');
    return localBase.replace(/\/+$/, '');
  }
  return getOrigin(id).url;
}

/** 当前地址属于哪个来源（给 topbar 的来源徽章用）；认不出就返回 null */
function matchOrigin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.hostname) return null; // about:blank、file:// 这类没有主机名
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return 'local';
  return ORIGINS.find((o) => o.host === u.hostname)?.id || null;
}

module.exports = {
  DEFAULT_ORIGIN,
  DEFAULT_SETTINGS,
  ORIGINS,
  NAV,
  getOrigin,
  isCloud,
  normalizeSettings,
  buildChain,
  originUrl,
  matchOrigin,
};
