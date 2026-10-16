# 跨网同步（Gitee 中转）

学校那台机器只能上 Gitee（连自己的站点、GitHub、微软都打不开），所以网站发布完之后
还需要**另一条线**把产物送到一个学校够得着的地方；学校那边录的作业也要能回到家里。

这条线就是 `sync`：

```
家里                                        学校（触屏台式机）
────                                        ────────────────────
部署.cmd full      → 热铁盒 + GitHub Pages   班级百宝箱 → 检查更新 → 本机离线副本变最新
部署.cmd sync push → Gitee 镜像 + _sync.json
                    （学校从这里取件）
      ↑                                                ↓
      └──── 部署.cmd sync pull / apply ←── Gitee 收件箱 ←── 作业编辑器「同步到云端」
```

- **发布**（`部署.cmd full`）、**备份源码**（`部署.cmd bakup`）、**跨网同步**（`部署.cmd sync`）
  是三件事，互不替代。
- 同步实现只有一份：`sync/lib/*.mjs`。家里那条由 `build/sync-cli.mjs` 驱动，
  控制台走 `console/lib/api.mjs`，桌面版走 `desktop/src/sync.js`。

## 一次性的准备（在家里做）

1. **建仓库**：Gitee 上新建一个仓库（建议私有），名字例如 `jinsuper-sync`。
2. **建令牌**：Gitee → 设置 → 私人令牌，只勾这个仓库需要的权限（`projects`）。
   ⚠ 学校那台机器的令牌是**打包时注进安装包**的（见「桌面版」一节），所以建议两张：
   一张家里用（可写 `site` 镜像 + 收件箱），一张只给安装包用（其实只需要写收件箱）。
3. **填配置**：
   - `sync.json`（仓库根，非机密）：`gitee.owner` 填账号，`gitee.repo` 填仓库名；
   - `.env`（不入库）：`JINS_GITEE_TOKEN=<令牌>`。
4. **建分支**：`部署.cmd sync init`（会把 `main`（镜像）和 `inbox`（收件箱）两个分支建好）。
5. **第一次推**：`部署.cmd sync push`。

## 家里的命令

| 命令 | 干什么 |
|:--|:--|
| `部署.cmd sync check` | 探通道 + 看云端版本 + 本地要传多少（学校第一次用之前先跑这个） |
| `部署.cmd sync status` | 本地/云端版本、收件箱有几份、仓库有多少没提交 |
| `部署.cmd sync push` | 组装 `dist/` → 写 `_sync.json` → 推 GitHub Pages 与 Gitee 镜像 |
| `部署.cmd sync pull` | 把收件箱拉到 `sync/inbox/<时间戳>/`（`--list` 只看不拉） |
| `部署.cmd sync apply --dry-run` | 预览会改仓库里哪些文件（默认就是预览） |
| `部署.cmd sync apply --write` | 真的落进仓库（作业那部分会顺手重建清单） |
| `部署.cmd sync upload <路径…> --root hwk` | 反向：把家里的文件传进收件箱 |
| `部署.cmd sync home` | 到家一条龙：pull → apply（确认）→ `部署.cmd full` |

选项：`--dry-run`、`--write`、`--no-github`（只推 Gitee）、`--no-prep`、`--stamp <时间戳>`、
`--only <关键字>`、`--root <hwk\|site\|misc>`、`--to <路径>`（走本地目录/U 盘）、`--json`。

四个入口说的是同一份实现，用法列表也一起改：

```
部署.cmd sync …      部署.sh sync …        （命令行）
控制台.cmd sync …    控制台.sh sync …       （同一份，入口不同）
控制台网页 →「跨网同步」面板                （图形化：状态 / 推送 / 拉取 / 预览 / 写入）
```

## 学校那边（桌面版）

- **班级百宝箱**（`JinSuper.exe`）→ 设置 →「云端同步」：检查更新、更新离线副本、
  上传文件到云端收件箱、重试队列。
- **作业编辑器**（`JinSuper.exe --app=homework`，安装后是桌面/开始菜单上的第二个快捷方式）：
  离线录作业，**先写本机**，联网后点「同步到云端」。
- 令牌是**打包时注进去**的（`desktop/build/make-sync-config.mjs` → `resources/sync-config.json`），
  所以学校那台机器不用登录、不用填任何东西。想换令牌就重新打一次包。
- 断网时改动会进本机队列（`%APPDATA%\JinSuper\sync\queue\`），联网后点「重试队列」。

## 两条方向上的细节

**镜像（家 → 校）**：内容就是 `dist/`（和热铁盒 / GitHub Pages 完全一致），
另外在根上多一个 `_sync.json`（每个文件的 sha256）。学校那边对比清单，
**只下变化的文件**；云端删掉的文件，本地离线副本也会跟着删。
`_sync.json` 在 `build/lib/deploy-files.mjs` 的 `KEEP_ROOT` 里 —— 否则每次组装都会被清掉。

**收件箱（校 → 家）**：一次上传打成**一个 tar.gz**（`inbox/<时间戳>/<root>.tar.gz`
+ `_manifest.json`），所以：
- 一个包 = 一次接口请求，不会被「文件数 × 接口限流」卡住；
- 描述文件**最后写**，传到一半断线不会被当成完整的收件箱。

`root` 与落地位置（`sync.json` 的 `roots`）：

| root | 落到仓库哪里 |
|:--|:--|
| `hwk` | `jinsuper.rth1.xyz/class/data/hwk/` |
| `site` | `jinsuper.rth1.xyz/`（网站内容，按上传时的相对路径） |
| `misc` | `sync/inbox/`（其他东西，原样留着） |

## 配额与限制（Gitee 社区版）

依据 [Gitee 产品配额说明](https://help.gitee.com/questions/Gitee%E4%BA%A7%E5%93%81%E9%85%8D%E9%A2%9D%E8%AF%B4%E6%98%8E)：
**单文件 ≤ 50MB、单仓库 ≤ 500MB**（附件 100MB / 1G）。当前 `dist/` 约 49MB、758 个文件、
最大单文件 2.6MB，余量充足。仓库接近上限时按 Gitee 的仓库瘦身文档处理。

- 超过 16MB 的单个包会自动分卷（`key.part001…` + `key.parts`），描述文件最后写。
- 镜像推送失败**不影响**已经完成的热铁盒 / GitHub Pages 发布。
- 私有仓库取件走 API（带令牌）；把 `visibility` 改成 `public` 就走免令牌的 CDN raw。

## U 盘兜底（可选，不必常驻）

学校网络完全不通、或者你想直接用盘搬一次：

```
部署.cmd sync push --to I:\jsd-out     # 把 dist/ 镜像到 U 盘目录
部署.cmd sync pull --to I:\jsd-out     # 从 U 盘目录取收件箱
```

任何路径都不会写死盘符、也不会自动探测可移动盘 —— **U 盘不常住电脑**，
所以日常流程不依赖它，只有显式传 `--to` 才走这条通道。

## 备案（只在用自定义域名时才需要）

默认走 Gitee 域名，**不需要备案**。桌面版设置里的「访问方式」给了两个选项：

- `Gitee（免备案，默认）`；
- `自定义域名 / 对象存储（需 ICP 备案）` —— 选它才会出现备案办理说明与入口按钮
  （工信部备案系统，通常 7–20 个工作日）。填的自定义域名存在 `publicBase` 里。

## 排障

| 现象 | 原因 / 怎么办 |
|:--|:--|
| `check` 报「连不上通道」 | 网络/代理问题；Gitee 是国内站，**不要**走 GitHub 那个代理（脚本已经显式清空 `http.proxy`） |
| 面板/命令说「云端还没有镜像清单」 | 家里还没跑过 `部署.cmd sync push` |
| 推 Gitee 失败：`non-fast-forward` | 镜像分支上有别处的提交；脚本会先 fetch+merge，冲突了就在 `dist/` 里手动处理 |
| 推 Gitee 失败：容量/单文件 | 见上面「配额与限制」，单文件超 50MB 的要排除在镜像外 |
| 学校点「更新离线副本」没反应 | 先看通道是否可达（`sync check`）；桌面版会把错误直接显示在设置面板里 |
| 收件箱里有一份「还没有 _manifest.json」 | 上传中途断了；重传一次即可，家里会跳过不完整的那份 |
| 桌面版同步按钮报未配置 | 打包时没注令牌：跑 `node desktop/build/make-sync-config.mjs --check` 看看 |
| 学校点「同步到云端」报上传失败（网络明明通） | 先看错误原文。**别急着怪网络**：写路径（`gitee.mjs` 的 put/del）只有 Gitee 后端走得到，曾经有个 `api.stat` 的 TypeError，本地通道的用例全绿也照挂 —— 现在 `build/test-sync.mjs` 用假 fetch 盯着这条路径。抓不到就手动验一遍：`node -e` 里 `createTransport(loadConfig().config)` 然后 `pushInbox` 传个小文件、再 `del` 掉 |
| 家里 `apply` 之后作业页没变 | 只 apply 还没发布：`部署.cmd full`（作业清单会在 apply --write 时重建） |
