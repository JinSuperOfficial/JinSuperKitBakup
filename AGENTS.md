# AGENTS.md · JinSuper 站点

给在这个仓库里干活的 AI / 人的项目级约定。改代码前先看这里，再看 `project.md`（交接文档）
和 `build/README.md`（构建系统详解）。

- 网站本体：`jinsuper.rth1.xyz/`（会被完整上传）；构建与部署工具：`build/`（不发布）
- 纯静态：**禁止 base64、禁止任何 CDN、禁止外部字体**，图标一律 inline SVG 或本地文件
- 正文对比度 ≥ 4.5:1（WCAG AA），悬停位移 ≤ 4px，入场动画 ≤ 700ms，尊重 `prefers-reduced-motion`

## 清单只有一个来源

站点的「有什么工具」由清单决定，**加工具不要改 HTML**：

- 工具清单：`jinsuper.rth1.xyz/Skills/skills.json`（工具站）、`jinsuper.rth1.xyz/811/tools.json`（811 专区）
- 站点目录：`jinsuper.rth1.xyz/site.json`
- 唯一运行时：`jinsuper.rth1.xyz/lib/manifest.js`（归一 / 排序 / 渲染 + 图标注册表；页面里不许再写自己的解析 / 猜图标 / 路径编码逻辑）
- 生成物不许手改：`sitemap.xml`、`docs/info/site-index.js`
- 改完清单跑：`node build/verify-manifests.mjs && node build/test-manifest.mjs`

完整字段表与三步流程见 **`MANIFEST.md`**。

## UI 圆角规范

**圆角不宜过高**，一律按 `theme-plus` 技能的圆角规范（macOS 风格，`references/circle_angle.md`）优化。
该技能是 **DSH 全局技能**，不在这个仓库里（原先的 `.agents/skills/theme-plus` 已移出去）：

```
F:\@AI\skills\theme-plus\references\circle_angle.md
```

- 默认 `rounded-md` / `rounded-lg`，窗口、主面板、弹窗最多 `rounded-xl`（12px）
- 禁止 `rounded-2xl` / `rounded-3xl`，禁止按钮、输入框、卡片使用 `rounded-full`
- 按钮 / 输入框 / 选择器 6–8px；卡片 / 菜单 / 浮层 8–10px；窗口 / 弹窗 / 主面板 10–12px；标签 / 徽章 4–6px
- 只有头像、开关、状态点允许胶囊（`--radius-pill` / 999px）
- 圆角不得超过元素高度的 25%–30%
- 嵌套保持同心：`inner-radius = max(0, outer-radius - padding)`
- 用 CSS 变量统一管理：`--radius-xs/sm/md/lg/xl/pill` + 语义 token（`--radius-card` / `--radius-control` …）
- 支持时渐进增强 `corner-shape: squircle`（写在 `@supports` 里，不支持就退回小半径）

修完用规范里的审查清单自查一遍，不要机械全局替换 `border-radius` / `rounded-full`（头像、开关、状态点合法）。

## 提交与备份（改完代码之后）

**只有用户明确要求时**才提交 / 备份 / 打 tag，不要自己顺手推。用户一旦要求
（"提交"、"备份一下"、"推到 bakup"…），**一次要做完三件事**：

```bat
部署.cmd bakup --tag <名称> --tag-message "<说明>"
```

1. **提交到备份仓库** —— `https://github.com/JinSuperOfficial/JinSuperKitBakup.git`（源码全量）
2. **给这个提交打 tag** —— `git push` 默认不推 tag，不打就没有，GitHub 标签页会一直空着
3. **推上去**（分支 + tag 各推一次，脚本已经处理好）

规矩：

- **tag 名与说明要反映这次的真实改动**：小修补用补丁号（`v1.0.1`），成体系的新功能用次版本号
  （`v1.1.0`），不拿同一个名字反复打（重名脚本会拒绝，换一个）。
  说明写「这次变了什么」，不要写「备份」两个字就完事。
- 只想要个时间点记号、不想编版本号时，可以用 `部署.cmd bakup --tag`（自动时间戳名）。
- **先看清再推**：拿不准会推什么就先跑 `部署.cmd bakup --check`。
- **用户不满意就回档**：备份仓库里每个 tag / 提交都是完整快照。要退回去就在那边
  `git checkout <tag>`（或 `git switch -c 旧版本 <tag>`），而不是在本地凭记忆手改。
  想保留现状、只试一版，就从旧 tag 新开一个分支提交，别在 main 上直接改历史。
- **备份和发布是两条线**：`部署.cmd bakup` 只碰源码和备份仓库，
  不会动 `dist\`、不会传热铁盒、也不会碰 `JinSuper.github.io`；
  部署（`部署.cmd full`）也不会顺手备份源码。别把两者混着说。
- 备份**不影响本地仓库以外的东西**：`node_modules`、`dist`、`.env`、`.deploy-logs`
  按 `.gitignore` 排除；自带 `.git` 的子目录会被跳过（脚本会提醒），
  那些目录要真进备份得先删掉里面的 `.git`。

细节（排除规则、tag 类型、认证与代理排障）见 `build/README.md` 的「备份源码」一节。
