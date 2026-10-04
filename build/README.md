# 文档站

`/p/docs.html` 是一个**静态页面 + 本地渲染器**：Markdown 在浏览器里现场排版，
公式、代码高亮、脚注、任务列表、告示框全都在。不依赖 CDN，不依赖云函数。

## 日常使用：加一篇文档

**不需要重新构建。** 两步：

1. 把 `.md` 放进 `/p/`（可以带子目录）
2. 在网站根的 `sk.json` 里加一行

```json
{
  "我的分组": {
    "文档标题": "my-doc.md"
  }
}
```

刷新 `docs.html` 就能看到。清单是运行时读的，所以改完即生效。

## 上传哪些文件

| 文件 | 必需 | 说明 |
|:--|:--:|:--|
| `p/docs.html` | ✅ | 页面本体 |
| `p/docs-md.js` | ✅ | 本地渲染器（markdown-it + KaTeX + highlight.js） |
| `p/docs-md.css` | ✅ | 样式 |
| `p/fonts/*.woff2` | ✅ | 公式字体，20 个 |
| `p/*.md` | ✅ | 你的文档 |
| `sk.json` | ✅ | 清单 |
| `p/raw.php` | 可选 | 云函数。平台的 .md 若被渲染成 HTML，用它取原文 |
| `build/` | ❌ | 只是本地构建工具，不要上传 |

**没有 base64**（平台硬规则禁止）。字体一律走 `p/fonts/` 文件路径。

## 关于 raw.php：公式完整靠它

热铁盒会把 `.md` **直接渲染成 HTML 页面**再返回（实测返回的是带
`<body class="markdown-body">` 的整页 HTML，正文已经是 `<h1>…</h1><p>…</p>`）。
这意味着：

- **拿不到 Markdown 原文**
- **LaTeX 源码在平台那一层就丢了** —— `$E=mc^2$` 不再是 `$E=mc^2$`

所以页面取内容的顺序是：

1. **`p/raw.php`（云函数）** —— 返回真原文，公式、代码围栏、语法标记一个不少。
   浏览器端渲染器才能完整工作。
2. **直接 fetch 那个 `.md`** —— 只有 raw.php 不可用才走这条。
   拿到的是平台渲染好的 HTML，正文能读，但**公式会退化成平台渲染的样子**。
   这时标题栏的元信息会标注「平台渲染」，方便你一眼看出原因。

> **结论：`raw.php` 是必需品，别删。** 它已经部署在线上并实测可用
> （`/p/raw.php?f=p/science.md` 返回纯文本原文）。
> 没有它，文档还能读，但公式不完整。

## 什么时候需要重新构建

只有这两种情况：

- **改了渲染器**（`build/lib/*.mjs`）→ 重新生成 `docs-md.js`
- **想让某篇文档预渲染**（比如给爬虫看、或文章特别大）

```bash
cd build
npm install       # 只需一次
npm run build     # 生成 p/docs.html、p/docs-md.js、p/docs-md.css、p/fonts/
npm run check     # 三套自检
npm run serve     # 本地预览 http://127.0.0.1:8788/p/docs.html
```

### 预渲染某一篇

编辑 `build/build.mjs` 里的 `PRE_RENDER`：

```js
const PRE_RENDER = new Set([
  'TEST.md',
]);
```

加进去的文档会在构建期渲染成 HTML 内联进页面，好处是无 JS 环境
（`<noscript>`）和爬虫也能读到；代价是页面体积变大。**默认只放必要的。**

## 目录

```
build/
├── build.mjs            构建入口
├── paths.mjs            路径单一来源（siteRoot / buildDir / …）
├── make-favicon.mjs     logo.svg → favicon.svg + apple-touch-icon.svg
├── add-favicon.mjs      给所有 HTML 注入/升级 favicon 链接
├── audit-contrast.mjs   全站对比度审计
├── fix-contrast.mjs     对比度求解 + 就地把不达标的颜色改亮/改暗
├── prep-deploy.mjs      组装 dist/（增量 + 清理旧文件）
├── deploy.mjs           组装 → Deno → 传热铁盒 → 推 GitHub
├── deploy-cli.mjs       部署.cmd 背后的交互菜单 / 命令行程序
├── push-github.mjs      只推 GitHub（含 fetch/merge 同步）
├── lib/
│   ├── markdown.cjs     渲染核心（Node 构建期与浏览器共用同一份）
│   ├── docs-card.cjs    docs-card.js 的自动同步副本
│   ├── vendor/
│   │   └── mdit-tab.cjs @mdit/plugin-tab 的 UMD，构建时从 node_modules 复制（见下）
│   ├── bundler.mjs      自写的 CJS 打包器
│   ├── bundle.mjs       打 p/docs-md.js
│   ├── css.mjs          合并样式 + 拷 KaTeX 字体
│   ├── favicon.mjs      favicon 标签生成 / 全站收集
│   └── logo.mjs         把 logo.svg 内联进页面
├── template/
│   ├── docs.html        页面模板（改样式/改文案改这里，p/docs.html 是产物）
│   └── docs-md.css      扩展元素样式源
├── test-render.mjs      渲染语法逐条断言
├── verify.mjs           产物结构检查
├── test-dom.mjs         jsdom 真跑页面 + 用户加文档流程
└── .serve.mjs           本地预览用的小服务器
```

> `p/docs.html` **是构建产物**。改页面请改 `build/template/docs.html`，
> 否则下一次 `node build.mjs` 会把你的修改覆盖掉。

## 支持的 Markdown 语法

CommonMark + GFM 基础，加上：

| 语法 | 写法 |
|:--|:--|
| 数学公式 | `$…$`、`$$…$$`、`\(…\)`、`\[…\]`（KaTeX） |
| 代码高亮 | 围栏标注语言，含 15 种常用语言 |
| 显示行号 | ` ```js:line-numbers ` |
| 高亮指定行 | ` ```js {1,3-5} ` |
| 行号 + 高亮 | ` ```js:line-numbers {2} ` |
| 代码组 | `::: code-group` + 面板写 ` ```js [标签] ` |
| 选项卡 | `::: tabs` + `@tab 标题`（**@mdit/plugin-tab**）；`@tab:active 标题` 指定默认展开 |
| 选项卡联动 | `@tab 标题 #id` 写在多个容器里，点一个、同 id 的一起切 |
| GitHub 告示 | `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` |
| 告示自定义名字 | `> [!NOTE] 你的标题`；不写就只留左侧色条 + `aria-label`，不硬塞默认标题 |
| 提示框 | `::: note` / `tip` / `info` / `warning` / `danger` / `success` / `question` / `details` |
| 提示框自定义名字 | `::: warning 你的标题` |
| 标题行内语法 | 告示/提示框标题里可以写 `` `代码` ``、`**加粗**` |
| 目录 | `[[toc]]` |
| 注音 | `{漢字\|かんじ}` |
| 剧透 | 行内 `!!内容!!`；块级 `>! 内容` |
| 卡片 | `<card link="a.md" date="2026.9.27">标题</card>` |
| 任务列表 / 脚注 / 定义列表 / 上下标 / 标记 / 缩写 | 常规写法 |
| 图片尺寸 | `![alt](url =100x100)` |
| 主题图 | `![alt](url#dark)` / `#light` |
| 图片懒加载 | 自动 |

**已下线**：Mermaid / PlantUML / flow / echarts 图表渲染。
这些围栏会**退化成普通代码块**（不高亮、不加提示，内容照旧完整）。
`::: layout`、`@include`、`@snippet`、`@embed`、`->对齐<-`
也都没实现，同样原样显示。

### 选项卡用的是官方插件，但样式重写了

`::: tabs` / `@tab` 来自 `@mdit/plugin-tab`（`build/package.json` 里的依赖）。
接入时有三个坑，都写在代码注释里了，这里备一份：

1. **它是 ESM 包，我们的打包器只认 CJS。**
   它自带一个自包含的 UMD（`dist/cdn.umd.js`，连 `@mdit/helper` 都打进去了），
   但那个文件落在 `"type":"module"` 的包里 —— Node 和打包器都会把它当 ESM。
   `build.mjs` 每次构建把它复制成 `lib/vendor/mdit-tab.cjs`：**扩展名一改，
   UMD 就走 CommonJS 分支**，构建期和浏览器端都能 `require`。升级依赖不用手动同步。

2. **它默认一个面板都不显示。** `active` 的默认值是 `-1`，只有写了
   `@tab:active` 才有可见面板，否则所有 `.tabs-tab-content` 都是 `display:none`，
   标签页里一片空白，看起来像语法坏了。所以加了一条 core rule
   （`defaultActiveTab`）：没人标 active 就默认选中第一个；作者标了就尊重作者。
   注意**不能**在 `openRenderer` 里改 —— `info.data` 和 `tab_open` token 的 meta
   是两份数据，改前者影响不到后者（实测过），必须回到 token 层。

3. **它自带的 `tab.css` 不能直接用。** 那是一套写死的浅色
   （`#f8fafc` / `#64748b` / `#2563eb`），在暗色主题下对比度不合格。
   样式写在 `lib/css.mjs` 的 `extraCss()` 里，全部走本站在用的主题变量。

输出用的类名和 `data-*` 完全沿用插件的默认约定
（`tabs-tabs-wrapper` / `tabs-tab-button` / `data-tab` / `data-index` / `data-id` /
`class="active"`），所以官方那个 `register-tab` 客户端脚本拿过来仍然能跑。
我们在它基础上补了两样它没有的东西：**ARIA**（`role=tablist/tab/tabpanel`、
`aria-selected`、`tabindex`）和**只有一个标签时隐藏标签行**（`data-single`）。

切换逻辑在 `build.mjs` 的 `initTabs()`，由 `activateTab()` + `syncTabs()` 组成
（后者就是跨容器联动）。初始状态在**渲染期**就定好了，所以没有 JS 也看得见第一个标签的内容。

两个边界情况也一并处理了：

- **空容器**（写了 `::: tabs` 却一个 `@tab` 都没有）整块丢掉，不留空盒子。
  用栈记录哪些 open 是空的，对应的 close 一起吞掉，保证 `</div>` 不多不少。
- **嵌套**：`::: tabs` 放进 `::: warning` 这类容器里时，外层必须写**四个冒号**
  （`:::: warning` … `::::`）。这是 `markdown-it-container` 的固有行为 ——
  它找结束符时只认**第一个**同长度的 `:::`，外层不加长就会被标签页的结束符截断。


**逐条对照用的测试稿是 `/p/TEST.md`**，里面每种语法的真实效果都能直接看到，
最后一节（§9 速查）列了支持 / 不支持的完整清单。

### 主题

`docs.html` 自带 12 套配色，默认 `[data-theme="obsidian"]`（对比度最高的一套，
正文字号 ≥ 4.5:1 的 WCAG AA 要求）。主题定义在 `build/template/docs.html` 里，
改完要重新构建。

配套两个脚本：

```bash
node audit-contrast.mjs        # 全站 WCAG 对比度审计（只读 --bg 系变量，不猜）
node fix-contrast.mjs          # 只报告哪里不达标
node fix-contrast.mjs --apply  # 按 WCAG 4.6:1 求解并就地改写
```

`fix-contrast.mjs` 只调 HSL 的亮度，**不动色相和饱和度**，所以改完还是原来的色系。
它同时扫站点和 `build/template/`（模板才是源头）。

### 站点图标

站标是 `asset/icon/logo.svg`，favicon 由它生成，**不再用头像**：

```bash
node make-favicon.mjs   # logo.svg → favicon.svg + apple-touch-icon.svg（填成主题橙）
node add-favicon.mjs    # 把 <link rel="icon"> 注入所有 HTML（会自动把旧 PNG 升级掉）
```

`build.mjs` 结尾会自动跑 `add-favicon.mjs`，一般不用手动执行。
模板里的 `<!-- __FAVICON__ -->` 和 `<!-- __LOGO__ -->` 两个占位符分别由
`lib/favicon.mjs` 和 `lib/logo.mjs` 替换。


## 归档预渲染稿（发布控制台产出）

`console/` 里那个本地发布控制台会做一件事：把某篇 Markdown 编译成**静态 HTML** 放进
`p/archive/`，把原文挪到项目根的 `para/` 留底，并在 `sk.json` 里登记产物的路径。
这一节说明**构建与阅读器这一侧是怎么认它的** —— 改之前先读这里。

- **谁渲染的**：`console/lib/render.mjs`，它 `createRequire` 复用**本目录的 `lib/markdown.cjs`**。
  也就是说归档产物和构建期预渲染用的是同一套语法实现，`p/docs-md.js` 一个字节都没改。
  产物形状：`<!-- 由发布控制台预渲染 -->` + `<div class="md">正文</div>` + 自包含的 head/页脚。
- **阅读器怎么认**（`build.mjs` 的 `DOCS_JS`）：
  `doc.kind === 'html'` 且路径以 `archive/` 开头 → `fetch` 产物 → `extractArchiveBody()`
  取出 `class="md"` 那个 div 的内容 → 当正文注入 → 接着走 `fixURLs / initCodeGroups /
  initTabs / addCodeCopyButtons / DocsCard.enhance / buildOutline`。
  顶栏角标这时显示「已归档」（未归档仍是 `static`）。
  放在别处的手写 `.html` **不受影响**，仍然按「HTML 源码」显示。
- **不用为归档重新构建**：清单是运行时 fetch 的，控制台写完 `sk.json` 刷新即可见。
  `部署.cmd full` 会自动构建并把 `p/archive/` 一起传上去。
- **`PRE_RENDER` 与它无关**：那个常量只管「构建期内联哪几篇原始 Markdown」，现在仍然只有 `TEST.md`。

> 注意：`DOCS_JS` 是 `String.raw` 模板字符串，**整段（含注释）都不能出现反引号**，
> 否则构建直接挂掉（§10.5）。给这段代码写注释时尤其容易踩。


## 已知限制

- **`{#id .class style="…"}` 这种多属性写法**：`markdown-it-attrs` 会把 `#id`
  当成选择器语义（值为 `id`）。`{#custom-heading}` 这种单 id 写法正常。
- **浏览器端渲染**意味着无 JS 时看不到正文。需要这个的话把文档加进 `PRE_RENDER`。

## 体积

| 文件 | 体积 |
|:--|:--|
| `p/docs.html` | ≈205 KB |
| `p/docs-md.js` | ≈1.43 MB（渲染器，含 KaTeX + highlight.js + 选项卡插件） |
| `p/docs-md.css` | ≈54 KB |
| `p/fonts/` | ≈254 KB（20 个 woff2） |

渲染器不用压缩工具，源码可读；平台侧如果有 gzip，实际传输会小很多。

## 部署：热铁盒（多个站）+ GitHub Pages

所有平台共用同一个 `dist/`，所以内容天然一致，不会出现两边不一样。

```
F:\@Project\node\                 ← 项目根（在这里跑部署命令）
├── .env                          ← RTH_API_KEY（已 gitignore，别外传）
├── rth-host.json                 ← 热铁盒 CLI 读的默认 site / outdir（watch 用）
├── rth-sites.json                ← ★ 要发到哪几个站 + 各自的域名（部署用这个）
├── package.json                  ← deploy / push 脚本
├── build/                        ← 构建工具（不进 dist）
├── jinsuper.rth1.xyz/            ← 网站本体
├── asset/                        ← 三篇 md（sk.json 用 ../asset/ 引用）
└── dist/                         ← 组装好的产物
    ├── .git/                     ← ★ GitHub 仓库就在这一层
    └── …（1500+ 个文件）
```

**为什么 GitHub 仓库根放在 `dist/` 而不是项目根**：GitHub Pages 会把仓库里的文件
原样发布。推项目根的话，`build/`、`node_modules/`、`.Skills/` 都会跟着公开；
而 `dist/` 恰好就是「该公开的那一份」，和热铁盒上传的完全相同。

### ⚠ `jinsuper.cn` 是热铁盒里**另一个站**，不是别名

这点很容易踩：`cli site list` 列出来是这样的 ——

```
class11
jinsuper        ← 默认域名 jinsuper.rth1.xyz
jinsuper.cn     ← 自有域名，独立的一个站
```

所以**只发 `jinsuper` 的话，`jinsuper.cn` 那边永远是空的**。
`deploy.mjs` 现在会挨个站发一遍，清单在项目根的 `rth-sites.json`：

```json
{
  "sites": [
    { "site": "jinsuper",    "domains": ["jinsuper.rth1.xyz"] },
    { "site": "jinsuper.cn", "domains": ["jinsuper.cn", "www.jinsuper.cn"] }
  ]
}
```

加站点就往 `sites` 里加一项，`domains` 是上传完要做可达性检查的域名。
只发其中一个：`部署.cmd rth --only jinsuper.cn`。

> 怎么确认是不是独立的站（而不是别名）：
> ```
> deno -Ar https://host.retiehe.com/cli site list
> ```
> 名字出现在这个列表里 = 独立站点，必须单独 deploy。

### 上传后会检查每个域名

**上传成功 ≠ 域名能打开。** 证书没签、DNS 没生效、域名没绑到站上，
这些 `deploy` 一步都不会报错，但你打开就是打不开。所以传完会挨个探一遍：

```
[4/4] 检查域名
  ✓ https://jinsuper.rth1.xyz/  →  HTTP 403 （403 是热铁盒的机器人拦截页，浏览器打开正常）
  ✗ https://jinsuper.cn/  →  证书不含这个域名（多半只给 www 签了，裸域要单独申请）
```

（热铁盒对非浏览器 UA 一律返回 403 的拦截页 —— 那也算「通了」，
说明 DNS、证书、路由都是好的。跳过这一步加 `--no-verify`。）

已知的一处：**裸域 `jinsuper.cn` 的证书只签了 `www.jinsuper.cn`**，
浏览器打开 `https://jinsuper.cn` 会报证书名称不匹配。
`www.jinsuper.cn` 和 `jinsuper.rth1.xyz` 都正常。
这个要在热铁盒控制台给裸域单独签发证书，跟部署脚本无关。

### 最省事：双击 `部署.cmd`

项目根下有个 `部署.cmd`，双击就出菜单（1 快速部署 / 2 只构建 / 3 只组装 /
4 传热铁盒 / 5 推 GitHub / 6 自检 / 7 本地预览 / 8 看改动 / 9 状态 / 10 备份源码）。

带参数就是普通命令行程序，不弹菜单、不再问确认：

```bat
部署.cmd                     :: 进菜单
部署.cmd full -y             :: 一条龙，不确认
部署.cmd full --no-build     :: 只改了几篇 .md，跳过重新构建（快很多）
部署.cmd full --no-check     :: 跳过自检
部署.cmd full --no-gh        :: 只发热铁盒
部署.cmd rth                 :: 只传热铁盒（挂了会自动重试 3 次）
部署.cmd gh                  :: 只推 GitHub
部署.cmd check               :: 渲染 / 结构 / DOM 三套自检
部署.cmd status              :: 站点 / dist / 密钥 / Deno / Git 一眼看完
部署.cmd bakup               :: 备份整个项目源码（和上面的部署无关，见「备份源码」）
部署.cmd --help              :: 全部命令和选项
```

`部署.cmd` 自己**不干活**，它只是把活转给 `build/deploy-cli.mjs`，
再由后者去调原来那几个脚本（`build.mjs` / `prep-deploy.mjs` /
`deploy.mjs` / `push-github.mjs` / 三个测试）。
这样命令行和 npm script 不会各做一套、慢慢长歪。

几个设计上的取舍：

- **`部署.cmd` 里一个字的中文都没有。** cmd.exe 是按「当前代码页」逐字节解码
  批处理文件的，而且它会按字节偏移回头重读。文件里只要有非 ASCII 字符，
  `chcp 65001` 一执行偏移就错位，cmd 会把某行的后半截当命令执行 ——
  实测中文注释真的被当成命令跑过。所以界面文案全在 Node 那边（Node 读 UTF-8 没这问题），
  这个 .cmd 只负责切目录、切码页、转发参数。改它的时候**务必保持纯 ASCII**。
- **`chcp 65001` 之前先记下原码页，退出时还回去**，免得污染你当前那个终端。
- **子进程一律 `stdio: 'inherit'`**，输出原样透到终端。部署工具不需要把
  上传日志攒在内存里，而且这样热铁盒 CLI 的进度条和颜色都还在。
- **热铁盒那步会自动重试 3 次**。这台机器实测偶尔会
  `error reading a body from connection`，上传本身是幂等的，重跑安全。
- **只有 `yes/no` 的确认会在 stdin 断开时判定为「取消」**，
  绝不因为「读不到输入」就默认往下部署。
- **本地预览会先探测端口再启动。** 8788 上已经开着本站预览时，它不会去撞
  `EADDRINUSE`，而是直接把地址告诉你（这是最常见的情况：上次的预览还开着）。
  端口被**别的**程序占着就自动往后找一个空的（最多 +20），要指定端口用 `--port N`。
  预览服务器每次请求都从磁盘现读，所以改了文件不用重启，刷新即可。

### 一条命令，两个平台

```bash
npm run deploy          # 组装 → 传热铁盒 → 推 GitHub
npm run deploy -- --no-github   # 只传热铁盒
npm run push            # 只推 GitHub
npm run push:check      # 只看会提交什么，不推
```

`npm run deploy` 依次做：

1. **组装 `dist/`** —— 把 `jinsuper.rth1.xyz/` + `asset/` 拼进去（增量，见下）
2. **准备 Deno** —— 系统里有就用系统的；没有就用项目里 npm 装的
   （首次会自动 `npm install deno`，不动系统环境）
3. **传热铁盒** —— 按 `rth-sites.json` 挨个站跑官方 CLI（每个站失败自动重试 3 次）
4. **检查域名** —— 逐个 `domains` 探一遍，证书/DNS 有问题当场指出来
5. **推 GitHub** —— `git push` 到 `JinSuper.github.io`

> 第 5 步失败**不会**让整个命令失败——热铁盒那边已经成功了。
> 单独重试 `npm run push` 即可。
> 反过来，热铁盒有站没传上去会**以失败退出**，并且不推 GitHub ——
> 免得两个平台内容对不上还以为都好了。

### GitHub Pages 首次要手动开一次

仓库建好了、代码也推上去了，但 **Pages 默认是关的**（实测 API 返回 404）。
去这个页面开一次：

```
https://github.com/JinSuperOfficial/JinSuper.github.io/settings/pages
```

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main` + `/ (root)`
- 保存后等一两分钟

之后每次 `npm run push` 都是自动发布，不用再管。

### 认证

`git push` 需要凭据。最省事是用 Personal Access Token（勾 `repo` 权限）：

```bash
git -C dist remote set-url origin https://<TOKEN>@github.com/JinSuperOfficial/JinSuper.github.io.git
```

或者本机配好 SSH 后换成 `git@github.com:...`。
**别把带 token 的地址写进任何会被提交的文件。**

> 本机装了 GitHub CLI 且 `gh auth login` 过的话，`git` 会自动借它的凭据，
> 上面这一步就不用做了（备份源码那条线同样是这套凭据）。

### 网络：github.com 要走代理

实测直连 `github.com` 不通、走本机代理可通（`api.github.com` 反而直连就行）。
`push-github.mjs` 已经内建处理：优先用环境里的 `https_proxy` / `http_proxy`，
没有就退回 `http://127.0.0.1:7890`。所以不用额外配 git 的全局代理。

### 备份源码（另一条线，和发布无关）

`build/backup-github.mjs` 把**整个项目源码**推到备份仓库
`https://github.com/JinSuperOfficial/JinSuperKitBakup.git`：

```bat
部署.cmd bakup                      :: 提交并推送（会问要不要打 tag）
部署.cmd bakup --check              :: 只看会备份什么（不提交、不推、不打 tag）
部署.cmd bakup -m "说明"            :: 自定义提交信息
部署.cmd bakup --tag v1.0.0         :: 顺手打个版本 tag 并推上去
部署.cmd bakup --tag                :: tag 名用时间戳（bakup-20261004-0842）
部署.cmd bakup --tag v1.0.0 --tag-message "第一个可回滚的版本"
npm run bakup / bakup:check         :: 同上的 npm 写法
```

**为什么要显式打 tag**：`git push <远程> <分支>` 默认**不带 tag**，
所以光备份分支的话 GitHub 的「标签」页永远是空的。要留版本记号，
就用 `--tag`（或在 TUI 里的 `版本 tag` 那一栏填名字，默认 `v1.0.0`）。
打的是**附注 tag**（带说明、作者、日期），推的时候单独 `git push --tags` 一次。

它和 `push-github.mjs` 是**两条完全独立的线**，故意不共用代码：

| | 工作目录 | 内容 | 目标仓库 |
|:--|:--|:--|:--|
| `push-github.mjs` | `dist/`（自己那份 `.git`） | 发布出去的网页产物 | `JinSuper.github.io` |
| `backup-github.mjs` | 项目根（`.git`） | 源码全量 + 版本 tag | `JinSuperKitBakup` |

- **不进任何部署管线**（`full` 里没有它），失败也不影响部署；反过来部署也不会顺手推源码。
  所以「部署包括什么」这件事没有因为多了备份而变化。
- 排除规则就是项目根的 **`.gitignore`**：`node_modules/`、`dist/`、`.env`、`.npm-cache/`、
  `.deno-cache/`、`.deploy-logs/`、`*.log` 都不会进备份。
- 额外还会跳过**自带 `.git` 的子目录**（现在只剩 `dist/`）。
  交给 `git add -A` 的话它们只会被记成一个 commit 号（gitlink 空壳），源码根本没备进去 ——
  脚本会把这些路径列出来并提醒；想让它们真的进备份，要么删掉里面的 `.git`，
  要么在 `.gitmodules` 里声明成正经的 submodule。
- 单文件超过 95 MB 会提前停下报错（GitHub 硬线 100 MB），不会等传一半才失败。
- 本地领先远程时会先 `fetch` + 合并，避免「非快进」被拒；
  远程分叉到自己解决不了时会明确告诉你怎么手动合。
- tag 名交给 `git check-ref-format` 判合法性（不自己写正则）；重名不覆盖，只提醒。
- 认证 / 代理失败的原因会分开提示（`push-github.mjs` 是同一套逻辑）。
  带 token 的 URL 会先被抹掉再打印，免得把密钥写进日志。
- tag 没推成功**不算整体失败**：本地 tag 还在，重跑一次 `部署.cmd bakup --tag <同名>` 会补推。

### 部署细节

> 为什么不用 `rth-host.json` 的 `build` 字段来组装：
> CLI 一看到 `build` 就会先执行 `npm install`，那一步依赖子进程 stdio，
> 在受限环境里会静默退出（实测踩过）。组装我们自己在本进程里做更可控。
> 所以 `rth-host.json` 只留 `site` 和 `outdir`。

其他命令：

```bash
npm run deploy:prep    # 只组装，不上传
npm run deploy:check   # 组装并逐个列出文件
npm run deploy:raw     # 直接调热铁盒 CLI（自己确保 Deno 在 PATH 里）
```

### asset/ 不会重复上传

`prep-deploy.mjs` 是**增量**的：源文件与 `dist/` 里已有副本比 sha256，
内容没变就原样不动（时间戳也不刷新）。

增量只解决「新增/更新」，所以它还有一步**清理**：源站已经删掉的文件
（比如换成 SVG 后的旧 `favicon.png`）会从 `dist/` 里一并删掉，
不然它们会被一直传上去。

例外：`dist/.git` 整个跳过（推送 GitHub 要用），根部的
`CNAME` / `.nojekyll` / `.gitignore` 保留（GitHub Pages 的配置，不属于源站内容）。

而部署工具本身也会比对服务器内容，**实测结果**：

```
Skipped: asset/icon/1_1.svg - not changed
...（600+ 个）
Uploading: p/docs.html
All files uploaded.
```

改动一个 `docs.html` 时：**上传 1 个、跳过 600+ 个**。

> `asset/` 有 603 个文件（主要是图标 SVG），但总共只有 0.5 MB，
> 而且**首屏完全不碰它**——只有打开引用它的文档时浏览器才去取。
> dist 整体 3.36 MB，同样与首屏无关（首屏只需要 docs.html + css + js + 字体）。

### 本地预览

```bash
npm run serve          # http://127.0.0.1:8788/p/docs.html
```

### 云函数

`p/raw.php`、`Skills/tools/hw-api.php` 会跟着 `dist/` 一起上传。
`watch` 模式（`npm run watch`）会在保存 `.php` 时自动部署，方便调云函数。

### 前置条件

- **Deno 2.8+**（`deno --version` 检查）。部署脚本跑在 Deno 上，Node 只是用来组装产物。
- 首次部署如果 CLI 提示要确认站点，按 `rth-host.json` 里的值回答即可
  （site=`jinsuper`，无构建输出目录）

## 沙箱环境注意

- npm 默认缓存目录在工作区外会被文件沙箱拒绝（`EPERM`），
  `build/.npmrc` 已把 `cache` 指到工作区内。
- `esbuild` 在这个沙箱里**完全不可用**（任何 API 都要 spawn 子进程，撞命名管道限制），
  所以打包器是自己写的，见 `lib/bundler.mjs`。
