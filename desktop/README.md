# JinSuper 百宝箱 · 桌面版（Electron）

把 `jinsuper.rth1.xyz/` 那套纯静态网页装进一个真正的桌面窗口：

- **默认打开云端主站** `https://www.jinsuper.cn`；打不开就依次退到热铁盒、GitHub Pages，
  最后落到**随应用打包的离线副本**（运行时在 `127.0.0.1` 起一个本地静态服务）。
- **每个页面顶上都有同一条 topbar**：上一页 / 主页 / 工具站 / 班级工具箱 / 博客 / 设置 / 退出
  + 来源徽章 + 窗口按钮。翻页、跨域跳转、连不上时的错误页，它都在。
- 出口有四个，随手就能关：topbar 的**退出**按钮、窗口的 **✕**、`Ctrl+Q`、设置面板里的**退出应用**。

网站源码**一行都没改** —— 桌面版的能力全在 `desktop/` 里。

---

## 跑起来

```bash
cd desktop
npm install          # 装 electron 与 electron-builder
npm start            # 开发模式启动
npm run smoke        # 冒烟：自动开窗、翻两页、截图到 desktop/.smoke/，然后自己退出
node --test          # 纯逻辑单测（来源表 / 回落链 / 本地服务路径归一）
```

> `npm install` 之后如果 `node_modules/electron/dist/` 是空的（下载被墙或被代理拦了），
> 手动补一次：`node node_modules/electron/install.js`。

## 打 Windows 免安装 exe

```bash
npm run dist:win     # → release/JinSuper-<版本>-portable.exe
npm run pack:win     # 只出免安装目录 release/win-unpacked/，调试更快
```

产物体积主要来自两件事：Electron 运行时（约 100 MB）与整站离线副本（约 46 MB，
其中 `class/data/english` 的听力音频占了 36 MB）。想让 exe 瘦下来，改
`package.json` 里 `build.extraResources` 的 `filter`，把离线副本裁小即可。

图标由 `build/make-icon.mjs` 生成（站点 favicon + 底色块 → `build/icon.ico`），
需要 ImageMagick；换了 favicon 就重跑一次：

```bash
node build/make-icon.mjs
```

### 发布到 GitHub Releases

打好的 exe 挂在两个仓库的 Releases 上（同一个文件，两处都能下）：

| 仓库 | tag | 说明 |
|:--|:--|:--|
| `JinSuperOfficial/JinSuper.github.io` | `desktop-v1.0.0` | 站点仓库，用户最可能从这儿下 |
| `JinSuperOfficial/JinSuperKitBakup` | 跟源码 tag（`v1.6.0`） | 备份仓库，release 和源码快照同一个 tag |

```bash
cd ..                                    # 回到项目根
./部署.sh bakup -y --tag v1.6.0 --tag-message "…"   # 源码快照 + tag（Windows 上是 部署.cmd）
gh release create desktop-v1.0.0 --repo JinSuperOfficial/JinSuper.github.io --target main \
  --title "JinSuper 百宝箱 · 桌面版 v1.0.0（Windows 免安装）" \
  --notes-file /tmp/rel-app.md desktop/release/JinSuper-1.0.0-portable.exe
gh release create v1.6.0 --repo JinSuperOfficial/JinSuperKitBakup \
  --title "v1.6.0 · 桌面版首发 + 运动会赛程" \
  --notes-file /tmp/rel-bakup.md desktop/release/JinSuper-1.0.0-portable.exe
```

**`release/` 里的产物不要手删**：`win-unpacked/`、`linux-unpacked/` 是下一版增量打包要复用的东西，
`linux-unpacked/` 还能在本机直接 `--smoke` 验一遍打包后的路径（`resources/site` 那份离线副本）。

---

## 目录

```
desktop/
├── src/
│   ├── main.js            主进程：窗口、两个 WebContentsView、回落链、快捷键
│   ├── origins.js         来源表 + 回落链（纯逻辑，单测直接跑它）
│   ├── settings-store.js  设置落盘（userData/settings.json）
│   ├── local-server.js    离线副本的本地静态服务（支持 Range）
│   └── ui/
│       ├── base.css       自带界面共用的 token / 圆角
│       ├── preload.js     给 topbar 与设置面板的桥（只暴露三个方法）
│       ├── page-preload.js 页面视图的 preload：只对 file:// 页面开桥，线上页面拿不到
│       ├── topbar/        统一 topbar
│       ├── settings/      设置面板（叠在网页之上）
│       └── error/         云端 + 离线副本全打不开时的错误页
├── build/                 图标与生成脚本
├── test/                  单测
└── release/               打包产物（不进版本库）
```

### 为什么用两个 WebContentsView，而不是往网页里注入 topbar

```
┌──────────────────────────────────────────┐
│ topbarView  46px   ← 我们自己的页面        │
├──────────────────────────────────────────┤
│ pageView          ← 站点本体（云端/离线）  │
│ panelView（可选）  ← 设置面板              │
└──────────────────────────────────────────┘
```

- 站点有几十个页面、各有各的 CSS，注入就等于跟它们抢布局；分层是两个完全独立的文档，
  一像素都不会互相影响。
- 换页时 topbar 不重建，所以「每个页面都有退出按钮」是**结构性成立**的，不用每个页面写一遍。
- 网页源码零改动，符合仓库「加东西不要改 HTML」的约定。

## 来源与回落

| id | 名字 | 地址 |
|:--|:--|:--|
| `cn` | 主站（默认） | `https://www.jinsuper.cn` |
| `rth` | 热铁盒 | `https://jinsuper.rth1.xyz` |
| `gh` | GitHub Pages | `https://jinsuperofficial.github.io` |
| `local` | 内置离线副本 | `http://127.0.0.1:<随机端口>` |

回落规则（设置面板可关，见 `src/origins.js` 的 `buildChain`）：

1. 默认从**主站**开始；用户选了哪个来源，哪个就排第一。
2. 「云端之间互相顶替」开着 → 依次试另外两个云端来源。
3. 「云端全都打不开就用离线副本」开着 → 最后落到 `local`，并且**尽量落到同一个页面**
   （比如主站的 `/class/homework.html` 打不开，就打开离线副本里的同一页）。
4. 明确选了「内置离线副本」时只走本地，不会再跳回云端。

判失败的口径：`did-fail-load`（主框架，忽略 `ERR_ABORTED`）+ 15 秒看门狗超时。

离线副本走的是本地 HTTP 而不是 `file://`：站点清单（`/class/tools.json`、`/Skills/skills.json`）
是 `fetch` 出来的，`file://` 下会被 CORS 拦掉、页面只会显示「清单没加载出来」。

## 设置面板

来源切换、两档回落开关、页面缩放、当前地址与版本、一键恢复默认。改动即时生效并写进
`%APPDATA%/JinSuper/settings.json`（Linux 是 `~/.config/JinSuper/`）。

## 快捷键

| 键 | 干什么 |
|:--|:--|
| `Alt` + `←` / `→` | 上一页 / 下一页（鼠标侧键同样有效） |
| `Ctrl` + `R` / `F5` | 重载（`Ctrl+Shift+R` 强制不走缓存） |
| `Ctrl` + `,` | 打开 / 关闭设置 |
| `Ctrl` + `+` / `-` / `0` | 放大 / 缩小 / 回到 100% |
| `F11` | 全屏 |
| `F12` | 开发者工具 |
| `Ctrl` + `Q` | 退出应用 |
| `Esc` | 关掉设置面板 |

## 排障

- **打不开、一直退到离线副本**：多半是网络或代理。开发机上如果系统挂了本地代理，
  用 `JSD_PROXY=http://127.0.0.1:7890 npm start` 指给 Chromium（打包后的正式版不读它，
  交给系统代理设置）。
- **想直接看某个来源**：`npx electron . --origin=local`（只是这一次运行，不落盘）。
- **冒烟失败**：看 `desktop/.smoke/` 里的截图（topbar / 首页 / 设置 / 班级工具箱四张）。
