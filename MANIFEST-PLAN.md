# 清单系统方案（MANIFEST-PLAN）

> 目标：**新增/隐藏/调整一个工具，只改一个 json 文件**；清单不再互相抄、不再手工同步。
> 适用：`jinsuper.rth1.xyz/` 站点里的所有「清单类」配置。原文约定见 `AGENTS.md`。

---

## 1. 现状盘点（6 处都在描述「站里有什么」）

| # | 文件 | 结构 | 路径约定 | 谁在读 | 谁在维护 |
|:--|:--|:--|:--|:--|:--|
| 1 | `Skills/skills.json` | `{items:[{file,title,desc,kind,icon}]}` | **相对 `/Skills/`** | `/index.html`、`/web/index.html`、`/web/bak.html`、`/Skills/index.html`、`/old/index.html`（5 个渲染器） | 手写 |
| 2 | `811/tools.json` | **裸数组** `[{id,title,desc,href,icon,order,hidden}]` | **相对当前页面** | `811/index.html`（1 个渲染器） | 手写 |
| 3 | `sk.json` | 嵌套对象 `{分组:{标题:"文件.md"}}` | 相对 `/p/`（`../asset/` 例外） | `p/docs.html`（运行时 fetch + 构建期内联 `__SK__`） | 手写 |
| 4 | `docs/info/info.js` | 手写目录树 `TREE` | 展示用文本 | `docs/info/index.html` | 手写 |
| 5 | `docs/sitemap.html` | **同一棵 `TREE` 的第二份拷贝** | 展示用文本 | 自己 | 手写（与 4 必须同步） |
| 6 | `sitemap.xml` | 手写 URL + priority | 站点根绝对 | 搜索引擎 | 手写 |

附加的「清单型」常量：

| 位置 | 内容 |
|:--|:--|
| `build/build.mjs` | `PRE_RENDER` 集合（哪几篇预渲染）、`DOCS_JS` 模板 |
| `Skills/index.html`、`index.html`、`web/index.html` | `KIND_RULES`（按**文件名正则**猜 kind/图标） |
| `/index.html`、`/web/index.html`、`/Skills/index.html` | `ICONS` 图标表、`encPath`、`sitePath` 各一份 |
| `811/index.html` | `ICONS`（**按名字**取图标，与上面那套不同） |
| `rth-sites.json` / `rth-host.json` | 发布层站点清单（这个分开是合理的） |

### 已经发生的漂移（都是本轮亲眼见到的）

- `docs/info/info.js` 写着 skills.json「9 条 items」，实际 11 条 —— 数量字段没人校对。
- 同一棵树要改两遍：`docs/info/info.js` + `docs/sitemap.html`（本轮 811 迁移我两个文件各改一次）。
- `sitemap.xml` 缺页（`/811/` 是本轮手工补的；`/web/`、`/docs/` 仍未收录）。
- `skills.json` 用「相对 /Skills/」的写法，于是 811 三件只能写 `../811/xxx`，渲染器要靠 `sitePath()` 把 `Skills/../811/homework.html` 擦成 `811/homework.html`。
- 图标靠文件名正则猜：`../811/index.html` 命中 `html` → 被当成 `canvas`（图表）图标，跟「工具箱」八竿子打不着。
- 五个渲染器各写一份 `guessKind` + `ICONS` + 路径编码，改一处忘一处。

**根因**：没有「一份事实 + 一个读取器 + 一个校验器」，每条清单都自带 schema、路径规则和渲染逻辑。

---

## 2. 目标与不变量

1. **一个 collection 一份清单**，手写清单从 6 处降到 3 处（工具站 / 811 / 文档站）。
2. **一套 schema**，字段名、路径规则、图标写法全站统一。
3. **一个运行时**：加载、校验、排序、渲染、兜底只有一份实现（各页面只写「用哪个清单、放哪个容器」）。
4. **一份图标注册表**：图标不再按文件名猜。
5. **生成的产物不手写**：`sitemap.xml`、目录树数据由构建生成。
6. **校验进流程**：`部署.cmd check` 能拦住「指向不存在的文件 / 重复 id / 图标名拼错」。
7. 硬规则不变：**不用框架、不用 CDN、不用 base64、不引入构建期外的依赖**；静态托管即可运行。

---

## 3. 统一 schema

```jsonc
{
  "collection": "811",                 // 必填：集合名，用于分组与全局 id
  "title": "811 工具箱",                // 可选：集合标题（渲染分组头用）
  "updated": "2026-09-30",             // 可选
  "items": [
    {
      "id": "homework",                // 必填，集合内唯一：^[a-z0-9][a-z0-9-]*$
      "title": "美味的作业",            // 必填
      "desc": "一句话介绍",             // 必填（可为空串）
      "href": "/811/homework.html",    // 必填：**站点根绝对路径**
      "icon": "clipboardCheck",        // 可选：注册表里的名字
      "iconSvg": "<path d=\"…\"/>",    // 可选：直接给 svg 内容（覆盖 icon）
      "kind": "tool",                  // 可选：canvas|color|demo|doc|game|tool|page，分组/筛选用
      "tags": ["作业", "每日"],         // 可选：搜索关键词
      "order": 10,                     // 可选：升序，默认 999
      "hidden": false,                 // 可选：true 则不渲染（保留条目）
      "updated": "2026-09-30",         // 可选：显示「最近更新」
      "prerender": true,               // 可选：文档类专用，替代 build.mjs 的 PRE_RENDER 常量
      "meta": {}                       // 可选：渲染器私有字段，进 meta 不进顶层
    }
  ]
}
```

### 三条关键约定

1. **路径一律站点根绝对**（`/811/homework.html`）。
   理由：`相对 /Skills/` 逼出 `../811/…` 这种要擦屁股的写法；`相对页面` 一改目录就断。本站三个域名都是**根部署**，绝对路径在哪个页面都能直接用。代价：不能在 `file://` 下直接双击打开 —— 项目本来就有 `部署.cmd serve`，并把「用本地服务器打开」写进兜底文案（`811/index.html` 已经这么做了）。
2. **id 是稳定键**：`collection/id` 组成全局键，用于去重、收藏、统计、深链（`#homework`）。`title` 可改，`id` 不改。
3. **图标两层 + 逃生舱**：
   - `icon: "名字"` → 查 `assets/js/icons.js` 注册表（推荐，全站风格统一）；
   - `iconSvg: "<path …/>"` → 直接内联（一次性图标用）；
   - `iconFile: "/asset/icon/xxx.svg"` → 用站点自带的 600+ 图标库（彩色/填充类图标用）。
   **取消「按文件名正则猜图标」**，猜错一次就是永久错。

### 兼容

加载器同时接受：`{items:[…]}`（新）、`[…]`（裸数组，即现在的 `811/tools.json`）。旧的 `skills.json`（`file` 而非 `href`、相对路径）在 P1 校验器里做一次性 `file → href` 换算并告警，P3 迁完即删兼容分支。

---

## 4. 目标结构

```
jinsuper.rth1.xyz/
├── Skills/skills.json          ← 清单：工具站（手写，唯一）
├── 811/tools.json              ← 清单：811 专区（手写，唯一）
├── p/sk.json                   ← 清单：文档站（手写，唯一）
├── assets/js/
│   ├── manifest.js             ← ★ 唯一读取器：加载/校验/排序/渲染/兜底
│   └── icons.js                ← ★ 唯一图标注册表
├── sitemap.xml                 ← 生成（不再手写）
├── docs/info/site-index.json   ← 生成（目录树数据；info 页与 sitemap 页共用）
└── docs/sitemap.html           ← 改成读上面那份 json（删掉内嵌的第二份 TREE）
```

`assets/js/manifest.js` 对外只有四个函数，页面里只剩「三行胶水」：

```js
import { loadCollection, renderCards } from '/assets/js/manifest.js';

renderCards(document.getElementById('tool-grid'), await loadCollection('./tools.json'), {
  page: '/811/',            // 相对路径换算成绝对路径用
  empty: '暂无工具',
  error: '清单没加载出来，检查 tools.json 路径或用本地服务器打开。',
});
```

内部职责（现在散在 5 个渲染器里）：

- `loadCollection(url)`：`fetch` → JSON → 兼容旧格式 → 过滤 `hidden` → 校验必填 → 按 `order` 升序 → **id 去重**；
- `resolveHref(href, page)`：绝对路径直接用，`./x` 相对当前页换算；
- `renderCards(grid, items, {template, icons})`：克隆 `<template>` → 填 `href` / `data-id` / 图标 / `textContent`（**不使用 innerHTML 插值**，天然免 XSS）；
- 统一兜底：空数组 / 404 / JSON 坏 / 顶层结构不对 → `<p class="grid-empty">`；页面侧可覆盖文案。

> 关于 `type="module"`：三个托管方都按 `.js` 正确发 MIME，模块可用；若想保住 `file://` 双击预览，则退回「一个经典 IIFE 挂 `window.JSManifest`」的写法，其余不变。

---

## 5. 校验（这一步是整个方案的地基）

新增 `build/verify-manifests.mjs`，纳入 `部署.cmd check` 与 `full`：

| 检查项 | 级别 |
|:--|:--|
| JSON 能解析、顶层结构合法 | ✗ 失败 |
| `id` 存在、格式合法、集合内唯一（跨集合拼 key 也唯一） | ✗ 失败 |
| `title` / `desc` / `href` 类型正确 | ✗ 失败 |
| `href` 指向的文件在磁盘上真实存在 | ✗ 失败 |
| 引用的 `icon` 名在 `icons.js` 里存在 | ✗ 失败 |
| `iconFile` 存在 | ✗ 失败 |
| `order` / `hidden` / `prerender` 类型正确 | ✗ 失败 |
| 站点里的 `.html` 没有被任何清单收录、也不在忽略名单 | ⚠ 提示 |
| 同一 `href` 在多个集合里重复出现 | ⚠ 提示 |

先跑一次当前状态，把已有的不一致当成「基线报告」，再逐条清零 —— 校验器从第一天就能挡住**新**错误。

---

## 6. 迁移路线（5 步，每步可单独发布、可回滚）

| 阶段 | 做什么 | 产出 | 风险 |
|:--|:--|:--|:--|
| **P0 定标准** | 把第 3 节 schema 写进 `MANIFEST.md`，`AGENTS.md` 链接过去 | 文档 | 无 |
| **P1 校验先行** | 写 `verify-manifests.mjs`，接进 `check`；先只告警不拦 | 体检报告 | 无（不改站点） |
| **P2 抽运行时** | 新增 `assets/js/manifest.js` + `icons.js`；**先迁 `811/index.html`**（最小最新）→ `Skills/index.html` → `index.html` / `web/index.html`；`web/bak.html`、`old/index.html` 作为归档加 banner 冻结 | 4 个页面共用一套逻辑 | 中（页面渲染） |
| **P3 清单归一** | 三个清单改成统一 schema（绝对路径 + id + 图标名）；`skills.json` 只留工具站，811 单独一个 collection；首页变成「多集合合并 + 分组标题」 | 3 份手写清单 | 中（首页数据源） |
| **P4 生成取代手写** | `build/gen-site-index.mjs` 生成 `sitemap.xml` + `docs/info/site-index.json`；`docs/sitemap.html` 改读 json；`PRE_RENDER` 改成读清单里的 `prerender` | 手写产物 -3 | 低 |
| **P5 收尾** | 更新 `AGENTS.md` / `project.md`：加工具 = 改一个 json；归档策略写清楚 | 文档 | 无 |

**为什么 P2 先迁 811**：它只有一个清单、一个渲染器、页面最新，是验证「公共运行时」的最小闭环；迁完就能把同一套代码复制到另外三个页面。

---

## 7. 完成标准（Definition of Done）

- [ ] 加一个工具：只改 1 个 json（需要新图标时才动 `icons.js`），首页 / 工具站 / 811 中枢**同时**出现，不需要改任何 HTML。
- [ ] 隐藏一个工具：`"hidden": true`，三处同时消失，链接仍可直达。
- [ ] 调整顺序：改 `order` 数字即可。
- [ ] `部署.cmd check` 能拦住：缺必填、重复 id、`href` 指向不存在的文件、图标名拼错。
- [ ] 手写清单 ≤ 3 处；`sitemap.xml` 与目录树数据由构建生成，不再手工同步。
- [ ] 站内不再出现 `../` 相对路径的显示 / 换算补丁（`sitePath` 之类的胶水可以删掉）。
- [ ] 平台硬规则仍然满足：无外链、无 base64、无外部字体、无框架。

---

## 8. 取舍与风险

| 选择 | 代价 | 为什么不选另一条 |
|:--|:--|:--|
| 清单路径用站点根绝对路径 | 不能 `file://` 双击打开，必须走本地服务器 | 相对路径的两种写法已经把三个页面搞出两套补丁，改目录就断 |
| 共享一个 `manifest.js` | 多一次请求（也可以构建期内联，像 `docs.html` 内联 `__SK__` 那样） | 复制五份渲染逻辑，改一处漏四处，已经发生 |
| 清单仍是「每个 collection 一个 json」 | 不是单文件 | 单文件会让 811 / 工具站 / 文档站互相干扰，且任何一次编辑都要动全站数据 |
| 生成 `sitemap.xml` / 目录树 | 需要跑一次 build | 手写必漂移（现在已经在漂） |
| 保留 `meta` 逃生舱 | schema 会松一点 | 没有逃生舱就会有人往顶层塞私有字段，schema 直接烂掉 |

---

## 9. 可选进阶（不做也不影响主线）

- `/site.json`：站点级元信息（站名、域名、页脚导航、社交链接），页脚不再各页硬编码。
- 首页按 `kind` / `tags` 分组 + 按 `updated` 排序 + 搜索命中 `tags`。
- `manifest.schema.json` + 注释，编辑器里能自动补全（零依赖）。
- 深链：`/index.html#tool-homework` 直接高亮对应卡片。
- 统计：用 `collection/id` 做 localStorage 收藏 / 最近打开（和作业页的 `hw:<id>:<hash>` 同一套思路）。
