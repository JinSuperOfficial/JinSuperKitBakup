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

**圆角不宜过高**，一律按 `.Skills/theme-plus/references/circle_angle.md`（macOS 风格圆角规范）优化：

- 默认 `rounded-md` / `rounded-lg`，窗口、主面板、弹窗最多 `rounded-xl`（12px）
- 禁止 `rounded-2xl` / `rounded-3xl`，禁止按钮、输入框、卡片使用 `rounded-full`
- 按钮 / 输入框 / 选择器 6–8px；卡片 / 菜单 / 浮层 8–10px；窗口 / 弹窗 / 主面板 10–12px；标签 / 徽章 4–6px
- 只有头像、开关、状态点允许胶囊（`--radius-pill` / 999px）
- 圆角不得超过元素高度的 25%–30%
- 嵌套保持同心：`inner-radius = max(0, outer-radius - padding)`
- 用 CSS 变量统一管理：`--radius-xs/sm/md/lg/xl/pill` + 语义 token（`--radius-card` / `--radius-control` …）
- 支持时渐进增强 `corner-shape: squircle`（写在 `@supports` 里，不支持就退回小半径）

修完用规范里的审查清单自查一遍，不要机械全局替换 `border-radius` / `rounded-full`（头像、开关、状态点合法）。
