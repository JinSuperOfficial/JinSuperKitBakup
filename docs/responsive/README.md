# docs/responsive —— 响应式改造的对照截图

这个目录是**人眼对照**用的。`build/test-responsive.mjs` 只能做静态断言
（viewport / 断点 / 安全区 / 触摸目标 / `100vw` / 写死颜色 / 站外地址）——
**真实布局（折行、溢出、遮挡、桌面端有没有被改到）它测不了**，jsdom 不算布局。
那部分必须看图。

## 要拍的视口（与 `project.md` 的验收清单一致）

| 视口 | 设备 | 档位 |
|:--|:--|:--|
| 375×667 | iPhone SE | 手机 |
| 390×844 | iPhone 12/13/14 | 手机 |
| 360×640 | Android 小屏 | 手机 |
| 412×915 | Android 中屏 | 手机 |
| 768×1024 | iPad 竖屏 | 平板（下沿） |
| 1024×768 | iPad 横屏 | 桌面（下沿） |
| 1440×900 | 桌面 | 桌面 |

要拍的页面：`/index.html`、`/Skills/`、`/class/index.html`、`/class/homework.html`（★）、
`/class/english.html`、`/class/classtable.html`、`/class/run.html`、`/404.html`、
`/p/docs.html`、`/p/index.html`。

## 怎么拍

**① 首选：`browser_*` 工具（浏览器在 Windows 侧，走 bsk 扩展）**

这套已经**实际用过并抓出了两个真 bug**（见下），是最可信的一条路：

```text
node build/.serve.mjs 8788          # 先把站点跑起来（页面要 fetch 清单，file:// 会被 CORS 拦）
browser_session({ action: "start", url: "http://127.0.0.1:8788/class/homework.html" })
browser_assist({ action: "emulate", device: "iphone-14" })     # 或 resize 到目标宽高
browser_inspect({ action: "screenshot" })
```

> ⚠️ **一定要用 `emulate`（或确认页面真的按目标宽度布局）**，别只 `resize` 窗口：
> Windows 的窗口有最小宽度，`resize` 到 375 会被夹到 ~500px，
> 于是 **767 那条断点根本没命中**，拍出来的不是手机档。
> 页面自己会把视口打进控制台（`[homework] 页面底纹：… （视口 390px）`），
> 拿它核对最省事。

**② 备用：`build/shoot-responsive.mjs`（需要本机有能正常跑的 Chromium）**

```bash
node build/shoot-responsive.mjs --check      # 只量：报每个视口的横向溢出
node build/shoot-responsive.mjs              # 量 + 拍（全页长图 + 首屏）
node build/shoot-responsive.mjs --only=homework
```

它用 Electron 自带的 Chromium，靠 CDP 的
`Page.captureScreenshot({ captureBeyondViewport: true, clip })` 出**全页长图**，
同时把「量」的结果写进 `_index.json`（横向溢出、溢出元素样本）。
`JINS_ELECTRON=/path/to/electron` 可以指定别的 Chromium。

> ⚠️ **在 WSL 里这条跑不通**：Electron 连不上 WSL 自己的 `127.0.0.1` 服务
> （`ERR_FAILED (-2)`，而 curl / 浏览器都正常）。所以这台机器上只有 ① 可用。

## 已经验过什么（2026-10-16，`browser_*` 直接量的）

| 视口 | 页面 | 结论 |
|:--|:--|:--|
| 390×844 | `class/homework.html` | 表格塌成一列（`thead` 不在可达性树里）、科目名成横幅、条目行整行可点；底部动作面板点开正常，四个按钮竖排、行高 50px；右下角是「收起」 |
| 1440×900 | `class/homework.html` | 四个按钮横排、**没有**手机开关、表格两列带表头 —— 桌面档没被改到 |
| 390×844 | 全页 | 页面控制台**零报错**，三份 JSON 清单都读到（`index.json` / `hwk-n261017.json` / 生产清单） |

### ★ 这两个 bug 是**只有真浏览器**才抓得出来的（已修 + 已回归）

都出在「手机底部动作面板的开关」上，静态断言一条都拦不住：

1. **`display` 没翻过来** —— 开关的基础规则是 `display:none`（桌面永不显示），
   手机档我漏了把它改回 `flex`。表现：**手机上没有任何入口能打开面板**
   （四个按钮明明都在 DOM 里、CSS 规则也都在）。
2. **`transform` 成了 `position:fixed` 后代的包含块** —— 面板在手机上用
   `transform:translate3d(0, calc(100% + 14px), 0)` 滑出屏幕；开关原本是它的孩子，
   于是即使 `position:fixed` 也被钉在那条**已经移出屏幕的坐标系**里，
   可见面积 = 0。DevTools 报的是 `element not visible` / `not focusable`，
   而源码、选择器、DOM 全都正常。
   修法：开关改成面板的**兄弟节点**（`acts.parentNode.insertBefore(btn, acts)`）。

两条现在都有回归断言（`build/test-responsive.mjs` 第 13/14 条），
并且**验证过它们真的会红**（把坑塞回去跑一次，第 13 条立刻失败）。

## 已经存进来的图（2026-10-16，`browser_*` 拍的）

`browser_*` 拍出来的图落在 DSH 的会话附件里（`~/.dsh/attachments/v1/objects/…`），
它们是**真 PNG 文件**，直接从那儿拷进来即可（下面这些就是这么来的）。

```
390x844/     homework.top.png          手机档首屏：表格一列、科目成横幅
             homework.panel-open.png   手机档：底部动作面板打开（四个按钮）
             english.player-bar.png    手机档：迷你播放条 + 安全区
             class.mobile.png          手机档：卡片一列、右上角主题按钮 48px
768x1024/    homework.top.png          平板档（下沿）：仍然是一列
1440x900/    homework.top.png          桌面档：四个按钮横排、表格两列
             class.desktop.png         桌面档：卡片列表原样
```

命名规矩：`<视口>/<页面>.<形态>.png`（`top` = 首屏、`full` = 全页长图、
其余按内容起名）。差得还多——上面只覆盖了 3 个视口 × 2 个页面，
清单里那 7 视口 × 10 页面还没拍齐。

## 还没做的

- **图还没拍齐**（见上：只覆盖了 3 视口 × 2 页面）。要拍齐就按 ① 的流程走一遍，
  每拍一张把附件目录里那份按 `<视口>/<页面>.<形态>.png` 拷进本目录。
- `/p/archive/*.html` 这些控制台烘的旧产物还没有新外壳 ——
  要在控制台「归档与预渲染」点一次**重刷外壳**（正文不动）。
