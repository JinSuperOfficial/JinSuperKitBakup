# 清单规范（MANIFEST）

> 一句话：**加一个工具 = 改一个 json**。不碰 HTML。
> 实施记录见 `MANIFEST-PLAN.md`；项目级约定见 `AGENTS.md`。

---

## 1. 清单在哪

| 文件 | collection | 管什么 | 谁渲染 |
|:--|:--|:--|:--|
| `jinsuper.rth1.xyz/site.json` | — | 站点级目录：有哪些 collection、忽略名单、sitemap 额外条目 | 生成器 + 校验器 |
| `jinsuper.rth1.xyz/Skills/skills.json` | `skills` | 工具站（/Skills/ 下的工具） | `/index.html`、`/web/index.html`、`/Skills/index.html` |
| `jinsuper.rth1.xyz/811/tools.json` | `811` | 811 专区（含 `english.html` 英语听力页） | `/index.html`、`/web/index.html`、`/811/index.html` |
| `jinsuper.rth1.xyz/sk.json` | — | 文档站（分组 → 文档路径），格式**不同**，见 §7 | `p/docs.html` |

运行时只有一份实现：`jinsuper.rth1.xyz/lib/manifest.js` —— 数据归一 + 排序 + 去重 + 渲染兜底 + 图标注册表。
页面里不再有各自的解析 / 猜图标逻辑。

---

## 2. 加一个工具（三步）

1. 把页面放进站点目录，例如 `jinsuper.rth1.xyz/811/newtool.html`。
2. 打开对应的 collection，在 `items` 里加一条：

   ```json
   {
     "id": "newtool",
     "title": "新工具",
     "desc": "一句话说清它是干什么的。",
     "href": "/811/newtool.html",
     "icon": "wrench",
     "order": 30
   }
   ```

3. 刷新页面（清单是运行时 fetch 的，**不用重新构建**）。

想让它出现在首页：`site.json` 的 `collections` 里已经有 `/811/tools.json` 了，所以同一条会自动出现在首页的「811 专区」分组里。
想临时下线：`"hidden": true`。想调顺序：改 `order` 数字。

新增图标才需要动第二个地方：`lib/manifest.js` 顶部的 `ICONS` 里加一个名字，然后 `"icon": "你的名字"`。
不想进注册表就直接给 SVG 内容：`"iconSvg": "<path d=\"…\"/>"`，或引用现成图标文件 `"iconFile": "/asset/icon/xxx.svg"`。

---

## 3. 字段

| 字段 | 必填 | 说明 |
|:--|:--|:--|
| `id` | ✅ | 集合内唯一，`^[a-z0-9][a-z0-9-]*$`；全局键是 `collection/id`。**一旦定了就别改**（右键菜单、深链、去重都靠它） |
| `title` | ✅ | 卡片标题 |
| `desc` | ✅ | 一句话介绍（可以是空串，但字段要在） |
| `href` | ✅ | **站点根绝对路径**，如 `/811/homework.html` |
| `icon` | — | `lib/manifest.js` 的 `ICONS` 里的名字 |
| `iconSvg` | — | 直接给 `<svg>` 内的内容，优先级高于 `icon` |
| `iconFile` | — | 引用站点里的图标文件，如 `/asset/icon/calendar.svg` |
| `kind` | — | `canvas` / `color` / `demo` / `doc` / `game` / `tool` / `page`，显示成卡片右上角的标签 |
| `tags` | — | 字符串数组，只用于搜索匹配 |
| `order` | — | 数字，升序；缺省 999 |
| `hidden` | — | `true` 则不渲染（条目保留，链接仍可直达） |
| `priority` | — | 0–1，生成 `sitemap.xml` 时的权重，缺省 0.6 |

顶层：

```jsonc
{
  "collection": "811",        // 必填（裸数组时取目录名）
  "title": "811 专区",         // 可选：首页分组标题
  "root": "/811/",            // 可选：集合落地页（分组标题链接、sitemap 收录）
  "items": [ /* … */ ]
}
```

裸数组也兼容（像早期的 `811/tools.json`），但新写的清单请用对象顶层。

---

## 4. 三条硬规则

1. **`href` 用站点根绝对路径**。三处托管（热铁盒 ×2、GitHub Pages）都是域名根部署。
   相对路径（`./x`、`../x`）运行时会被归一成绝对路径并打告警——能跑，但别写。
2. **路径里的中文要 percent-encode**，逐段编码、`.` / `..` 原样（`lib/manifest.js` 的 `resolveHref` 已经这么做）。
3. **图标不许靠文件名猜**。以前按文件名正则猜 kind/图标，结果 `/811/index.html` 因为名字里有 `html` 被猜成「函数图表」图标。现在一律显式写 `icon`，没写就回落 `default`。

---

## 5. 校验（改完清单跑一次）

```bash
node build/verify-manifests.mjs      # 结构、必填、id 唯一、href 存在、图标名存在、孤儿页、生成物新鲜度
node build/test-manifest.mjs         # jsdom 真跑四个页面：排序 / hidden / 去重 / 空态 / 错误态 / DOM 不回归
```

两个都挂在 `部署.cmd check` 和 `部署.cmd full` 的快速自检里，**清单写错会拦住发布**。
`verify-manifests.mjs` 会把 `sitemap.xml`、`docs/info/site-index.js`
与「现场重新生成的结果」比对，发现过期就报错——所以这两个文件**不要手改**。

---

## 6. 生成物（不要手改）

| 文件 | 生成者 | 内容 |
|:--|:--|:--|
| `jinsuper.rth1.xyz/sitemap.xml` | `build/gen-site-index.mjs` | 站点地图（保留 `jinsuper{$rthSuffix}` 服务端变量） |
| `jinsuper.rth1.xyz/docs/info/site-index.js` | 同上 | `window.SITE_INDEX`：站点目录树（说明文字在 `docs/info/info.js` 的 `DESC` 里） |

（`/asset/icon` 的图标名单没有生成：那是第三方图标集的静态清单，由 `verify-manifests.mjs` 盯着数量。）

重新生成：

```bash
node build/gen-site-index.mjs           # 写盘
node build/gen-site-index.mjs --check   # 只比对，不写（校验器用的就是它）
```

生成物刻意**不写时间戳**（和 `p/docs.html` 同规矩），否则每次构建产物都变、缓存全废。

---

## 7. 文档站（sk.json）为什么不长这样

`sk.json` 是「分组 → 文档路径」的两层结构，路径相对 `/p/`，还被 `build/build.mjs` 在构建期内联进
`p/docs.html` 当离线兜底。它服务的是文档阅读器，不是卡片列表，所以**保持原格式**：

```json
{ "分组名": { "文档标题": "文件名.md" } }
```

加一篇文档：把 `.md` 丢进 `p/`，在 `sk.json` 加一行，刷新文档站即可（不必重新构建）。
校验器会检查里面每条路径是否真实存在。

---

## 8. 常见错误

| 现象 | 原因 |
|:--|:--|
| 卡片不出现 | `id` / `title` / `href` 缺一个，或 `id` 重复 → 控制台有 `[manifest]` 告警，校验器会失败 |
| 卡片图标是空圈 | `icon` 名字不在 `lib/manifest.js` 的 `ICONS` 里 |
| 控制台报 `HTTP 404` | 清单路径写错；或页面用 `file://` 直接打开（清单页必须走 http，用 `部署.cmd serve`） |
| 页面显示「清单没加载出来」 | 同上，见上一条 |
| `sitemap.xml` 被校验器判为过期 | 你手改了生成物；跑 `node build/gen-site-index.mjs` 重新生成 |
