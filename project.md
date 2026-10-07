# 项目交接文档 · JinSuper 站点

> 交接日期：2026-09-27
> 接手人：＿＿＿＿　交接人：＿＿＿＿

---

## 1. 这是什么

个人站点「百宝箱」+ 一份自建的博客／文档站（**JinSuper 奇思妙想**，阅读器在 `/p/docs.html`）。纯静态，没有后端、没有数据库、
没有构建服务，所有内容都是文件。前端不引用任何 CDN、不加载外部字体、不用 base64
（这三条是托管平台的硬规则，见 §8）。

代码在 `F:\@Project\node`，网站本体在 `F:\@Project\node\jinsuper.rth1.xyz`。

**它不是 git 仓库**（项目根没有 `.git`）。唯一受版本管理的是 `dist/` ——
那是给 GitHub Pages 用的发布仓库。源文件本身没有版本控制，改之前建议自己先备份。

---

## 2. 现在跑在哪

| 平台 | 站点 / 仓库 | 域名 | 状态 |
|:--|:--|:--|:--|
| 热铁盒 | 站点 `jinsuper` | https://jinsuper.rth1.xyz | ✅ 正常 |
| 热铁盒 | 站点 `jinsuper.cn` | https://www.jinsuper.cn | ✅ 正常 |
| 热铁盒 | 站点 `jinsuper.cn` | https://jinsuper.cn | ⚠️ **证书错误**，见 §10.2 |
| GitHub Pages | `JinSuperOfficial/JinSuper.github.io` | https://jinsuperofficial.github.io/ | ✅ 正常，未绑自定义域名 |

热铁盒账号里还有第三个站点 `class11`，跟本项目无关，别动。

三个热铁盒域名指向同一台前端（`f.rthe.cn` / `143.198.246.217`），平台按 Host 头
路由到对应站点。**`jinsuper` 和 `jinsuper.cn` 是两个独立的站**，这是本项目最容易踩的坑。

---

## 3. 目录结构

```
F:\@Project\node\
├── 部署.cmd                  ← 双击就能用；发布入口，见 §5
├── 控制台.cmd                ← 双击启动本地发布控制台（见 §4.5），纯 ASCII 启动器
├── package.json              ← npm 脚本（deploy / push / build / check / serve / console）
├── rth-sites.json            ← ★ 要发布到哪几个热铁盒站点 + 各自的域名
├── rth-host.json             ← 热铁盒 CLI 读的默认 site/outdir（只给 watch 用）
├── .env                      ← RTH_API_KEY，见 §11
├── .gitignore / .npmrc       ← 沙箱用：npm 缓存指到工作区内
│
├── console\                  ← ★ 本地发布控制台（写作/管理/归档/素材/设置）。**不进 dist**
│   ├── server.mjs            ← node:http：静态资源 + /api 路由，只监听 127.0.0.1
│   ├── lib\paths.mjs         ← 路径唯一来源（站点根 / p / 归档 / 留底 / 状态文件）
│   ├── lib\store.mjs         ← sk.json 读写（保形）、/p 扫描、归档元数据、原子写
│   ├── lib\render.mjs        ← 预渲染器：复用 build\lib\markdown.cjs，一个字节都不碰 docs-md.js
│   ├── lib\api.mjs           ← 接口实现（扫描/读写/发布/归档/重建/回滚/队列/预览）
│   ├── web\                  ← 前端：index.html + console.css + app.js，零依赖
│   ├── test\console.test.mjs ← node:test 23 条，全在临时 fixture 上跑（不碰真站点）
│   └── state.json            ← 控制台设置 + 归档元数据（不进 dist）
│
├── para\                     ← ★ 归档原文留底（站点之外；只有归档过才会出现）
│
├── jinsuper.rth1.xyz\        ← ★ 网站本体（会被完整上传）
│   ├── index.html            「百宝箱」首页
│   ├── 404.html / robots.txt / sitemap.xml
│   ├── favicon.svg           ← 由 make-favicon.mjs 从 logo.svg 生成
│   ├── apple-touch-icon.svg
│   ├── sk.json               ← ★ 文档站清单，加文档改这里
│   ├── site.json             ← ★ 站点级目录：有哪些 collection、sitemap 额外条目、校验忽略名单
│   ├── lib\manifest.js       ← ★ 站点运行时：清单归一 / 排序 / 去重 / 图标注册表（四个卡片页共用）
│   ├── sitemap.xml           ← 生成物（build\gen-site-index.mjs），别手改
│   ├── 811\                  ← ★ 八年(11)班专区：index.html 工具箱 + homework.html
│   │                             + classtable.html + english.html（英语听力音频）
│   │                             + tools.json（本区清单）+ data\homework.json + data\english\
│   ├── p\                    ← ★ 博客／文档站（详见 §5.1）
│   │   ├── index.html        ← ★ 博客首页（构建产出：最新 + 标签筛选 + 时间线；旧的写作台已舍弃）
│   │   ├── post\             ← ★ 文章页（构建产出：每篇一个独立网址，给搜索引擎）
│   │   ├── feed.xml           ← ★ 订阅源（构建产出，RSS 2.0）
│   │   ├── blog.md            ← 写作指南：frontmatter 字段与产物说明
│   │   └── archive\          ← ★ 归档预渲染稿（控制台产出，会被一起上传）
│   ├── Skills\               ← 小工具集合（函数显示器、测速、HTML 在线运行…）
│   ├── docs\  web\  old\  public\
│   └── asset\                ← 站点自己的静态资源（604 个，含 logo.svg）
│
├── asset\                    ← 图标库（603 个，会被合并进 dist\asset\，见 §10.3）
├── .Skills\                  ← 参考资料（retiehe-web），不发布
│   （theme-plus 已移出仓库，变成 DSH 全局技能：F:\@AI\skills\theme-plus\）
│
├── build\                    ← ★ 构建与部署工具，**不发布**
│   ├── README.md             ← 构建系统详细文档，改渲染器/样式前必读
│   ├── build.mjs             ← 构建入口
│   ├── lib\markdown.cjs      ← 渲染核心（Node 与浏览器共用同一份）
│   ├── lib\bundler.mjs       ← 自写的 CJS 打包器（为什么不用 esbuild 见 §10.6）
│   ├── template\             ← 页面模板（改 docs.html 改这里！）
│   ├── lib\site-index.mjs    ← 生成 sitemap.xml + docs\info\site-index.js
│   ├── lib\site-lib.mjs      ← 在 Node 里载入站点自己的 lib\manifest.js
│   ├── gen-site-index.mjs    ← 扫盘 + 读清单，产出站点索引（--check 只比对）
│   ├── verify-manifests.mjs  ← ★ 清单校验：schema、id 唯一、文件存在、生成物新鲜度
│   ├── test-manifest.mjs     ← ★ 卡片页 jsdom 验收 + 与 dist 对照
│   ├── prep-deploy.mjs       ← 组装 dist\
│   ├── deploy.mjs            ← 组装 → 上传所有热铁盒站点 → 检查域名 → 推 GitHub
│   ├── deploy-cli.mjs        ← 部署.cmd 背后的菜单/命令行程序
│   ├── push-github.mjs       ← 只推 GitHub（推的是 dist\ 的网页产物）
│   ├── backup-github.mjs     ← 备份整个项目源码到 JinSuperKitBakup（与发布无关）
│   ├── lib\git-backup.mjs    ← 上面那个用的源码仓库封装（和 lib\git-dist.mjs 分开）
│   └── test-render / verify / test-dom .mjs   ← 另三套测试
│
└── dist\                     ← 组装产物 + GitHub Pages 仓库（.git 在这一层）
```

> 项目根也有一个 `.git`：那是**源码备份仓库**（`部署.cmd bakup` 推的），
> 和 `dist\.git`（GitHub Pages 发布仓库）不是同一个，别弄混。详见 §5.2。

---

## 4. 三件日常事

### 4.1 加一篇文章

1. 把 `.md` 放进 `jinsuper.rth1.xyz\p\`（可以带子目录）
2. 正文顶上写一段 frontmatter（标题 / 日期 / 标签 / 摘要），字段表见 `MANIFEST.md` §7.1
3. 在 `jinsuper.rth1.xyz\sk.json` 里加一行：

```json
{
  "分组名": {
    "文档标题": "文件名.md"
  }
}
```

4. 刷新阅读器就能看到（清单是运行时读的，**不需要重新构建**）
5. 要让搜索引擎也看到这篇的独立网址（`/p/post/…`），跑一次构建：`部署.cmd build`
6. 发到线上：双击 `部署.cmd` → 选 1

### 4.2 改站点页面 / 样式

- 改**文档站**的模板和样式要动 `build\template\`，**不是** `p\docs.html`
  （后者是构建产物，下次构建会被覆盖）
- 改完必须重新构建：`部署.cmd build`（或菜单选 2）

### 4.3 加一个工具（只改 json，不碰 HTML）

1. 页面放进站点目录，例如 `jinsuper.rth1.xyz\811\newtool.html`
2. 在对应清单的 `items` 里加一条 —— 工具站是 `Skills\skills.json`，811 是 `811\tools.json`：

```json
{
  "id": "newtool",
  "title": "新工具",
  "desc": "一句话介绍。",
  "href": "/811/newtool.html",
  "icon": "wrench",
  "order": 30
}
```

3. 刷新页面（清单是运行时 fetch 的，**不用重新构建**）。
   首页 / 工具站 / 811 中枢三处同时出现；`hidden: true` 下线，`order` 调顺序。
   字段与图标规则见项目根的 **`MANIFEST.md`**；图标名不够用时在 `lib\manifest.js` 的 `ICONS` 里加一个。

改完清单跑一次：`node build\verify-manifests.mjs && node build\test-manifest.mjs`
（这两个也挂在 `部署.cmd check` 与 `full` 的快速自检里，清单写错会拦住发布。）

> `sitemap.xml`、`docs\info\site-index.js` 是 `build\gen-site-index.mjs` 扫盘生成的，别手改；
> `部署.cmd build` 会顺带重新生成，`verify-manifests.mjs` 会发现过期。

### 4.4 发布

```
双击 部署.cmd          → 进 TUI（分步向导 + 底部状态栏），选一件事、逐条开关步骤、跑
部署.cmd full -y       → 一条龙（纯文本输出）：构建 → 自检 → 组装 → 热铁盒 → GitHub
部署.cmd rth           → 只发热铁盒
部署.cmd gh            → 只推 GitHub
部署.cmd diff          → 看会提交什么（不推）
部署.cmd bakup         → 备份整个项目源码（独立功能，见 §5.2）
部署.cmd --plain       → 不进 TUI，用原来的纯文本菜单
部署.cmd --tui rth     → 直接进「传热铁盒」那条计划的确认页
部署.cmd status        → 看当前状态
部署.cmd --help        → 全部命令
```

- **TUI 用 ink（React）写**，形态是「菜单 → 计划确认（可逐条开关步骤）→ 执行（步骤 + 实时日志 + 状态栏）→ 结果」。
  依赖装在 `build/node_modules`（`cd build && npm install`）：**没装也不影响部署** —— 会自动回落到原来的纯文本菜单。
- 每一次运行都会在项目根 `.deploy-logs/` 留一份完整日志（界面里只显示尾部，路径在界面上给了）。
- TUI 跑子进程时**只抓输出重绘，不把终端交给它**；管道不可用的环境会自动退到「日志文件当子进程 stdout」。
- 命令行传了子命令（`full` / `rth` / `check` …）时一律走纯文本模式：脚本调用、日志重定向、退出码都和以前一样。

发布前想跳过自检加 `--no-check`；只改了几篇 `.md` 想跳过构建加 `--no-build`。

**部署这层唯一的定义在 `build/lib/pipeline.mjs`**：哪些脚本、什么顺序、什么参数只写一份，
三个前端都从它取 —— `deploy-cli.mjs`（命令行）、`build/tui/`（TUI）、`build/run-pipeline.mjs`
（子进程 + JSON Lines，给发布控制台用）。加一步只改那一张表。

### 4.5 用发布控制台（写作 / 管理 / 归档）

双击项目根的 **`控制台.cmd`**（或 `npm run console`）→ 起在 `http://127.0.0.1:8791/` 并自动开浏览器。
它**只监听本机**，是本地工具：`console\` 不参与构建、`prep-deploy.mjs` 的忽略名单里有它，绝不会被上传。

五个面板：

| 面板 | 干什么 |
|:--|:--|
| 写作 | 左编辑右预览（预览走服务端渲染核心，和阅读器同一套语法）；`Cmd/Ctrl+S` 保存、`+B/+I/+K/+E` 加粗/斜体/链接/公式，`Tab` 缩进；草稿自动存 localStorage |
| 管理文章 | 扫 `/p` 下**全部**文件（含没登记的临时稿），状态分「草稿 / 已发布 / 已归档 / 未发布」；搜索、排序、分组折叠、多选批量（归档选中 / 取消归档 / 删除 / 移动分组 / 重命名） |
| 文档清单 | 直接编辑 `sk.json`：**表格**（改标题/路径、换组、排序、加分组）+ **源码**（原始 JSON，实时校验再保存，坏文件先备份）双模式；「扫描清单」列出问题（文件不存在、重复登记、空分组、写法混用、归档标题缺后缀…）并**一键修复**，还能把 `/p` 下没登记的文件勾选登记 |
| 归档与预渲染 | 左右两列，只处理勾选的：归档把 Markdown 编译成静态 HTML 放进 `/p/archive/` 并在 sk.json 登记；支持重新构建选中、**重刷外壳**（正文不动，按当前模板重写 head / 顶栏 / 目录 / 页脚，原文没留底也能刷）、回滚上一版、取消归档 |
| 素材库 | `/p` 下的图片 / PDF / 音视频，灯箱、试听（直接读静态文件，没有专门接口）、复制路径、删除 |

### 写作面板的预览：和文档站长一样，还多画几张图

预览的 HTML 一直是**服务端渲染核心**（`build/lib/markdown.cjs`）出的，和阅读器同一套语法；
以前缺的是**样式**和**图表**，现在补齐了（**只影响控制台，站点产物一个字节都不变**）：

- **样式**：`console/web/index.html` 直接把站点那两份引进来 —— `/p/docs-md.css`
  （公式 / 高亮 / 告示 / 提示框 / 选项卡 / 代码组 / 剧透 / 目录 / 脚注 / 任务列表…）
  和 `/p/docs-card.js`（卡片 `<card>` + `DocsCard.enhance()` 兜底）。
  控制台服务的静态根本来就兜到站点根（`server.mjs` 的 `STATIC_ROOTS`），所以直接能取到。
  预览里的基础排版（标题 / 段落 / 表格）在 `console.css` 里，**一律用 `.md` 这一档权重**——
  写成 `#preview p` 会多一个 id，把 `p/docs-md.css` 里 `.md a.card`、`.md .md-ext-note`
  这类扩展样式全压掉（卡片会变链接色、提示块间距会跑），这一点别改回去。
- **图表**（站点里是「已下线」，预览里真画）：
  - ```echarts —— Node 端 **ECharts SSR**，直接出**内联 SVG**（离线、无需前端脚本，
    所以归档产物也能烘进去，自包含）；
  - ```mermaid —— 服务端只留 `.mermaid.md-mermaid` 占位，浏览器加载控制台本地提供的
    `build/node_modules/mermaid/dist/mermaid.min.js`（路由 `/vendor/mermaid.min.js`）现画；
  - ```plantuml / flow / dot 之类要外部渲染服务，离线不接，预览里**明说画不出来**。
- **能力状态**：预览右上角一条小字（`✓ ECharts 图表 · ✓ Mermaid 图表 …`，悬停看细节）；
  这篇用了画不出来的语法，就在预览上方出一条提示条 —— 不安静退化。
- **归档自包含**：`renderArticleHtml` 走 **bake 实例**，只烘「能变成静态标记」的（ECharts）；
  mermaid 这类要浏览器运行时的退回代码块，并随 `/api/archive`、`/api/archive/rebuild`
  的 `warnings` 回给界面提示。**归档 HTML 不引用任何外部插件脚本。**

实现分三层，改之前先看这三处：

| 文件 | 管什么 |
|:--|:--|
| `build/lib/markdown.cjs` | `createRenderer({ setup })`：可选外挂装配钩子（站点构建不传，行为不变）；`renderWith(md, src)` 渲染前重置标题计数 |
| `console/lib/md-extras.mjs` | 外挂本体：能力探测（装了/没装、能不能烘）、ECharts SSR、mermaid 占位、围栏接管、`scanUnsupported()` |
| `console/lib/render.mjs` | 两个懒建实例：`preview`（增强全开）与 `bake`（只烘静态内容）；`renderFragment(md, { mode })` |
| `console/md-plugins.json` | **外部 markdown-it 插件清单**：`package` / `export` / `umd` / `options`。装在 `build/` 里，改完刷新页面即可；装不上会在状态里标 ✗ 并给原因（`@mdit/*` 是 ESM 包，这里会用它的 UMD 兜底加载，见 `md-extras.mjs` 的 `loadUmd`） |

验收：`node --test console/test/md-extras.test.mjs`（图表 / 提示 / 归档自包含 / 坏配置不炸）。

除了这五个，控制台还多了五个面板（`控制台.cmd` / `控制台.sh` 里点左侧导航）：

| 面板 | 干什么 |
|:--|:--|
| 预览 | **一键列出站点所有页面**：按「清单优先、目录兜底」建一棵可折叠的树（site.json 的 collections → 工具站 / 811 专区，sk.json → 文档站，其余 `.html` 归到「目录扫描」），搜索 / 按类型筛选 / 隐藏忽略项；点页面就在浏览器新标签里打开。顶部 **Server On** 起一个只服务站点根的预览服务（默认 `127.0.0.1:8790`），关掉点 Server Off |
| 发布与部署 | 一键「部署并推送」（构建 → 自检 → 组装 → 热铁盒 → GitHub），**步骤 + 实时日志 + 中止**；也可以只跑其中一步；「发布队列 + 部署」把队列入队、查清单、部署串成一条链 |
| 同步与合并 | 三方比对：**本地源树 / `dist`（上次部署）/ 线上**，来源可选 **GitHub**（完整清单）或**热铁盒**（逐个探测）；逐项「取回云端」（覆盖前自动备份到 `console/backups/`）、批量取回；「部署前预检」列出会覆盖什么、可能删掉云端什么、清单问题与域名/证书状态 |
| 检查 | 死链与资源检查：用真渲染器解析 `/p` 下的 Markdown（链接/图片/`<card>` 目标）、归档产物里的 href/src，报出文件与行号 |
| 本地 / 线上 | 同一篇左边本机预览、右边线上实况，一眼看出「改了还没部署」 |

预览面板的三条约定：

- **页面树只读**（`console/lib/pages.mjs`）：不写清单、不改文件；缺 site.json 或缺某个 collection
  只是少一块，其余照常列。登记过的 `.md` 走阅读器 deep-link（`/p/docs.html#<清单里的 path>`），
  路径一律站点绝对路径（`/p/docs.html`）。
- **别拿控制台自己的 8791 当预览**：那个端口上 `/index.html` 是控制台自己的页面，会把站点首页顶掉。
  预览是**另一个端口、只服务 `jinsuper.rth1.xyz/`**，路径和线上一致；`/p/raw.php?f=…` 照
  `build/.serve.mjs` 的语义模拟（线上是云函数），文档站在预览里也能拿到 Markdown 原文。
- **默认行为在「设置 → 预览」**：端口、进面板自动开服务、开服务后打开首页、
  点页面的默认行为（没开就先开再打开 / 只打开 / 只复制路径）、页面清单来源（自动 / 清单 / 目录）。

预览服务也可以不开界面单独起（headless，只服务站点根）：

```
./控制台.sh server             # 默认端口（设置里的 previewPort，8790）
./控制台.sh server --port 8793 # 换端口
./控制台.sh server --no-open   # 不开浏览器
```

这四件事（发布与部署 / 同步与合并 / 检查 / 本地↔线上）的分工与边界：

- 部署作业是**子进程** `node build/run-pipeline.mjs --steps=… --json`，用 JSON Lines 报进度；
  控制台只做「解析 + 落日志文件（`console/logs/<id>.log`）+ 按字节偏移增量读」。同时只允许一个作业。
- 控制台**只能**跑服务端白名单里的管线（`full/build/quickCheck/check/prep/rth/gh/diff`）与固定开关，
  前端传不了任意命令。
- 热铁盒**没有列目录/下载接口**（官方文档只有 `init`/`deploy`/`watch`），所以「云端全集」是推导出来的：
  本地全集 + 线上 `sk.json`/`sitemap.xml`/`docs/info/site-index.js` 引用到的路径 + `dist` 历史上删过的路径。
  枚举不到的「没登记又没人引用的孤儿文件」查不出来 —— 界面上如实写了这条限制。
- `console/` 仍然不进 `dist`（`prep-deploy.mjs` 的忽略名单里有它），备份与日志都写在 `console/` 下。
| 设置 | 控制台主题、编辑器字号、自动保存间隔、归档输出路径、原文留底路径、sk.json 路径、危险操作二次确认 |

**拖拽入队**：任意面板把文件拖进窗口 → 进「待发布队列」，可改目标路径 / 标题 / 分组 / 是否同时归档。
默认**不归档**，直接写进 `/p`（临时文件就能马上用）；勾了「同时归档」才会预渲染。重名可选覆盖 / 自动改名 / 跳过。

关于归档的四条约定：

1. **归档是可选的，不是发布前提**。没归档的 `.md` 留在 `/p`，由阅读器运行时渲染。
2. **原文会离开 `/p`**：移到项目根 `para\<原相对路径>` 留底（站点之外，不会被上传）。
   产物写 `/p/archive\<同结构>.html`，sk.json 里登记成 `p/archive/...`（名字自动加「（归档）」后缀）。
3. **产物是成品**：阅读器读到 `/p/archive/*.html` 会直接把它里面的正文注入页面，顶栏角标显示「已归档」，
   不再走浏览器端渲染器。旧版本留在 `/p/archive/.versions/`（保留最近 2 版），可回滚。
4. **外壳和静态文章页共用一份**（`build\lib\chrome.mjs`）：站点顶栏、侧栏目录、`.wrap` 单列 / 两列、
   样式（`template\post-chrome.css`）、脚本（`template\post-script.js`）、主题 token 都从那儿来，
   所以归档稿看起来、用起来和 `/p/post/*.html` 一样。
   **改了外壳，老产物要「重刷外壳」**（面板上那颗按钮 / `POST /api/archive/reshell`）：正文不动，
   只重写 head / 顶栏 / 目录 / 页脚，覆盖前留一版 —— 原文没留底的老归档也能补上顶栏和目录。

预渲染器**复用** `build\lib\markdown.cjs`（构建期那份服务端渲染核心），所以能力与 `docs-md.js` 一对一：
KaTeX、代码高亮 / 行号 / 高亮行、表格、任务列表、告示、提示框、选项卡、代码组、剧透、脚注、卡片、目录都在。
`docs-md.js` 一个字节都没改。

控制台自己的测试（24 条，含归档→重建→重刷外壳→回滚→取消归档整条链、页面树与预览服务）在**临时 fixture 站点**上跑，不碰真实站点：

```
node console\test\console.test.mjs     （或 npm run console:test）
```

### 4.6 英语听力页（`/811/english.html`）

811 专区里的英语音频页：Unit 1–5 的课文录音，按单元分组、可折叠、单元内连着播，
底部有迷你播放条（进度可拖、倍速 0.75×–1.5×）。键盘：`空格` 播放暂停、`←→` 快退进 5 秒、`↑↓` 换曲、`/` 聚焦搜索。

- **数据与音频都是静态文件**：清单 `/811/data/english/index.json`，音频 `/811/data/english/<单元>/<文件>.mp3`。
  页面上 `<audio>` 直接引用这些路径 —— **不需要任何接口**，也和 `console\` 没有任何关系。
- 加一条音频 = 把文件丢进对应单元目录 + 在 `index.json` 的 `units[].tracks` 里加一行（`file` 写相对路径）。
- 卡片出现在首页与 `/811/`：它只是 `811\tools.json` 里的一条普通条目（`id: english`），
  图标名 `audio` 在 `lib\manifest.js` 的 `ICONS` 里。

---

## 5. 发布链路

```
部署.cmd                    纯 ASCII 启动器：切目录、切 UTF-8 码页、转发参数
  └─ build/deploy-cli.mjs   菜单 / 命令行，负责交互和步骤编排
       ├─ build/build.mjs           重新生成 docs.html / docs-md.js / docs-md.css / fonts
       ├─ test-render + verify      快速自检（不过就拦下发布）
       └─ build/deploy.mjs          组装 → 逐个站点上传 → 检查域名
            ├─ prep-deploy.mjs      jinsuper.rth1.xyz\ + asset\ → dist\（增量 + 清理）
            ├─ 热铁盒 CLI（Deno）    每个站点跑一次，失败自动重试 3 次
            └─ push-github.mjs      git push dist\ → GitHub Pages
```

关键点：

- **只有热铁盒站点上传成功才会推 GitHub**。有站点没传上去会以失败退出，
  免得两个平台内容对不上还以为都好了。
- **GitHub 推失败不影响热铁盒**（那边已经成功了），只提示。
- 站点清单在 `rth-sites.json`。加站点就往里加一项，`domains` 是上传后要检查的域名。

### 5.1 博客／文档站（p\）是怎么工作的

对外它是博客 **JinSuper 奇思妙想**（名字 / 简介 / 主域名在 `site.json` 的 `blog` 段），
内部还是那套东西：`p\docs.html` 是**静态页面 + 浏览器端渲染器**，Markdown 在浏览器里现场排版。

- `p\docs-md.js`（1.45 MB）= 打包好的渲染器（markdown-it + KaTeX + highlight.js + 插件）
- `p\docs-md.css` + `p\fonts\`（20 个 woff2）= 样式与公式字体
  （正文排版现在住在这份 CSS 里，阅读器和文章页共用，见 `build\template\docs-content.css`）
- `p\raw.php` = **云函数，别删**。热铁盒会把 `.md` 直接渲染成 HTML 再返回，
  公式源码在这一层就丢了；`raw.php` 能取到真原文，公式才完整
- 布局是「整页滚动」：左边栏与目录**嵌在页面里、不跟随滚动**（无边框、不铺底色），站点顶栏常驻在最上面；顶栏、博客首页、文章页共用同一份导航（`build/build.mjs` 的 `siteNavHtml()`），当前项：博客 / 时间线 / 标签 / 阅读器 / RSS / 百宝箱（工具站不再单列，总入口只留「百宝箱」）
- `p\index.html` = **博客首页**（构建产出）：最新几篇 + 标签筛选 + 时间线，模板在 `build\template\blog.html`；以前这里是个浏览器端写作台，已经舍弃。
  「最新」只放活稿，**时间线与标签里活稿 + `/p/archive/` 归档稿一起列**（归档条目带一枚「归档」徽标，标签栏里也有一枚「归档」可单独筛）；百宝箱首页的博客卡片指向这一页（不是阅读器）
- `p\post\` 与 `p\feed.xml` = **构建产出**：每篇文章一个独立网址（服务端渲染 + frontmatter 元数据 +
  canonical / OG / JSON-LD + 上下篇），加上 RSS。搜索引擎收录的是这一份，
  `/p/docs.html#某篇.md` 那种 hash 地址在爬虫眼里还是同一页（字段表见 `MANIFEST.md` §7.1）
- §10.1 讲了为什么改 `p\docs.html` 是错的

### 5.2 备份源码（另外一条线，和发布互不影响）

发到线上的是 `dist\`（网页产物），源码本身另有一条备份通道：

```bat
部署.cmd bakup --check     :: 先看会备份什么（不提交、不推、不打 tag）
部署.cmd bakup             :: 提交并推送（会问要不要打 tag）
部署.cmd bakup --tag v1.0.0 :: 顺手打个版本 tag 并推上去
```

- 目标仓库 **`https://github.com/JinSuperOfficial/JinSuperKitBakup.git`**（和发布用的
  `JinSuper.github.io` 不是同一个）。它和 `dist\.git` 是两份独立的仓库，别混。
- 推的是**项目根**那份 `.git` 里的**源码全量**（约 1400 个文件 / 46 MB），
  遵守项目根 `.gitignore`：`node_modules`、`dist`、`.env`、`.deploy-logs`、各种缓存都不进。
- **版本标记靠 tag**：`git push <远程> <分支>` 默认**不推 tag**，所以不打 tag 就没有，
  GitHub 的「标签」页会一直是空的。要留可回滚的版本记号就用 `--tag`（TUI 里是
  `版本 tag` 那一栏，默认 `v1.0.0`）；打的是附注 tag，推的时候单独 `git push --tags`。
  重名不覆盖，只提醒换个名字。
- **不进 `full` 管线**：`build\lib\pipeline.mjs` 里没有它，`JOB_PIPELINES`（控制台白名单）里也没有，
  所以备份失败不会影响部署，部署也不会顺手把源码推出去。
  实现上是 `build\backup-github.mjs` + `build\lib\git-backup.mjs`，
  和推 Pages 的 `push-github.mjs` + `lib\git-dist.mjs` **刻意不复用代码** ——
  两条通道的目标仓库、工作目录、排除规则都不一样，混在一起迟早误推。
- 自带 `.git` 的子目录（现在只剩 `dist\`）会被**跳过并提醒**：
  直接 `git add -A` 只会把它们记成一个 commit 号（空壳），源码等于没备份。
  要让它们真的进备份，得删掉里面的 `.git` 或声明成正经的 submodule。
  （原先的 `.agents\skills\theme-plus` 就是这种情况，已经从仓库移出去、改成 DSH 全局技能了。）

**回滚**：备份仓库里每个 tag / 提交都是完整快照，要退回去就在那儿 `git checkout <tag>`
（或 `git switch -c 旧版本 <tag>`），比在本地凭记忆改安全。

---

## 6. 构建系统

`build\build.mjs` 做六件事：同步插件副本 → 预渲染 `PRE_RENDER` 里列的文档
（目前只有 `TEST.md`）→ 打 `docs-md.js` → 合并 `docs-md.css` 并拷字体 →
输出 `p\docs.html` → **生成 `p\post\` 文章页与 `p\feed.xml`**。
末尾还会跑 `add-favicon.mjs` 给全站 HTML 注入图标，并重新生成 `sitemap.xml` /
`docs\info\site-index.js`（文章条目就在这里进 sitemap）。

**为什么自己写打包器**：这个沙箱环境不允许程序创建命名管道，esbuild / rollup /
webpack 的任何 API 都要 spawn 子进程，直接 EPERM。所以 `lib\bundler.mjs` 是个
两百行的 CJS 打包器，够用且可控。

详细内容（预渲染机制、样式怎么合并、favicon/logo 怎么注入、对比度脚本怎么用）
都在 **`build\README.md`**，改构建相关的代码前先读那个。

配套脚本：

```bash
node build\audit-contrast.mjs        # 全站 WCAG 对比度审计
node build\fix-contrast.mjs --apply  # 按 4.6:1 求解并就地改（只动亮度，不动色相）
node build\make-favicon.mjs          # logo.svg → favicon.svg + apple-touch-icon.svg
```

---

## 7. Markdown 支持

渲染器支持的能力分两类：插件直接给的，和自己写的适配器补的。

**已支持**：**frontmatter**（正文顶上的头信息，渲染成元数据卡片，见 §7.1）、
CommonMark、GFM 表格/任务列表/删除线/自动链接/脚注、Emoji、上下标、
`==高亮==`、缩写、定义列表、插入删除、Ruby 注音、数学公式（`$…$` / `$$…$$` /
`\(…\)` / `\[…\]`）、代码高亮、行号（`:line-numbers`）、高亮指定行（`{1,3-5}`）、
代码组 `::: code-group`、选项卡 `::: tabs`、GitHub 告示 `> [!NOTE]`、提示框 `::: tip`、
目录 `[[toc]]`、图片尺寸/主题图、块级剧透 `>!`、行内剧透 `!!…!!`、卡片 `<card>`。

**未支持**（写了会原样显示，不会报错）：Mermaid、PlantUML、ECharts、Flowchart、
`::: layout`、`@include`、`@snippet`、`@embed`、`->对齐<-`。

**完整的逐条对照表在 `jinsuper.rth1.xyz\p\TEST.md`**（打开阅读器就能看渲染效果），
最后一节 §9 是「支持 / 不支持」速查。加新语法时请同步更新那个文件和
`build\test-render.mjs` 的断言。

### 7.1 Frontmatter（文章头信息）

文章顶上写一段 `---` 包起来的 `键: 值`，渲染器把它变成正文开头的**元数据卡片**
（标题 / 摘要 / 日期 / 作者 / 分类 / 阅读时间 / 标签，其余键原样列在下半部分）。

- 解析规则只有一份：`build\lib\markdown.cjs` 的 `parseFrontmatter()`，
  **构建期（预渲染）与浏览器端（现场渲染）走同一份**，两边排版不会走样
- 支持的 YAML 子集：标量、行内数组 `[a, b]`、块数组（`- ` 项）、一层嵌套映射、
  `>` 与 `|` 块标量、行尾 `#` 注释；文件开头是水平线（`---` 但中间没有 `键: 值`）时不会被吃掉
- `title` 写了之后，正文开头**一模一样**的 `# 标题` 会自动去掉（不然一页两个 h1）；
  没写 title 时，正文自带 h1 就不另造标题，没有 h1 才回落到清单里的名字
- `date` / `updated` / `tags` / `summary` 会进 sitemap、RSS 与 JSON-LD，字段表见 `MANIFEST.md` §7.1
- 作者默认 `JinSuper`（`site.json` 的 `blog.author`）：`author: JinSuper` 与 `author: [JinSuper, ABC]` 都收，多作者画成多枚，并分别进 RSS 的 `<dc:creator>` 与 JSON-LD
- 目录：阅读器是左边栏那份（嵌在页面里跟着滚），**文章页左侧也有一列目录**（sticky 跟随、高亮当前小节，少于两节就整块不生成、正文单列铺满）；
  三处共用 `tocEntries()` + `normalizeTocLevels()`（把层级归一成相对级别，最浅的一级 = lv-1，缩进才有层次）；想在正文开头再摆一份就写 `toc: true`
- 断言在 `build\test-render.mjs` 的「Frontmatter」一节（解析 + 渲染 + 不重复标题 + 不误吃正文）

---

## 8. 设计系统与平台硬规则

### 硬规则（平台限制，违反会出问题）

- **禁止 base64**。图标一律用文件路径或内联 SVG
- **不引用任何 CDN**，不加载外部字体。字体放在 `p\fonts\`
- 站点内的相对路径引用要能过 `verify.mjs` 的「无外链残留」检查

### 主题

文档站自带 **12 套配色**，默认 `obsidian`（对比度最高的一套）。定义在
`build\template\docs.html` 里，改完要重新构建。

正文对比度要求 ≥ 4.5:1（WCAG AA）。当前 **146/146 个前景色组合全部达标**，
改样式后用 `audit-contrast.mjs` 复查。

### 交互约束

正文对比度 ≥ 4.5:1、悬停位移 ≤ 4px、入场动画 ≤ 700ms、反馈 ≤ 300ms、
尊重 `prefers-reduced-motion`、图标用内联 SVG 不用 emoji。

---

## 9. 测试

三套，都是 Node 脚本，不需要额外服务：

| 脚本 | 覆盖 | 耗时 |
|:--|:--|:--|
| `build\test-render.mjs` | 拿真实文档跑一遍渲染，逐条断言语法点 | ~10s |
| `build\verify.mjs` | 检查产物结构：脚本语法、资源存在、id 引用、无外链、favicon | ~1s |
| `build\test-dom.mjs` | jsdom 真跑页面：切换、复制按钮、搜索、主题、加文档流程 | ~1–2min |
| `build\test-pipeline.mjs` | 部署管线：步骤顺序与 id、开关映射、遇错停 / soft 步骤、上传文件规则（EXCLUDE、asset 覆盖）、`部署.cmd` 必须纯 ASCII、源码备份不混进管线 | ~4s |
| `build\test-tui.mjs` | ink TUI：用假终端渲染，验菜单 / 计划开关 / 状态页 / 执行→结果 / Ctrl+C 中止 | ~8s |
| `console\test\` | 控制台：原有 20 条（文章 / 归档 / 队列 / 片段预览 / 深链接）+ 预览面板 3 条（页面树 / 预览服务 / 预览设置）+ 部署作业 9 条 | ~3s |

```bash
部署.cmd check        # 上面全部
npm run check         # 同上（在项目根）
npm run test:dom      # 只跑慢的那套（改了阅读器 / 模板时跑）
```

`deploy-cli.mjs` 的 `full` 会自动跑快的那几套，不过就拦下发布。
改动渲染器后请手动跑一遍 `test-dom`；改了控制台或 TUI 请跑 `npm run check`。

---

## 10. 地雷清单

按踩到的概率排序。这一节是本文档最值得读的部分。

### 10.1 `p\docs.html` 是构建产物，改它会被覆盖

真正要改的是 `build\template\docs.html` 和 `build\template\docs-md.css`。
下次 `node build.mjs` 会把直接改在 `p\` 里的内容冲掉。

### 10.2 裸域 `jinsuper.cn` 的证书不含它自己

- 服务器为 `jinsuper.cn` 出示的证书 **Subject 是 `CN=www.jinsuper.cn`**
  （Let's Encrypt，有效期 2026-09-30 → 2026-12-29）
- 浏览器打开 https://jinsuper.cn 会报证书名称不匹配
- `https://www.jinsuper.cn` 和 `https://jinsuper.rth1.xyz` 都正常

**待办**：去热铁盒控制台给裸域单独申请证书。CLI 没有域名/证书相关的子命令
（只有 `site create` / `site list`），只能从控制台操作。

### 10.3 `asset\` 有两份

`jinsuper.rth1.xyz\asset\`（604 个）和项目根 `asset\`（603 个）。
603 个同名文件**内容完全一致**，站点那份只多一个 `asset\icon\logo.svg`。

`prep-deploy.mjs` 会把两边都镜像进 `dist\asset\`，项目根那份**后写入、覆盖**同名文件。
`logo.svg` 因为只存在于站点那份而保留下来。

- **`logo.svg` 的权威位置是 `jinsuper.rth1.xyz\asset\icon\logo.svg`** ——
  `make-favicon.mjs` 和 `lib\logo.mjs` 都从这个路径读
- 两份内容一旦分叉会很难查，改图标时**两边都要改**，或者干脆合并成一份

### 10.4 `部署.cmd` 必须保持纯 ASCII

cmd.exe 按「当前代码页」逐字节解码批处理文件，而且会按字节偏移回头重读。
文件里只要有非 ASCII 字符，`chcp 65001` 一执行偏移就错位，**cmd 会把某行的后半截
当命令执行**（实测中文注释真的被当成命令跑过）。

所以界面文案全在 `deploy-cli.mjs` 那边。改 `部署.cmd` 时务必保持纯 ASCII。

### 10.5 `build.mjs` 里的 `DOCS_JS` 是 `String.raw` 模板字符串

里面**不能出现反引号**，否则整个构建挂掉。写注释时注意别用 `` ` `` 包代码。
同理 `${…}` 会被当插值。

### 10.6 esbuild / rollup / webpack 在这个环境里用不了

任何 API 都要 spawn 子进程 → 命名管道被禁 → EPERM。打包器是自己写的。

### 10.7 `prep-deploy.mjs` 会删除 dist 里的旧文件

增量镜像只会新增/覆盖，所以额外加了一步 `prune()`，把源站已删除的文件从 `dist\`
清掉（否则旧的 favicon 之类会一直挂在线上）。

例外保留：`dist\.git` 整个跳过，根部的 `CNAME` / `.nojekyll` / `.gitignore` 保留。
如果以后要在 dist 根放别的手工文件，记得加进 `KEEP_ROOT`。

### 10.8 GitHub Pages 不执行 PHP

`p\raw.php` 和 `Skills\tools\hw-api.php` 在 GitHub Pages 上会被当**源文件**返回
（`text/plain`），页面得靠降级逻辑兜底。热铁盒那边才真的执行。

### 10.9 `robots.txt` / `sitemap.xml` 里有平台变量

两处写了 `jinsuper{$rthSuffix}`，这是**热铁盒的服务端变量**，会在响应时替换成
`.rth1.xyz`。所以自定义域名上访问时，sitemap 链接指向的仍是 `jinsuper.rth1.xyz`。
不影响使用，但知道一下。

### 10.10 中文文件名要 percent-encode

源码里引中文文件名（如 `p\idea\1.归途且慢.md`）时，URL 要逐段编码，
但 `..` 和 `.` 要保持原样。这个逻辑已经在编码函数里了，别自己拼。

### 10.11 热铁盒对非浏览器 UA 会拦

`fetch` / `Invoke-WebRequest` 默认 UA 可能拿到 403 拦截页。
要验证线上内容就带浏览器 UA（`deploy.mjs` 的域名检查已经这么做了）。

### 10.12 静态资源会 302 到 CDN

`/favicon.svg` 之类会跳去 `cdn.rthe.cn/cached-<hash>/jinsuper/…`。
写检查脚本时要 `redirect: 'follow'`，否则只能看到一个空的 302。

### 10.13 项目在 WSL 里，而控制台可能跑在 Windows（UNC 路径）

项目根在 WSL（`/home/<用户>/project/node`），Windows 侧的控制台是通过
`\\wsl.localhost\Ubuntu-26.04\home\...` 这个 UNC 路径访问它的。两件事会撞车：

1. **cmd.exe 不支持把 UNC 当当前目录**：它会打印
   `UNC paths are not supported. Defaulting to Windows directory.`，退到
   `C:\Windows`，于是 `--env-file=.env`、`dist/` 这些相对路径全都找不到
   （报 `node: .env: not found`）。所以 `deploy.mjs` 只在 Deno 是 `.cmd/.bat`
   包装时才经 `cmd /c` 起，真 `deno.exe` 直接起 —— 原生 exe 允许 UNC 当前目录。
2. **deno 这个 npm 包是按平台分发二进制的**（`@deno/win32-x64`、
   `@deno/linux-x64-glibc`…）。项目里同时留着两份，谁在跑就用谁：
   `build/lib/deno.mjs` 的 `findLocalDeno()` 按当前平台找，顺序是
   `@deno/<本平台>/deno(.exe)` → `node_modules/deno/deno(.exe)` → `.bin/deno(.cmd)`。
3. **git 也会拒绝干活**：UNC 路径里的仓库在 Windows 看来「不属于当前用户」，
   于是 `git add` 报 `fatal: detected dubious ownership in repository`。
   `build/lib/git-safe.mjs` 的 `safeArgs()` 给每次 git 调用加上
   `-c safe.directory=<本仓库>` 放行 —— **不用去改全局配置**
   （改全局那步每台机器都要再做一遍，还会一直留在用户配置里）。
   `git-dist.mjs` / `git-backup.mjs` / `deploy-cli.mjs` 三个入口都走这个包装。

⚠️ `deno` **没有写进 `package.json`**，所以它和 `@deno/*` 都算"外挂包"：
在根目录跑一次 `npm install` 会把它们清掉。清掉也不要紧 —— `deploy.mjs`
找不到会自动 `npm install deno` 补上，再按平台重新找。想彻底省心，就在
Windows 上装个系统 Deno（`winget install DenoLand.Deno`），脚本优先用系统的。

---

## 11. 密钥

- `RTH_API_KEY` 在项目根的 **`.env`**（已在 `.gitignore` 里）
- **这个 key 等同于账号密码**，不要提交、不要外发、不要贴进任何会被发布的文件
- 交接时请通过安全渠道单独传递，不要写在这份文档里
- GitHub 推送凭据存在 `dist\.git` 的 remote URL 里（Personal Access Token）。
  换机器时记得重新配
- 源码备份（§5.2）用**同一套** GitHub 凭据（本机 `gh auth login` 或 token）；
  它自己的 remote 在项目根 `.git\config`，那个文件也不会被提交

---

## 12. 排障

| 现象 | 原因 / 处理 |
|:--|:--|
| `npm install` 报 EPERM | npm 缓存目录在工作区外。`.npmrc` 已把 cache 指到项目内 |
| 热铁盒上传 `error reading a body from connection` | 网络抖动，`部署.cmd` 会自动重试 3 次；也可手动重跑 `部署.cmd rth` |
| 热铁盒上传卡在 `Getting current site content` 然后 `AbortError: The signal has been aborted` | CLI 内部对「列远端文件清单」有约 28 秒超时，站点有 700+ 个文件时偶尔会踩到，然后自己重试。**这不是代码问题**：网络通的时候重跑就好 `部署.cmd rth`（只上传，跳过构建）。真反复卡就先确认网络，再重试；上传是幂等的 |
| 本地预览 `EADDRINUSE` | 上次的预览还开着。`部署.cmd serve` 会直接告诉你地址；换端口用 `--port N` |
| GitHub 推送报连不上 | 需要代理。`push-github.mjs` 已内建：优先用环境变量，否则退到 `127.0.0.1:7890` |
| `部署.cmd bakup` 报「远程不是备份仓库」 | 项目根的 `origin` 被改成别的地址了。脚本**不会擅自改**你的 remote：确认要备份就 `git remote set-url origin https://github.com/JinSuperOfficial/JinSuperKitBakup.git`，要推到别处就用 git 自己来 |
| `部署.cmd bakup` 报有些文件超过 95MB | GitHub 单文件上限 100MB。把大文件加进 `.gitignore` 或改用 Git LFS（`dist\` 那种产物本来就不该进源码备份） |
| `部署.cmd bakup` 说某个子目录「不进本次备份」 | 那个目录自带 `.git`（现在只剩 `dist\`）。直接加进去只会存一个 commit 号，所以脚本跳过并提醒；要真备份就先删掉里面的 `.git`，或声明成 submodule |
| 改了文档却没生效 | 确认是发到**两个**热铁盒站点（§5）；或浏览器缓存，强刷 |
| 公式不显示 / 退化成平台渲染的样子 | `p\raw.php` 没生效，检查云函数是否还在 |
| 构建后 `p\docs.html` 里改动没了 | 你改的是产物不是模板，见 §10.1 |
| 文章页（`/p/post/…`）没生成 | 看 `sk.json` 里那一条：路径要存在；frontmatter 里 `draft / nopage / hidden` 为真会**故意**不生成。`p\post\` 下不是这一轮生成的文件会被构建清掉（改了 slug 留下的旧页面也在这里清） |
| frontmatter 的元数据卡片没出现 | 必须以文件**第一行**的 `---` 开头、单独一行的 `---` 收尾，中间至少有一个 `键: 值`；开头是水平线的正文不会被吃 |
| 文章标题/日期在阅读器和文章页不一致 | 两边都读同一个 `parseFrontmatter`；若不一致多半是浏览器缓存了旧的 `docs-md.js`（改了渲染器要重新构建，`?v` 会跟着 `ASSET_VERSION` 抬） |
| 阅读器里侧栏/目录跟着滚动 | 那是**故意的**：侧栏与目录现在是嵌入式的，随页面一起滚；常驻导航在顶栏 |
| 博客首页还是旧的写作台 | `p/index.html` 也是构建产物（模板 `build/template/blog.html`），跑一次 `node build/build.mjs` |
| 文章页正文被挤成窄窄一条 | 那一篇没有目录（少于两节），`.wrap` 要是还摆着两列网格就会把文章挤进 212px 的第一列。生成时用 `has-toc` 类决定单列 / 两列，别手改产物 |
| 时间线 / 标签里看不到归档稿 | 归档稿（`/p/archive/**.html`）由 `listArchivedPosts()` 从 `sk.json` + 成品页 head 里读出来，不进「最新」卡片；只改了归档产物而没重新构建，时间线也不会变（跑 `node build/build.mjs`） |
| 站点地图里没有文章 | `sitemap.xml` 是生成物：跑 `node build/gen-site-index.mjs`（或 `部署.cmd build`）。文章条目由 `build\lib\site-index.mjs` 调 `listPosts()` 算出来 |
| 搜索引擎收录的还是 `/p/docs.html` | 正常：先让 sitemap 上线、在 Google Search Console / Bing 站长工具里提交 `sitemap.xml`。canonical 指 `site.json` 的 `blog.origin`，换主域名要同步改这一处 |
| 作业页显示「示例清单」 | 没读到数据。作业数据在 `811\data\homework.json`（老路径 `Skills\tools\data\` 已废弃） |
| GitHub Pages 404 | 去仓库 Settings → Pages 确认已启用（Source: main / root） |
| 控制台打不开 / 端口占用 | `控制台.cmd --port 8792` 换端口；同一时间只跑一个实例 |
| 控制台说「读不到预渲染核心」 | `build\node_modules` 没装：在 `build\` 里跑一次 `npm install` |
| 归档失败 | 流程里有自检：产物没写成功就把原文搬回 `/p`，不会留下「登记了但文件不在」的状态。看界面提示的原文/产物路径 |
| 阅读器里归档篇显示成源码 | 只有 **sk.json 里指向 `archive/*.html`** 的才当预渲染稿注入；手写放在别处的 `.html` 仍按源码显示 |
| 英语页（`/811/english.html`）没声音 | 音频是直接读 `/811/data/english/<单元>/<文件>.mp3`；用 `file://` 打开读不到清单，`部署.cmd serve` 或线上访问 |
| 传热铁盒报 `UNC paths are not supported` / `node: .env: not found` | 控制台在 Windows、项目在 WSL（UNC 路径），而 Deno 落在 `.cmd` 包装上。见 §10.13。最快的办法：Windows 上 `winget install DenoLand.Deno`，或改用 WSL/Linux 侧的 `./部署.sh` |
| `./部署.sh` 到最后一步「推 GitHub Pages」失败：`Invalid username or token` | `dist/.git` 的 remote 里没 token（§11 说过换机器要重配）：`git -C dist remote set-url origin https://<TOKEN>@github.com/JinSuperOfficial/JinSuper.github.io.git` |
| 推 GitHub Pages 报 `fatal: detected dubious ownership in repository at '//wsl.localhost/...'` | Windows 工具链 + WSL 里的项目（UNC）：git 认为仓库不属于当前用户。已经由 `build/lib/git-safe.mjs` 给每次调用加 `-c safe.directory=<本仓库>` 放行（见 §10.13），重跑即可 |
| 推 GitHub Pages 报 `error: open("xxx"): No such file or directory` / `unable to index file` | Windows 通过 UNC 访问 WSL 里的 dist 时，`git add` 要哈希七百多个文件，偶发一次 open 失败（**文件其实好好在着**，重跑就过）。`push-github.mjs` 现在自己重试 3 次；真失败再 `npm run deploy:prep` 重新组装 |
| 推 GitHub Pages 时满屏 `warning: in the working copy of '...', LF will be replaced by CRLF` | Windows 侧 git 默认 `core.autocrlf=true`，那只是**警告**，暂存内容不变。**不要去改 autocrlf**：dist 里 HTML 本来就是 CRLF、其它是 LF，关掉它会让所有 CRLF 文件都变成「有改动」并改写发布出去的字节，白白搞出一个巨大的 diff |
| 控制台部署面板：日志盖在作业列表上 / 整页滚不动 | 面板是满屏高度的 flex 列，子块被压扁后内容会溢出画到邻居身上。规则在 `console/web/console.css` 的「部署面板」一节：面板自己滚、子块不收缩、日志卡片固定高度 |

---

## 13. 文档索引

| 文件 | 内容 |
|:--|:--|
| `AGENTS.md` | **项目级约定**：硬规则 + UI 圆角规范（按 `theme-plus` 全局技能的 `references/circle_angle.md`） |
| `MANIFEST.md` | **清单规范**：加工具只改 json、字段表、三条硬规则、校验命令 |
| `build\README.md` | **构建系统详解**：打包器、预渲染、样式合并、对比度脚本、图标生成、部署细节 |
| `console\lib\store.mjs` / `api.mjs` / `render.mjs` | **发布控制台**的实现（sk.json 保形读写、归档流程、预渲染器与「重刷外壳」、接口）；用法见 §4.5 |
| `jinsuper.rth1.xyz\p\TEST.md` | **Markdown 语法逐条对照稿** + 支持/不支持速查表 |
| `jinsuper.rth1.xyz\p\blog.md` | **写作指南**：怎么加一篇文章、frontmatter 字段、构建产出什么（站点上也能读） |
| `build\template\blog.html` | **博客首页模板**（`p/index.html` 是产物）：最新卡片 / 标签筛选 / 时间线 |
| `jinsuper.rth1.xyz\site.json` | 站点目录 + **博客身份**（`blog` 段：标题 / 简介 / 主域名） |
| `rth-sites.json` | 要发布的站点清单 |
| `部署.cmd --help` / `控制台.cmd` | 部署命令与选项 / 启动本地控制台 |
| `.Skills\retiehe-web\SKILL.md` | 热铁盒平台参考资料 |
| `F:\@AI\skills\theme-plus\` | 主题相关参考资料（**DSH 全局技能，不在本仓库**；原先在 `.agents\skills\theme-plus`） |

---

## 14. 交接检查清单

- [ ] 拿到 `.env`（RTH_API_KEY），放到项目根
- [ ] 确认 `部署.cmd status` 各项都是 ✓
- [ ] 确认能打开三个域名
- [ ] 跑一次 `部署.cmd check`，确认**五套**测试通过（外加 `npm run console:test` 的 23 条）
- [ ] 双击 `控制台.cmd`，确认能起在 127.0.0.1:8791，且 `dist\` 里没有 `console\`
- [ ] 在 `sk.json` 加一篇测试文档，跑一次 `部署.cmd full -y`，确认两个热铁盒站点都更新
- [ ] 处理 §10.2 的裸域证书问题
- [ ] 决定 §10.3 的两份 `asset\` 要不要合并
- [ ] 确认 GitHub 推送凭据（`dist\.git` 的 remote）可用，或重新配置
- [ ] 确认备份通道可用：`部署.cmd bakup --check` 能列出文件，`部署.cmd bakup` 能推到 `JinSuperKitBakup`
- [x] `theme-plus` 已移出仓库、改成 DSH 全局技能（`F:\@AI\skills\theme-plus\`），源码备份不再受它拖累
