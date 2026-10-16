# 811 套装 · 安卓版（`android/`）

给**同学**用的移动端（第三端）。装完点开就有作业，**零配置**：不用登录、不用填地址、
不用输令牌。要录作业时点另一枚图标，输密码解锁。

- 一个 APK + **三枚桌面图标**（对齐桌面版的「同一个 exe + 一个参数」）
- 站点页面**一行都没改**（不注入 DOM、不加样式钩子）；顶栏是原生层
- 和桌面版吃**同一份作业数据**：家里一条 `sync apply` 两边都能收

> 这一份是**用法 / 打包 / 排障**手册。设计要点与踩过的坑在根目录 `project.md` 的
> 「移动端（Android）」一节；`build/test-android.mjs` 会把本文里提到的密码、
> 常量、目录名跟源码逐个比对（改了实现忘了改文档会红）。

---

## 1. 装什么

三枚图标，同一个 APK：

| 桌面图标 | 进去是什么 | 备注 |
|:--|:--|:--|
| **811 看作业** | 直接看今天的作业（默认入口、桌面主图标） | 零输入，断网也能看离线副本 |
| **811 录作业** | 先弹密码框，过了才进编辑界面 | 密码见 §5 |
| **811 设置与同步** | 来源 / 回落开关 / 同步 / 维护 | 日常用不到，出问题才点 |

**国产 ROM 的图标问题**：MIUI / EMUI / ColorOS 对多图标支持不一致，有的会把三枚
合并成一枚、有的要手动添加。处理办法：

> 长按应用（或进「设置 → 应用 → 811 套装」）→ 应用信息 → **添加到桌面**。

装的是 `app-release.apk`（或 CI 产物 `jinsuper811-apk`），需要 Android 7.0（API 24）以上。

---

## 2. 它是怎么跑起来的

```
   ┌─ 看作业 ─ 按来源回落链挑一个能开的站 ────────────────┐
   │   cn 主站 → rth 热铁盒 → gh GitHub Pages → local 离线副本
   │   判失败 = 主框架加载出错 + 12 秒看门狗
   └──────────────────────────────────────────────────────┘
   ┌─ 离线副本 ─ 全部走固定虚拟域 ────────────────────────┐
   │   https://appassets.androidplatform.net/…
   │   子资源由 shouldInterceptRequest 接管（不走 file://、不走本地端口）
   └──────────────────────────────────────────────────────┘
   ┌─ 同步 ─ 只走 Gitee 收件箱（和「看」是两条独立通道）─┐
   │   拉：inbox/<时间戳>/hwk.tar.gz → 并进本机
   │   传：本机改过的那些天 → tar.gz → 最后写 _manifest.json
   └──────────────────────────────────────────────────────┘
```

### 为什么本地内容不走 `file://`、也不用本地端口

两条都是踩过的坑，写在这里免得以后有人「优化」回去：

1. **不能走 `file://`** —— 页面清单是 `fetch` 出来的，`file://` 下会被 CORS 拦掉。
2. **不能起一个本地 HTTP 服务、端口还不能随机** —— 作业页的勾选状态存在
   `localStorage`，键是 `hw:<id>:<条目哈希>`，而 `localStorage` **按 origin 隔离**。
   端口一随机，origin 每次冷启动都变，**同学之前勾过的作业会全部消失**。

所以用 `appassets.androidplatform.net` 这个**固定虚拟域**：外部浏览器访问它会走真实
DNS、找不到 —— 天然隔离，没有端口暴露风险，而且 origin 一辈子不变。

### 三条必须保住的行为（改了会出问题）

| 行为 | 为什么 |
|:--|:--|
| 本地服务对 `.php` 一律回 **404** | 阅读器取原文的第一选择是 `p/raw.php`；404 之后它才会按设计回落去直接取 `.md`。真把 PHP 源码发回去，页面会把源码当正文显示 |
| 支持 **Range**（206 + `Content-Range` + `Accept-Ranges`） | 英语听力页的 `<audio>` 靠它拖进度（离线副本里没音频，但将来可能加） |
| WebView 配 `domStorageEnabled = true` | 不配 = 勾选状态根本写不进去，表现是「勾了没反应 / 刷新就没」 |

---

## 3. 数据在哪

```
filesDir/                       ← 应用私有目录（**不是**外部存储）
├── hwk/
│   ├── index.json              目录（新的在前），形状和站点里那份一致
│   ├── hwk-<id>.json           一天一份：id / date / title / bg + 各科 + 笔记
│   └── .state.json             内部记账：导过基线没、哪些天还没同步
├── sync/
│   ├── queue/                  断网时的上传队列（一次失败一个 json）
│   ├── outbox/<时间戳>/hwk/    手动快照
│   └── incoming/               拉收件箱时的临时区（拉完就清）
└── site/                       云端同步下来的站点更新（优先于随包副本）
```

- **为什么不用外部存储**：会被系统清理、也会被别的应用看见 —— 同学的作业本不该被别人翻。
- **为什么 id 沿用 `n261010` 这种**：勾选状态键是 `hw:<id>:<条目哈希>`，换 id 等于把勾过的全清空。
- **换手机**：作业数据跟着系统备份走（`hwk/` 在备份范围内；同步队列与缓存不在）。
  另外还有一条兜底：`同步 → 立刻同步` 传一次，家里就有了。

---

## 4. 打包

### 前置

- JDK 17（Temurin 就行）
- Android SDK：`platforms;android-34` + `build-tools;34.0.0`
  （在 `android/local.properties` 里写 `sdk.dir=…`，或设 `ANDROID_HOME`）
- Gradle 不用单独装 —— 仓库里有 wrapper（`gradle/wrapper/gradle-wrapper.jar`）

### 一条龙（本机）

```bash
cd android

# ① 先把「生成物」准备好（离线副本 + 编辑器界面，都不入库）
node tools/sync-site-assets.mjs

# ② 要能传作业就注入同步配置（含令牌，不入库；缺 .env 就跳过这步，包只能看不能传）
node tools/inject-sync-config.mjs --from "老师手机"

# ③ 跑单测（不需要真机）
./gradlew testDebugUnitTest

# ④ 打包
./gradlew assembleDebug          # 调试包（applicationId 带 .debug 后缀）
./gradlew assembleRelease        # 正式包（要签名，见下）
```

产物在 `app/build/outputs/apk/{debug,release}/`。**实测体积**（2026-10-16，本机）：

| 包 | 体积 | 说明 |
|:--|:--|:--|
| `app-debug.apk` | **7.98 MB** | 没开 minify / shrink，只用来装机调试 |
| `app-release-unsigned.apk` | **1.38 MB** | R8 + 资源收缩之后 —— **静默 APK 目标 ≤ 8MB 这条，余量还很足** |

（release 那个「-unsigned」是因为本机没配 keystore；按下面的签名步骤走一次就是正式包。
体积里已经算上了离线副本那 0.73MB。）

### 正式包与签名

**keystore 在 `android/keystore/jinsuper.jks`，而且它〔进备份仓库〕** ——
`部署.cmd bakup` 走的 git 是按 `.gitignore` 过滤的，所以这里专门留了一条
`!android/keystore/jinsuper.jks` 把它捞回来。理由是**安全的是口令，不是文件**：
jks 本身有口令保护，而它一旦丢了就永远无法覆盖升级，放进备份才睡得着。

**口令存密码管理器，绝不写进任何会被提交的文件**（`android/gradle.properties` 是入库的，
别往那儿写；`.gitignore` 已经把 `keystore.properties` 也挡掉了）。

### 这把钥匙（2026-10-16 生成，核对用）

| | |
|:--|:--|
| 别名 | `jinsuper811` |
| 格式 | PKCS12（`keytool` 在 JDK 9+ 的默认） |
| 证书主体 | `CN=金旭, OU=JinSuper, O=811-studio, L=温州市, ST=浙江省, C=CN` |
| 有效期 | 2026-10-16 → **2054-03-03**（Android 只要求到 2033，余量够） |
| 算法 | RSA 2048 / SHA256withRSA |
| **证书 SHA-256** | `A6:E1:7B:DC:76:5D:C5:39:47:C5:5A:5A:84:7B:D4:B8:15:13:FB:66:18:29:63:58:EF:36:E7:CD:C6:DE:C2:A5` |
| **证书 SHA-1** | `20:56:64:13:98:D3:FC:50:19:BA:BF:A1:BE:59:F5:B2:E3:32:C2:CC` |

**这两行指纹就是「是不是同一把钥匙」的唯一判据**，也抄一份进密码管理器。

> ⚠️ **正式发出去的 APK 必须一直用这把钥匙签。** 换一把 = 装过旧版的人
> **永远无法覆盖安装**（只能卸载重装，作业数据得先导出）。这是不可逆事故。

### 怎么签

```bash
cd android
export JINS_KEYSTORE=keystore/jinsuper.jks     # 相对 android/（脚本用 rootProject.file 解析）
export JINS_KEYSTORE_PASSWORD='…'              # 口令在密码管理器里
export JINS_KEY_ALIAS=jinsuper811
export JINS_KEY_PASSWORD='…'
./gradlew assembleRelease                      # → app-release.apk
```

路径也可以给绝对路径。**不配这些照样能构建**，只是出一个 `app-release-unsigned.apk`
（装不上，用来验流程）—— 这条行为有测试盯着。

验证签名：

```bash
$ANDROID_HOME/build-tools/34.0.0/apksigner verify --print-certs --verbose \
  app/build/outputs/apk/release/app-release.apk
# 证书 SHA-256 应该和上表那行一模一样
```

实测（2026-10-16）：**v2 方案 `true`**、v1 是 `false`、v3 是 `false`。
v1 为 false 是 AGP 对 `minSdk >= 24` 的默认行为（Android 7.0+ 不校验 v1）。
**如果有人把 `minSdk` 降到 24 以下，v1 就变成必需的** —— 那时候要去
`signingConfigs` 里显式打开 v1，否则 Android 6 及以下装不上。

### ⚠️ 已知并**有意接受**的风险：签名口令与作业密码是同一个值

这条是**用户明确拍板的**，不是疏漏 —— 写在这儿免得以后有人把它当 bug「修」一遍。

- 签名口令：`114514`（6 位纯数字）
- App 内的作业编辑器密码：**也是 `114514`**，硬编码在 `PasswordGate.kt`，**随 APK 发出去**

三个事实叠在一起，链路是通的：
**反编译任意一个发出去的 APK → 读到 `114514` → 拿它去解仓库里的 `jinsuper.jks`。**
又因为 keystore 是入库的（见上），只要仓库泄露或拿到一份 APK，签名私钥就等同于泄露。

已确认的风险面：
1. **口令重复使用**（不只是强度问题）——同一个值既是低价值门槛（拦同学）又是高价值秘密（签名私钥）；
2. **keystore 入库**放大了后果：不必有仓库写权限，只要读得到就够；
3. 拿到签名私钥 = **可以签一个包冒充官方更新**。

想收口的话，成本很低的两个做法（**都不用重造钥匙**）：
- 改签名口令（`keytool -storepasswd`）——密钥对不变，**指纹不变，不用重打 APK**；
- 或者把作业密码改成一个跟签名口令无关的值（改 `PasswordGate.kt` 的常量，重打 APK）。

> 真要换**钥匙**（而不是口令）就完全是另一回事了：装过旧版的机器**永远无法覆盖安装**，
> 只能卸载重装、先把作业导出来。所以上面两条「不换钥匙」的做法才是首选。

### 重新生成（只有在钥匙真的丢了 / 要彻底换一套签名时才做）

```bash
keytool -genkeypair -v \
  -keystore android/keystore/jinsuper.jks \
  -storetype PKCS12 \
  -alias jinsuper811 -keyalg RSA -keysize 2048 -validity 10000
```

生成完记得：① 抄指纹；② 把新口令存进密码管理器；
③ 在 `project.md` / 本文件里更新上面那张表；④ **通知所有装了旧版的人卸载重装**。

### CI（推荐）

`.github/workflows/android.yml`：推 `main` 且动了 `android/**` / 站点 / `desktop/src/ui/hwk/**`
/ `sync/lib/**` 就自动跑 —— 同步离线副本 → 注入令牌 → 单测 → 打 release → 传 Artifact。
也可以手动 `workflow_dispatch`（要重打一个带新令牌的包时不用编空提交）。

需要在仓库 Secrets 里配：

| Secret | 用途 | 缺了会怎样 |
|:--|:--|:--|
| `JINS_GITEE_TOKEN` | 打包时注进 `assets/sync-config.json` | 出一个「只能看不能传」的包，打一条 `::warning` |
| `JINS_KEYSTORE_BASE64` | 签名 .jks（base64 一行） | 出未签名的 release |
| `JINS_KEYSTORE_PASSWORD` | keystore 口令 | 同上 |
| `JINS_KEY_ALIAS` | 密钥别名 | 同上 |
| `JINS_KEY_PASSWORD` | 密钥口令 | 同上 |

CI 结束时会 `rm -rf android/keystore` —— keystore 不留在 runner 上。

---

## 5. 密码

**进「录作业」要输密码，当前是 `114514`。**

- 常量在 `app/src/main/java/xyz/rth1/jinsuper811/PasswordGate.kt` 的 `EDIT_PASSWORD`
- 改密码 = 改这个常量 + **重打一个 APK**（手上旧包还是老密码）
- 验证在**壳层**（Compose 弹框里），**不在网页里** —— 网页 JS 的密码 F12 就能看到
- 过了之后**只在本次进程内有效**：退出编辑模式或杀掉应用就失效，**不写盘**
- 错了只说「密码不对」，**不限次数**（给同学用，不做防爆破）
- **没有「记住密码」，也没有「忘记密码」** —— 忘了就找管理员重打一个

> 这道门拦的是「想改作业的同学」，不是攻击者。真正的边界是 §6 的令牌。

---

## 6. 同步（Gitee 收件箱）

- **看作业**走来源回落链（§2），**传作业**只走 Gitee 收件箱 —— 两条独立通道
- 令牌**打包时明文注入** `assets/sync-config.json`（那个文件不入库）
- 上传格式与桌面版**逐字节兼容**：`inbox/<时间戳>/hwk.tar.gz` + `_manifest.json`（最后写）
- 断了网就**排队**（`filesDir/sync/queue/`），下次点「立刻同步」重放 ——
  **没有后台任务**：系统会把后台进程杀掉，同学还会以为已经传上去了

### 令牌轮换（出事时照这个走）

```bash
# 1. 在 Gitee 侧撤销旧令牌，并新建一个
# 2. 更新项目根 .env 里的 JINS_GITEE_TOKEN
# 3. 重打一个 APK（本机或 CI 手动触发）
node android/tools/inject-sync-config.mjs --from "老师手机"
cd android && ./gradlew assembleRelease
# 4. 把新 APK 发出去；旧 APK 里的令牌已经失效，不用管它
```

> ⚠️ **别把带令牌的 APK 发到公开的地方**。明文注入是有意选择（加密只让解包难度上升
> 一档，不改变「能被解包」这件事，却会把复杂度拉满）—— 代价就是「发出去的包等于
> 发出去一份令牌」，所以**撤销流程必须真的能走**，上面那四步别省。

---

## 7. 测试

```bash
npm run check:android     # tar 样本比对 + 离线副本比对 + ./gradlew testDebugUnitTest
npm run check             # 全仓库（含 build/test-android.mjs 的跨端契约测试）
```

`./gradlew testDebugUnitTest` 里跑的（都是纯 JVM，不需要真机）：

| 测试 | 盯什么 |
|:--|:--|
| `InboxTarGzTest` | **跨端 tar 的字节级兼容**：Node 打的包要解得开，自己打的要跟 Node 逐字节相同 |
| `HwkStoreTest` | 数据落在 `filesDir/hwk/`；JSON 键序与缩进和站点一致；基线只导一次不覆盖 |
| `JsonTest` | 自己那份 JSON 读写（键序保持、制表符缩进、`1.50` 不被改写） |
| `OriginsTest` | 来源表与回落链；**本地 origin 必须是固定的虚拟域** |
| `SiteAssetsTest` | 路径归一、`.php` → 404、MIME |
| `PasswordGateTest` | 密码门；**不写盘**；不限次数 |
| `InboxTest` | **`_manifest.json` 最后写**；包结构与清单字段；sha 校验 |
| `SyncEngineTest` | 读方向不覆盖本机改过的；写方向先 stat 再 put；失败进队列不抛 |
| `SyncQueueTest` | 队列进出、部分成功、上限、坏文件不致命 |

---

## 8. 排障

| 现象 | 原因 / 处理 |
|:--|:--|
| **图标只看到一个** | 国产 ROM 合并了 alias。长按图标 → 应用信息 → 添加到桌面 |
| **勾选状态每次都清空** | origin 漂移了。检查有没有人把本地内容改成「127.0.0.1 + 随机端口」—— `Origins.LOCAL_HOST` 必须是固定虚拟域 |
| **听力页没声音** | 音频走线上（不进包），断网时按设计静默降级 |
| **`.php` 显示成源码** | `LocalContentHandler` / `SiteAssets` 里的 404 分支漏了 |
| **页面白屏** | WebView 内核太老。核心页按保守写法（不依赖很新的 JS 特性）；实在不行报给管理员 |
| **同步一直失败** | 令牌过期或被撤销 → 照 §6 走一次轮换 |
| **密码输对了也进不去** | `PasswordGate.kt` 的常量被改过、而手上这个包是老的。重打一个 |
| **打不开页面但能看作业** | 正常：来源回落链最后一级是离线副本，只带「看作业」那一路的页面 |
| **装的 debug 包和正式包能共存** | 故意的：debug 的 applicationId 有 `.debug` 后缀 |

---

## 9. 改这个目录时注意什么

1. **别把 `.gradle.kts` 顶上的注释写成块注释**（`/* … */`）——
   Kotlin 脚本编译器会把它编译成**空脚本**，不报错，plugin / 依赖全都不生效。
   `settings.gradle.kts` 上栽过一次，报出来的是「找不到 AGP 插件 / Searched in:
   Gradle Central Plugin Repository」，看上去像仓库没配。**一律用 `//` 行注释。**
2. **Kotlin 注释里别写「斜杠 + 星号」**（比如 `queue/` 后面跟个 `*`）——
   会嵌套开一层注释，括号配不平，报的行号在文件末尾。用文字描述，别用那两个字符。
3. **XML 注释里别写连续两个减号** —— 那是 XML 语法错误，aapt 直接拦下。
   （写 CSS 变量名时最容易犯：`--bg` 要写成「背景色」。）
4. **改了来源表 / 保留字 / 收件箱常量 / tar 格式** —— 三处要一起动：
   Kotlin 一份、`desktop/src/origins.js` 或 `sync/lib/*.mjs` 一份、
   以及作业页里的 `INLINE_RESERVED`。`build/test-android.mjs` 会三处比对。
5. **离线副本清单在 `tools/sync-site-assets.mjs` 里逐条列出**（不是通配）——
   加文件要有意识，别「不小心把 36MB 的听力音频拷进去」。
6. **改了站点页面或编辑器界面之后**，顺手跑一次 `node tools/sync-site-assets.mjs`，
   否则离线副本过期（`npm run check` 会红）。
