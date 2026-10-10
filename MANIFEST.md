# 清单规范（MANIFEST）

> 一句话：**加一个工具 = 改一个 json**。不碰 HTML。
> 实施记录见 `MANIFEST-PLAN.md`；项目级约定见 `AGENTS.md`。

---

## 1. 清单在哪

| 文件 | collection | 管什么 | 谁渲染 |
|:--|:--|:--|:--|
| `jinsuper.rth1.xyz/site.json` | — | 站点级目录：有哪些 collection、忽略名单、sitemap 额外条目、**博客身份**（`blog` 段的标题/简介/主域名） | 生成器 + 校验器 |
| `jinsuper.rth1.xyz/Skills/skills.json` | `skills` | 工具站（/Skills/ 下的工具） | `/index.html`、`/web/index.html`、`/Skills/index.html` |
| `jinsuper.rth1.xyz/class/tools.json` | `811` | 811 专区（含 `english.html` 英语听力页） | `/index.html`、`/web/index.html`、`/class/index.html` |
| `jinsuper.rth1.xyz/sk.json` | — | 博客「JinSuper 奇思妙想」（分组 → 文章路径），格式**不同**，见 §7 | 阅读器 `p/docs.html` + 构建出的 `p/post/*.html` |

运行时只有一份实现：`jinsuper.rth1.xyz/lib/manifest.js` —— 数据归一 + 排序 + 去重 + 渲染兜底 + 图标注册表。
页面里不再有各自的解析 / 猜图标逻辑。

---

## 2. 加一个工具（三步）

1. 把页面放进站点目录，例如 `jinsuper.rth1.xyz/class/newtool.html`。
2. 打开对应的 collection，在 `items` 里加一条：

   ```json
   {
     "id": "newtool",
     "title": "新工具",
     "desc": "一句话说清它是干什么的。",
     "href": "/class/newtool.html",
     "icon": "wrench",
     "order": 30
   }
   ```

3. 刷新页面（清单是运行时 fetch 的，**不用重新构建**）。

想让它出现在首页：`site.json` 的 `collections` 里已经有 `/class/tools.json` 了，所以同一条会自动出现在首页的「811 专区」分组里。
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
| `href` | ✅ | **站点根绝对路径**，如 `/class/homework.html` |
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
  "collection": "class",        // 必填（裸数组时取目录名）
  "title": "811 专区",         // 可选：首页分组标题
  "root": "/class/",            // 可选：集合落地页（分组标题链接、sitemap 收录）
  "items": [ /* … */ ]
}
```

裸数组也兼容（像早期的 `class/tools.json`），但新写的清单请用对象顶层。

---

## 4. 三条硬规则

1. **`href` 用站点根绝对路径**。三处托管（热铁盒 ×2、GitHub Pages）都是域名根部署。
   相对路径（`./x`、`../x`）运行时会被归一成绝对路径并打告警——能跑，但别写。
2. **路径里的中文要 percent-encode**，逐段编码、`.` / `..` 原样（`lib/manifest.js` 的 `resolveHref` 已经这么做）。
3. **图标不许靠文件名猜**。以前按文件名正则猜 kind/图标，结果 `/class/index.html` 因为名字里有 `html` 被猜成「函数图表」图标。现在一律显式写 `icon`，没写就回落 `default`。

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
| `jinsuper.rth1.xyz/sitemap.xml` | `build/gen-site-index.mjs` | 站点地图：页面 + 工具 + **每篇文章的独立网址**（带 `lastmod`），绝对地址前缀取 `site.json` 的 `blog.origin` |
| `jinsuper.rth1.xyz/docs/info/site-index.js` | 同上 | `window.SITE_INDEX`：站点目录树（说明文字在 `docs/info/info.js` 的 `DESC` 里） |

（`/asset/icon` 的图标名单没有生成：那是第三方图标集的静态清单，由 `verify-manifests.mjs` 盯着数量。）

重新生成：

```bash
node build/gen-site-index.mjs           # 写盘
node build/gen-site-index.mjs --check   # 只比对，不写（校验器用的就是它）
```

生成物刻意**不写时间戳**（和 `p/docs.html` 同规矩），否则每次构建产物都变、缓存全废。

---

## 7. 博客（sk.json）：文档站已经正式变成「JinSuper 奇思妙想」

文档站现在对外是一份博客：**JinSuper 奇思妙想**（阅读器还是 `/p/docs.html`，
名字、简介、主域名写在 `site.json` 的 `blog` 段里）。

`sk.json` 是「分组 → 文档路径」的两层结构，路径相对 `/p/`，还被 `build/build.mjs` 在构建期内联进
`p/docs.html` 当离线兜底。它服务的是文章阅读器，不是卡片列表，所以**保持原格式**：

```json
{ "分组名": { "文章标题": "文件名.md" } }
```

加一篇文章：把 `.md` 丢进 `p/`，在 `sk.json` 加一行，刷新阅读器即可（不必重新构建）。
校验器会检查里面每条路径是否真实存在。

### 7.1 Frontmatter（正文顶上的头信息）

文章最上面可以写一段 frontmatter，渲染器会把里面的键**渲染成元数据卡片**，
构建期还会拿它去生成搜索与订阅要的东西：

```yaml
---
title: 枣香童年
date: 2026-10-06
updated: 2026-10-07
author: JinSuper
category: 奇思妙想
tags: [随笔, 童年]
summary: 爷爷的红枣饼干齁得恰到好处。
---
```

| 字段 | 用在哪 |
|:--|:--|
| `title` | 阅读器顶栏 / `<title>` / 文章页 h1 / 结构化数据。**写了它，正文开头一模一样的 `# 标题` 会自动去掉**（避免一页两个 h1） |
| `date` / `updated` | sitemap 的 `lastmod`、RSS 的 `pubDate`、JSON-LD 的 `datePublished` / `dateModified` |
| `author` | 作者。`author: JinSuper` 与 `author: [JinSuper, ABC]` 都收（也认 `authors:`），一个都没写就是默认作者（`site.json` 的 `blog.author`）。多作者会画成多枚，并分别进 RSS 的 `<dc:creator>` 与 JSON-LD 的 `author` |
| `category` / `tags` | 元数据卡片；`tags` 还进 RSS 的 `<category>`、JSON-LD 的 `keywords`，并且是可点的链接 —— 指向博客首页的标签筛选（`/p/#tag-xxx`） |
| `summary` | `<meta name="description">`、Open Graph、RSS 的 `<description>` |
| `canonical` | 选填。同一篇文章既有活着的 `/p/` 正文、又有归档稿时，在**归档稿的源文件**里写 `canonical: /p/post/…`，归档产物就把 canonical 指过去，免得两个地址被当成两份内容（见 §7.2） |
| `toc` | 写 `toc: true` 在**正文开头**再插一份目录（默认不插：阅读器与文章页都另有侧栏目录，重复摆一份通常多余） |
| `draft` / `nopage` / `hidden` | 值为真时**不生成独立文章页**、不进订阅源与 sitemap（文章仍留在清单里可读） |

目录有三处（阅读器侧栏 / 文章页侧栏 / 归档稿侧栏都是同一份取标题逻辑；
正文里 `toc: true` 那份也是），全都走 `build/lib/markdown.cjs` 的 `tocEntries()` +
`normalizeTocLevels()`：

- **阅读器**：左边栏「本页目录」，嵌在页面里跟着滚，高亮当前小节
- **文章页**（`/p/post/…`）：左侧一列「本页目录」，sticky 跟随阅读，高亮当前小节。
  **每篇都有**：正文里一个小节都没有的短文（随笔那种）就退回一条「文章标题 → `#post`」兜底条目。
  两列网格只在「有目录」时才加，没有目录就单列铺满（否则文章会被挤进 212px 那一列）
- 想另外在**正文开头**再摆一份（元数据卡片之后、正文之前），frontmatter 写 `toc: true`；
  正文里自己写 `[[toc]]` 也照画（标记与它完全一致，样式只有一份）

层级按**相对级别**缩进：文档里最浅的那一级算 `lv-1`。标题写在 frontmatter 里时正文从 `h2` 起，
按绝对级别缩进会让整份目录平白缩进一格（看着就是「没有层次」），所以三处一律先归一。

其余键不会丢：不认识的会原样列在元数据卡片下半部分。
解析规则在 `build/lib/markdown.cjs` 的 `parseFrontmatter`（Node 与浏览器共用同一份），
只实现 Markdown 真用得上的 YAML 子集（标量 / 行内与块数组 / 一层嵌套 / `>` 与 `|` 块标量 / `#` 注释）。
文件开头是水平线（`---` 但中间没有 `键: 值`）时**不会**被当成 frontmatter。

### 7.2 构建会额外产出什么

| 产物 | 生成者 | 作用 |
|:--|:--|:--|
| `p/index.html` | `build/build.mjs`（模板 `build/template/blog.html`） | **博客首页**：最新几篇 + 标签筛选 + 完整时间线。列表全部构建期渲染成静态 HTML（爬虫读得到），脚本只做筛选。原来这里是个浏览器端写作台，已经舍弃 |
| `p/post/<路径>.html` | `build/build.mjs`（`build/lib/posts.mjs` 算清单） | 每篇文章的**独立网址**：服务端渲染正文 + 元数据卡片 + 上下篇 + canonical/OG/JSON-LD。`/p/docs.html#xxx` 在搜索引擎眼里和 `/p/docs.html` 是同一个页面，所以独立网址只能这样来 |
| `p/feed.xml` | 同上 | RSS 2.0，最新 30 篇（作者写 `<dc:creator>`） |
| `sitemap.xml` 里的文章条目 | `build/lib/site-index.mjs` | 每篇文章页 +（没有活 `.md` 对应的）归档稿，带 `lastmod` |
| 时间线 / 标签里的归档稿 | `build/lib/posts.mjs` 的 `listArchivedPosts()` | 归档稿（`/p/archive/**.html`）**不隐藏**：也列进博客首页的时间线，并额外挂一枚「归档」标签（点一下只看归档）。元数据从成品页自己的 head 里读回来（描述 / 日期 / 标签 / 作者），读不到就用 `sk.json` 里的名字兜底。**「最新」那几张卡片只放活稿**——归档版是同一篇的旧版本，摆在最新里等于自己跟自己重样 |

这些是**生成物，不要手改**：`/p/post/` 下不是这一轮生成的文件会在构建时被清掉。
发布控制台归档出来的 `/p/archive/*.html` 是**另一个来源**（控制台烘的成品，阅读器直接注入正文）：
它是能独立打开的页面，所以控制台那边的外壳（`console/lib/render.mjs`）也会按同一套规则写
canonical / OG / JSON-LD —— 元数据同样取自源文件的 frontmatter。
**外壳与静态文章页共用同一份**（`build/lib/chrome.mjs` + `template/post-chrome.css` + `template/post-script.js`）：
顶栏导航、侧栏目录、`.wrap` 单列 / 两列、主题 token 全从那儿来 —— 归档稿也有顶栏和目录，和 `/p/post/*.html` 一个样。
改了外壳之后，老产物在控制台「归档与预渲染」面板点一下**重刷外壳**即可（正文不动，原文没留底也能刷）。
想让一篇归档稿回到「活文章」的状态，把 Markdown 放回 `/p/` 并在 `sk.json` 里登记即可。

### 7.3 搜索引擎

- `robots.txt`：对主流搜索引擎（Googlebot / Bingbot / Baiduspider / Sogou / 360 / Yandex / Applebot…）
  与 AI 抓取一律 `Allow: /`，并指向 sitemap。
- `site.json` 的 `blog.origin` 是**主域名**：canonical / `og:url` / JSON-LD 都指它，
  同一篇文章同时挂在两个热铁盒域名和 GitHub Pages 上时，搜索引擎才知道收录哪一份。
- 改了文章标题 / 简介 / 域名 / 默认作者，只需要改 `site.json` 的 `blog` 段，然后重新构建。
- 阅读器（`/p/docs.html`）、博客首页、文章页共用同一条**顶栏导航**（构建期由 `siteNavHtml()` 注入），
  改导航项只需要动 `build/build.mjs` 里的那一个数组。当前是：博客 / 时间线 / 标签 / 阅读器 / RSS / 百宝箱
  （「工具站」不再单列，站点总入口只留「百宝箱」`/`）。
- 百宝箱首页的博客卡片指向**博客首页 `/p/`**（不是阅读器）；`/Skills/docs/docs.html` 是老地址，
  仍会跳到 `/p/`。

---

## 8. 常见错误

| 现象 | 原因 |
|:--|:--|
| 卡片不出现 | `id` / `title` / `href` 缺一个，或 `id` 重复 → 控制台有 `[manifest]` 告警，校验器会失败 |
| 卡片图标是空圈 | `icon` 名字不在 `lib/manifest.js` 的 `ICONS` 里 |
| 控制台报 `HTTP 404` | 清单路径写错；或页面用 `file://` 直接打开（清单页必须走 http，用 `部署.cmd serve`） |
| 页面显示「清单没加载出来」 | 同上，见上一条 |
| `sitemap.xml` 被校验器判为过期 | 你手改了生成物；跑 `node build/gen-site-index.mjs` 重新生成 |
| 校验器说 `/p/post/…` 是孤儿页 | 那是构建生成的文章页，已经写在 `site.json` 的 `ignore` 里；生成目录改名了要同步这一条 |
| 文章页没生成 | 看 `sk.json` 里那一条：路径要存在；frontmatter 里 `draft / nopage / hidden` 为真会**故意**不生成 |
| 博客首页（`/p/`）还是旧写作台 | 那一页也是构建产物：跑 `node build/build.mjs`，模板在 `build/template/blog.html` |
| 标签点了没反应 / 筛不掉东西 | 列表项的 `data-tags` 是构建期写的 JSON；blog.html 里的脚本按它筛选，控制台看有没有 `JSON.parse` 报错 |
| 元数据卡片没出现 | frontmatter 必须以文件第一行的 `---` 开头、单独一行的 `---` 收尾，中间至少有一个 `键: 值` |
