# ui-tweaks —— DSH 界面/功能改造区

> **这个窗口只做 DSH 界面/插件改造，不推进学习主线**；学习在主工作区（`C:\Users\24552\Documents\机器人应用层学习`，显示名已改为「本科就业-设备软件」）的另一个会话里推进。
> 本目录是这些插件的**源码 + 版本管理**（`git` 仓库，远程 `ZeK-Harder/dsh-ui-tweaks`）：改坏能回滚，和学习计划无关。
> 下面的 `README.md` 都是**工程笔记**（时间戳 + 踩坑 + 约定），不是正式交付文档，不追求排版，追求下次别再踩同一个坑。


## 一、清单

| 目录 | 包名 / 行 id | 状态 | 作用 |
| --- | --- | --- | --- |
| `vscode-code-style\` | `@local/dsh-ui-vscode-code` / `ui-vscode-code` | ✅ 在用（已验收） | 代码字体/行高改成 VS Code 风格 |
| `study-energy-bar\` | `@local/dsh-study-energy-bar` / `study-energy-bar` | ✅ 在用（已验收） | 顶部学习时间能量条（`sampler.ps1` 采样 + 宿主路由 + 客户端条） |
| `image-lightbox-close\` | `@local/dsh-image-lightbox-close` / `image-lightbox-close` | ✅ 在用（已验收） | 图片浮层关闭键从标题栏 × 那角挪到左上 |
| `project-progress\` | `@local/dsh-project-progress` / `project-progress` | ✅ 在用 | 顶边细条（`shell.overlay`）+ 会话标题右侧胶囊（`.utilities`）：**只显示当前项目**的小步进度，数据源工作区根 `项目进度.md` |
| `quote-reply\` | `@local/dsh-quote-reply` / `quote-reply` | ✅ 已装（等学生刷新验收） | 每条助手回复加「引用」按钮：点一下把该回复文本以 `> ` 格式插进输入框（`conversation.chat.assistant-actions` + 官方 `InputActions`） |
| `quick-reload\` | `@local/dsh-quick-reload` / `quick-reload` | ❌ **已彻底移除**（2026-10-11：`remove_bundle` + 删源码目录 + profile 依赖清理；要回来得重写，README 存档在 git/对话里） | 会话标题栏「⟳ 重载」按钮，学生判定没用 |
| `_profile-backup\` | — | 备份 | 见下 |

## 二、改一个插件的固定流程（事故 #6 之后定下的）

1. **改**：客户端半的**所有常量都放进 `factory()`**；宿主半保持 `export function apply() {}`。
2. **自检**（必跑，客户端半）：`node verify\check-client-bundles.cjs` —— 零容忍任何顶层
   `const/let/var/class/function`（DSH 把所有 `client.js` 拼成一个 combo 脚本，共用一个顶层作用域：
   两个插件都在顶层写 `const CSS` 就是 2026-10-11 那次「应用无法启动」）。
3. **宿主半**再跑一次真 `import()`，确认导出 `apply`。
4. **装**：`plugin_manager install_bundle target=<插件目录绝对路径>`；只看返回里的
   `application` 是不是 `applied`、`warnings` 是不是空。
   - 撞 pnpm 供应链策略（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）时：临时在
     `C:\Users\24552\.dsh\profiles\desktop\pnpm-workspace.yaml` 加一行 `minimumReleaseAge: 0` →
     装 → **立刻**用 `_profile-backup\pnpm-workspace.yaml.orig` 覆盖还原
     （SHA256 应为 `8B192933D25F2D22EE1CEFD63CD5A30BACFDF59A256E752310BFD27F130E653B`、176 B）。
   - **一次只开一个新插件**，确认能起动再加下一个。
5. **验**：`plugin_manager list_plugins` 看 `include:<行 id>` = `enabled/fiberPhase: active`；
   座位类改动用 `cordis_inspect_query`（client / `Slots` / `listSubTree`）看 occupant 是否 `active: true`；
   确认没有新的 `…\dsh-desktop\logs\crash-*-web-boot.log`。
6. **记**：更新本文件 + `PROGRESS.md`（锚定式，别整篇写）+ 对应插件的 `README.md`。

**下架**：`plugin_manager set_bundle target=<包名> enabled=false`（保留文件，想开回来重新 `install_bundle`）。
真正起不来时用 DSH 崩溃框的「禁用第三方插件、备份 profile patch 并重启」。

## 三、备份（都在 `_profile-backup\`）

| 文件 | 是什么 |
| --- | --- |
| `cordis.patch.yml.orig` (913 B) / `package.json.orig` (818 B) | 最早一版 profile 配置 |
| `pnpm-workspace.yaml.orig` (176 B, SHA `8B192933…653B`) | pnpm 策略原文（临时放宽后靠它还原） |
| `cordis.patch.yml.after-recovery` (746 B) / `package.json.after-recovery` (950 B) | 事故后 DSH 自动降级那一版 |
| `cordis.patch.yml.degraded-746` | 同上 patch 的另存名 |
| （现行）`C:\Users\24552\.dsh\profiles\desktop\cordis.patch.yml` | 1000 B / SHA `654055162C519D2F…`，含 `fontSize: 21` 等个人设置 |

## 四、契约速查（省得再翻源码）

- 双半 bundle 三条硬要求：`package.json` 有 `exports["./client"]` + `dsh.client{platform:'web'}`；
  patch 行的 `name` 是**裸包名**；客户端产物 `__ModuleLoader__.load({id})` 的 `id` **等于包名**。
- 浏览器半**不能写 JSX**（无构建步骤）：用 `React.createElement` 或 `require('react/jsx-runtime')`。
- 宿主 ↔ 浏览器唯一通道：宿主半 `webServer.register({kind, path, handler})` + 浏览器同源 `fetch()`。
- 选座位优先挑**空着且 `replaceRisk: none`** 的：顶部常驻用 `conversation.header.leading`（`kind: single`，
  **一条就占满**，能量条已占）；会话标题那一排用 `conversation.session.header.actions`（`kind: list`，`id` 必填、`order` 升序）；
  标题**右侧**用 `conversation.session.header.utilities`（同为 list）；整框浮层（顶边条/toast 类）用 `shell.overlay`
  （`kind: list`、`scope: root`，**层本身 click-through**，不 opt back `pointerEvents` 就不挡点击）。
- **不能碰的座位**：`conversation.header`、`conversation.session.header`、`.lineage`、`.corner` 都是
  `replaceRisk: shadows-shipped-ui`（注册上去会顶掉官方导航）。
