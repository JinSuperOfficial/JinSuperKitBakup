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
npm run smoke        # 冒烟：**不开窗**（不闪屏）、翻两页、顺便写一天作业，然后自己退出
npm run smoke:show   # 同上但把窗口显示出来，截图到 desktop/.smoke/（要图的时候才用）
node --test test/origins.test.cjs test/modes.test.cjs test/hwk-store.test.cjs   # 纯逻辑单测
npm start -- --app=homework    # 直接开「作业编辑器」那一半（第二个快捷方式就是它）
```

> `npm install` 之后如果 `node_modules/electron/dist/` 是空的（下载被墙或被代理拦了），
> 手动补一次：`node node_modules/electron/install.js`。

## 打 Windows 安装包（两个格式）

```bash
npm run dist:win        # 两个都出：JinSuper-<版本>-portable.exe + JinSuper-811-Setup-<版本>.exe
npm run dist:portable   # 只要免安装版
npm run dist:setup      # 只要安装版（「811 套装」）
npm run pack:win        # 只出目录 release/win-unpacked/，调试最快，不打包
```

打包前 npm 会自动跑 `build/make-sync-config.mjs`（`pre*` 钩子），把 `.env` 里的
`JINS_GITEE_TOKEN` 与 `sync.json` 合成 `resources/sync-config.json` 放进包里 ——
**学校那台机器因此不用登录、不用配任何东西**。想先看一眼会写什么：

```bash
node build/make-sync-config.mjs --check    # 令牌打码显示，不写文件
```

> `build/sync-config.json` 里有明文令牌，**从不入库**（`.gitignore` 已排除）。
> 建议用只对该仓库有写权限的令牌；丢了就在 Gitee 撤销重发，然后重新打一次包。

两个格式各有各的用处，**装的是同一个应用、同一个 appId，用户装哪个都行**：

| 产物 | 形态 | 启动 | 卸载 |
|:--|:--|:--|:--|
| `JinSuper-1.0.0-portable.exe`（约 120 MB） | 免安装，就一个 exe | 每次启动先解压到 `%TEMP%\JinSuperDesktop`（几秒） | 删掉 exe 即可，不留注册表 |
| `JinSuper-811-Setup-1.0.0.exe`（约 120 MB） | 安装版「811 套装」（NSIS，中文界面） | 秒开 | 控制面板「811 套装」或开始菜单里的卸载 |

### 安装版就是「更新」：装新版会先把旧版卸掉

安装版的身份是 `build.appId`（`xyz.jinsuper.desktop`），NSIS 模板据此在注册表里找旧版本
（`HKCU/HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{appId 的 GUID}`），
安装新版本时**先静默调用旧版的卸载程序，再装新的** —— 不会出现两份并存的副本。
更新时 NSIS 还会跳过许可页与安装目录页（`skipPageIfUpdated`），沿用上次的安装位置，
装完自动启动（带 `--updated`）。

- **`appId` 是升级身份，一旦发布就不许改** —— 改了等于换了一个应用：新版认不出旧版，
  会并排装第二份，控制面板里也会出现两个条目。
- `nsis.deleteAppDataOnUninstall: false`：卸载/升级都**不动** `%APPDATA%\JinSuper`
  （设置、缓存、站点 localStorage 都留着），只有用户主动卸载且想清干净时才手动删。
- 安装模式：默认「仅为我安装」（装到 `%LOCALAPPDATA%\Programs\JinSuper`，不弹 UAC）；
  安装器里可以选「为所有用户安装」。
- **免安装版没有注册表痕迹，安装版管不着它**：用户之前用的是 portable，得自己把那个 exe 删掉。

### 811 套装：装完桌面和开始菜单各有两份快捷方式

安装包叫 **「811 套装」**（`JinSuper-811-Setup-<版本>.exe`），装完自动建好四份快捷方式
（桌面 2 + 开始菜单「811 套装」目录 2），图标一份暖橘一份青绿：

| 快捷方式 | 实际启动 | 干什么 |
|:--|:--|:--|
| **班级百宝箱.lnk** | `JinSuper.exe` | 浏览站点（现在的窗口） |
| **作业编辑器.lnk** | `JinSuper.exe --app=homework` | 离线录作业，**先写本机** |

- 两份快捷方式指向**同一个 exe**，差别只有 `--app=` 这一个参数（`src/modes.js`）；
  单实例锁保留 —— 点第二个快捷方式时，是**同一个进程里再开一个窗口**，
  所以设置文件只有一个写者，不会互相覆盖。
- 快捷方式由 `build/installer.nsh` 自己建（`package.json` 里
  `createDesktopShortcut` / `createStartMenuShortcut` 都关掉了，否则会多出一份英文名快捷方式）。
  `.nsh` 必须存成 **UTF-8 with BOM**，不然中文快捷方式名会乱码。
- 卸载会删掉这四份快捷方式，但 `deleteAppDataOnUninstall: false` 保留
  `%APPDATA%\JinSuper`（本机作业、设置、离线副本都还在），重装接着用。
- 「装完即用」：双快捷方式 + 自带令牌 + 自带站点副本，不需要任何配置步骤。

## 云端同步（学校那台机器靠它取件）

学校只能上 Gitee，所以桌面版自己带一条同步通道（实现复用仓库根的 `sync/lib/`，
打包时由 `extraResources` 放进 `resources/sync/lib`）：

- **班级百宝箱 → 设置 →「云端同步」**：检查更新 / 更新离线副本 / 上传文件到云端收件箱 /
  重试队列；下面还有「访问方式」两个选项（Gitee 免备案 / 自定义域名需 ICP 备案，
  选后者才会出现备案办理说明与官方入口按钮）。
- **更新离线副本**写的是 `%APPDATA%\JinSuper\offline-site`，`src/local-server.js`
  优先用它 —— 所以**站点内容更新不必重打 exe**（随包的 `resources/site` 只是底子）。
  第一次更新会先把随包副本整树复制出来，之后只下变化的文件。
- **作业编辑器 →「同步到云端」**：先在本机出快照（`userData/sync/outbox/`），再上传
  `inbox/<时间戳>/hwk.tar.gz`；断网就把改动收进队列（`userData/sync/queue/`），
  联网后点一下「同步到云端」或设置里的「重试队列」即可。
- 家里那条腿：`部署.cmd sync pull` → `部署.cmd sync apply --dry-run` 看 diff →
  `--write` 落进仓库 → `部署.cmd full` 发布。完整说明见 `sync/README.md`。

产物体积主要来自两件事：Electron 运行时（约 100 MB）与整站离线副本（约 46 MB，
其中 `class/data/english` 的听力音频占了 36 MB）。想让安装包瘦下来，改
`package.json` 里 `build.extraResources` 的 `filter`，把离线副本裁小即可。

图标由 `build/make-icon.mjs` 生成（站点 favicon + 底色块 → `build/icon.ico`），
需要 ImageMagick；换了 favicon 就重跑一次：

```bash
node build/make-icon.mjs
```

### 发布到 GitHub Releases

打好的两个包挂在两个仓库的 Releases 上（同一批文件，两处都能下）：

| 仓库 | tag | 说明 |
|:--|:--|:--|
| `JinSuperOfficial/JinSuper.github.io` | `desktop-v1.0.0` | 站点仓库，用户最可能从这儿下 |
| `JinSuperOfficial/JinSuperKitBakup` | 跟源码 tag（`v1.6.0`） | 备份仓库，release 和源码快照同一个 tag |

第一次建 Release 用 `gh release create`，之后每次出新版本（版本号在 `package.json` 里）：

```bash
npm run dist:win
cd .. && ./部署.sh bakup -y --tag v1.7.0 --tag-message "…"   # 源码快照 + tag（Windows 上是 部署.cmd）
cd desktop && npm run release:upload                          # 两个包 → 两个 Release
```

`build/upload-release.mjs` 会自动认版本号、找 `release/` 里的两个包、传上去（`--dry-run` 先看要传什么，
备份仓库那边的 tag 默认取本仓库最近一个 tag，也能 `--bakup-tag v1.7.0` 指定）。
新版本上线后，老用户下载新的安装版双击覆盖即完成更新。

**`release/` 里的产物不要手删**：`win-unpacked/`、`linux-unpacked/` 是下一版增量打包要复用的东西，
`linux-unpacked/` 还能在本机直接 `--smoke` 验一遍打包后的路径（`resources/site` 那份离线副本）。

---

## 目录

```
desktop/
├── src/
│   ├── main.js            主进程：两种模式的窗口、回落链、快捷键、IPC
│   ├── modes.js           两种模式（browse / homework）与 --app= 解析（纯逻辑）
│   ├── origins.js         来源表 + 回落链（纯逻辑，单测直接跑它）
│   ├── settings-store.js  设置落盘（userData/settings.json）
│   ├── sync-store.js      —（同步设置就在 sync.js 里，落 userData/sync-settings.json）
│   ├── hwk-store.js       作业本机存储（userData/hwk/，形状与站点一致；先落本地）
│   ├── sync.js            云端同步：更新离线副本 / 上传收件箱 / 断网队列
│   ├── lib-path.js        找 sync/lib 与包内 sync-config.json（开发态 vs 打包后）
│   ├── local-server.js    离线副本的本地静态服务（支持 Range；.php 一律 404）
│   └── ui/
│       ├── base.css       自带界面共用的 token / 圆角
│       ├── preload.js     给 topbar 与设置面板的桥（只暴露三个方法 + 同步进度）
│       ├── page-preload.js 页面视图的 preload：只对 file:// 页面开桥，线上页面拿不到
│       ├── hwk-preload.js 作业编辑器的桥（hwk.action / hwk.getState）
│       ├── topbar/        统一 topbar
│       ├── settings/      设置面板（叠在网页之上，含「云端同步」）
│       ├── hwk/           作业编辑器界面（独立窗口，不加载站点）
│       └── error/         云端 + 离线副本全打不开时的错误页
├── build/                 图标（两个）、安装脚本 installer.nsh、注配置与上传脚本
│   ├── make-icon.mjs        生成 icon.ico + icon-hwk.ico
│   ├── installer.nsh        两份快捷方式（UTF-8 with BOM）
│   ├── make-sync-config.mjs 打包前把 .env 里的令牌注进包内
│   └── upload-release.mjs   传到两个仓库的 Releases
├── test/                  单测（origins / modes / hwk-store）
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

## 界面永远是暗色

桌面版自带的界面（topbar / 设置 / 作业编辑器 / 错误页）只有暗色一套，而站点主题是
「跟随系统」的。如果系统是亮色，窗口里就会出现一片亮底、和外壳不是一套 ——
所以主进程在启动时把原生主题钉成暗色：

```js
nativeTheme.themeSource = 'dark';   // src/main.js（whenReady 里）
```

这不是往站点页面注入样式（仓库禁止那种做法），只是告诉 Chromium「系统是暗的」，
站点的 `theme.js` 会自己走暗色分支。想让桌面版跟随系统，把这一行换成 `'system'` 即可。

## 设置面板

来源切换、两档回落开关、页面缩放、**云端同步**（云端/本机版本、检查更新、更新离线副本、
上传文件、重试队列、访问方式含备案那一项、令牌与仓库）、当前地址与版本、一键恢复默认。
改动即时生效：浏览相关的写进 `%APPDATA%/JinSuper/settings.json`，
同步相关的写进同目录的 `sync-settings.json`（**两个文件分开**，互不覆盖）。

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
| `Esc` | 关掉设置面板（作业编辑器里是关掉窗口） |

作业编辑器（`--app=homework`）自己那一套：

| 键 | 干什么 |
|:--|:--|
| `Ctrl` + `S` | 保存到本地 |
| `Ctrl` + `Enter` | 同步到云端 |
| `Esc` | 关窗口 |
| `F12` / `Ctrl` + `Q` | 开发者工具 / 退出应用 |

## 排障

- **打不开、一直退到离线副本**：多半是网络或代理。开发机上如果系统挂了本地代理，
  用 `JSD_PROXY=http://127.0.0.1:7890 npm start` 指给 Chromium（打包后的正式版不读它，
  交给系统代理设置）。
- **设置面板里「云端同步」说还没配好**：打包时没注令牌。跑
  `node build/make-sync-config.mjs --check` 看一眼；正式打包时 `pre*` 钩子会自动注。
- **学校那边点「更新离线副本」没反应**：先看通道是否可达（家里 `部署.cmd sync check`）；
  错误会直接显示在设置面板里（连不上 / 云端还没镜像清单 / 令牌没权限）。
- **作业编辑器里同步失败**：改动不会丢 —— 已经写进 `%APPDATA%\JinSuper\sync\queue\`，
  联网后点「同步到云端」或设置里的「重试队列」再传一次。
- **点了「作业编辑器」快捷方式却只打开百宝箱**：那是同一个进程在跑 ——
  它会在已有窗口之外再开一个作业编辑器窗口；如果没开出来，看主进程日志里
  `[hwk] 界面加载失败`。
- **想直接看某个来源**：`npx electron . --origin=local`（只是这一次运行，不落盘）。
- **冒烟失败**：看 `desktop/.smoke/` 里的截图（topbar / 首页 / 设置 / 班级工具箱四张）。
