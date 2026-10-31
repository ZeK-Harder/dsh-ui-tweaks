# @local/dsh-project-progress · 顶部项目进度条

工作区自研 DSH 双半插件。数据源是工作区根目录的 `项目进度.md`（两层清单：大步骤 + 小步），
勾选即更新，不需要重启 DSH。

## 1. 两个座位（都是加法座位，顶不掉官方 UI）

| 座位 | 位置 | 长什么样 | 能不能点 |
| --- | --- | --- | --- |
| `shell.overlay` | 窗口最顶边，横贯整幅 | 3px 细条，按大步骤分段的双层进度 | **不能**，`pointer-events: none`，永不抢点击 |
| `conversation.session.header.utilities` | 会话标题那一排的右端（`open-in-app`、`session-log-download` 右边） | `▓░░ P1 上位机 8% 第2/9步 4/50`（**数字随清单实时变**；`第 n/N 步` = 当前位置） | 悬停/聚焦 → 弹出**可滚动**的完整清单面板 |

- 顶边细条：**一段 = 一个大步骤**（按规格书的模块顺序从左到右：骨架 → proto → log → net → pool → store → crash → loadgen → 文档）；
  每段**自己**按小步完成率填充，**当前所在的大步骤**轨道更亮，整段做完填绿（`SUCCESS` = `--dsw-alias-state-success-primary`）、
  没做完填蓝（`IN_PROGRESS = '#4d6bfe'` 字面量，**故意不用主题的 brand token**，原因见 §6 最后一条）。
- 段宽由 `client.js` 顶部的 `WIDTH_MODE` 决定：`'weighted'`（**默认**，学生 2026-10-11 选定：按小步条数加权 ⇒
  一眼读出哪个模块活多：net 10 / log 8 / 文档 7 / loadgen 6 宽，store 2 / crash 2 窄 **—— 这些数字随 `项目进度.md` 变**）
  或 `'equal'`（九段等宽 ⇒ 一眼读出"在第几段"）。改完刷新页面即生效（不用重装）。
- 右侧小胶囊：悬停（或 Tab 聚焦）弹出**自绘的完整清单面板** —— 总进度 + 当前位置 + 每个大步骤 `done/total` + 每条小步的 ✓/·。
  **2026-10-13 起不再用浏览器原生 `title` tooltip**：原生的没有滚动条，清单涨到 40+ 条时在窗口下沿被裁掉（学生原话："这也没个滚动条什么的，都看不到后面的内容了"）。
  现在的面板：`react-dom` 的 `createPortal` 挂到 `document.body`、`position: fixed`、`max-height: min(72vh, 560px)` + `overflow: auto`；
  面板内滚轮滚动**不会**关掉它，鼠标离开胶囊/面板 **180 ms** 后才关，页面滚动或缩放窗口立即关。
- `shell.overlay` 的官方契约原文：*the layer itself is click-through — entries opt back into pointer events*。
  本插件**从不** opt back in，所以这条细条在任何位置都不会挡住点击（代价：它没有 hover，没有 tooltip）。

**2026-10-31 三处增强（都只动 `client.js`，按刷新按钮后生效）**：

- **细条上的当前位置游标**：当前大步骤的左缘加一条 2px 竖线（`S.cursor`，用 `--dsw-alias-label-primary`，
  深/浅主题都不会消失）。3px 高的条子只靠"轨道更亮"读位置太弱。
- **面板打开时自动滚到当前大步骤**：只在**打开那一刻**滚（`useEffect [open]`），5 秒轮询重渲染不会打断手动滚动
  ——否则学生滚到一半就被拽回去。滚动量 = 当前块 `offsetTop` − 顶部 sticky 提示高度 − 8。
- **面板顶部 sticky「下一步」**：直接给「当前大步骤里第一条未勾的小步」，滚到哪都钉在顶上。
  没有它，52 条清单要自己找"我现在该干嘛"。

## 2. 数据源与格式

`项目进度.md`（工作区根，和 `PROGRESS.md` 并排）：

```md
# 项目一 · epoll 工业网关 V1.0     <- 第一行 # = 项目名

## 大步骤标题                        <- ## = 大步骤
- [x] 做完的小步
- [ ] 没做的小步                     <- - [ ] / - [x] = 小步
```

规则：

- 进度 = 已勾小步 ÷ 全部小步；大步骤自己不用勾（它的完成度由小步算）。
- **主动延后的欠账**（"先不挡路，但没取消"）写法是**丢进最后一节「延后桶」**，仍然是 `- [ ]`：
  这样它照样计入分母（百分比不虚高），但「当前位置」= 第一个还有未完成小步的大步骤，
  放在最后就不会被它抢走箭头。条目文案建议 `- [ ] <模块> · <条目>（延后原因）`。
  *为什么不打 `[~]` 标记*：宿主半在跑的是**进程启动时加载的那份 `index.js`**，禁用→启用只重载
  浏览器半边；`[~]` 解析要等下次重启 DSH 进程才生效，在那之前 `[~]` 行会被旧模块**当成无效行漏数**
  （实测：4 条 `[~]` 让分母 41→37、27%→30%）。见 §6 最后两条。
- 其它行（说明、空行、表格）**一律忽略**；``` 围起来的代码块里的示例也不会被数进去。
- 出现在任何 `##` 之前的小步会被归入「（未分组）」并在 tooltip 里给出警告，不会静默丢弃。
- 文件读不到 / 解析出 0 条小步 → 胶囊显示 `项目进度 --`（或 0/0），tooltip 里写原因，不报错、不崩。

路径解析顺序（每次请求现算，2026-10-31 起支持工作区搬家）：

1. 路由参数 `?file=<绝对路径>`（显式覆盖；本目录的宿主自检也用它证明解析顺序）
2. 环境变量 `DSH_PROJECT_PROGRESS_FILE`
3. **已注册工作区里根目录有 `项目进度.md` 的，取 mtime 最新的那个**（正常情况走这条：清单跟着工作区走，和 `PROGRESS.md` 并排）
4. 旧位置 `ui-tweaks/project-progress/../../项目进度.md` 只作兜底，且**不参与第 3 步扫描** —— 免得一份历史遗留拷贝抢走真正的清单

> 为什么不在 profile 补丁里写死路径：宿主半的代码和配置都要重载才生效，而工作区会搬/会新建；跟着注册表走，换工作区不用改插件。

## 3. 刷新节奏

- 浏览器半每 **5 秒**拉一次 `GET /project-progress/stats`；切回页面/窗口获得焦点时立刻拉一次。
- 两个座位共用**同一个**轮询器（只有一个 `setInterval`，最后一个座位卸载时停掉）。
- 宿主半每次请求都重新读盘（文件只有几 KB），所以没有缓存陈旧问题。
- 拉取失败不会清空显示：保留上一次的数字，胶囊尾部亮一个 `●`。

## 4. 改完必跑的三道检查

```powershell
cd C:\Users\24552\Documents\deepseek-harness\default-workspace\ui-tweaks\project-progress
# 1) 客户端产物护栏（顶层零声明 + __ModuleLoader__ id 与包名一致）—— 每次改 client.js 必跑
& "C:\Users\24552\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" verify\check-client-bundles.cjs
# 2) 宿主半能被真 import（语法/ESM 层）
& "C:\Users\24552\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" -e "import('file:///C:/Users/24552/Documents/deepseek-harness/default-workspace/ui-tweaks/project-progress/index.js').then(m=>console.log('OK', Object.keys(m)))"
# 3) 宿主半功能自检（stub ctx 真跑路由 + 真解析 项目进度.md）—— 改 index.js 或改清单格式后必跑
& "C:\Users\24552\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" verify\check-project-progress-host.cjs
```

第 3 条会打印：路由注册情况、HTTP 状态码、项目名、总进度、当前位置、每个大步骤的 `done/total`、
解析警告；并顺带验证「非 loopback → 403」「POST → 405」。

## 5. 安装 / 卸载

- 装：`plugin_manager install_bundle` → target = 本目录**绝对路径**；然后确认 `list_plugins` 里
  `include:project-progress` = `fiberPhase: active`。
- 卸：`plugin_manager set_bundle` target=`@local/dsh-project-progress`、enabled=false（座位立刻消失，不用刷新）。
- 只改前端渲染 → 保存 `client.js` 后**刷新页面**即可。
- **改 `index.js`（宿主半）必须重载宿主插件**：按 unlag 的刷新按钮（或先开「Agent 可以自己刷新」再让 Agent 按）。
  实测 2026-10-31：往 `index.js` 加一个 `probe` 字段后连等 18 秒，`GET /project-progress/stats` 仍是旧形状 ——
  **宿主自带 HMR 不会自动换这个本地插件**，别指望改完文件就生效。

## 6. 坑（都踩过）

- `cordis.patch.yml` 的行 `name` 必须是**裸包名**：客户端模块扫描器拿它去解析 `<name>/package.json`，
  写成子路径会被缓存成"不是客户端包"，浏览器半边静默不加载。
- `window.__ModuleLoader__.load({ id })` 的 id 必须等于 `package.json` 的 `name`，否则报
  `loaded without registering ...`。
- 没有构建步骤：**不能写 JSX**，只能用 `React.createElement`。
- `shell.overlay` 里禁止 opt back into 指针事件（本插件故意的设计：细条永不挡点击）。
- 主题色用 `var(--dsw-alias-*)` 并带兜底色：若 `background: var()` 解析失败会变成透明，条就"消失"了。
- **兜底色只在 token 不存在时生效**。2026-10-11 用 `Bitmap.GetPixel` 扫学生截图发现：半完成的 log 段
  （4/8）渲染成 `rgb(32,34,38)` **近黑**——即 `--dsw-alias-brand-primary` 在本主题**存在**且就是近黑
  （DSH 的品牌色），`#4d6bfe` 兜底永远不会被用上，于是"进行中"看起来像一条黑杠。
  ⇒ 「进行中」改用字面量蓝 `IN_PROGRESS = '#4d6bfe'`（`client.js:60`），改回 token 会让黑杠复现。
  这也说明：**客户端的观感问题别靠猜，可以让学生截一张图，再用像素取样反推代码里哪个值生效了。**
- **宿主半改代码不会自动生效**：`set_bundle enabled=false/true` 只重载**浏览器**半边（客户端 bundle 会重拉），
  宿主模块走 Node 的 ESM 缓存，要**重启 DSH 进程**才会重新 `import`。
  实测（2026-10-11）：给 `index.js` 加了 `[~]` 延后标记解析后，禁用→启用再做 `GET /project-progress/stats`，
  返回的仍是旧形状（没有 `deferred` 字段）。⇒ 规则升级期间**别在清单里用新标记**，否则旧模块会静默漏数。
- **清单文件却是即时生效的**：`GET` 每次重新读盘（不缓存），所以在跑着的进程里改 `项目进度.md` 是立刻反映的 ——
  只有"解析规则"要重启，"数据"不用。
- **别用链接给旧路径"喂"数据**（2026-10-31 实测，两条都堵死）：
  - 文件符号链接要管理员权限：本机 Windows 开发者模式没开，`mklink` 直接报「没有足够的权限」。
  - 硬链接不用管理员，但 **DSH 写文件是 temp+rename**：用 `edit` 改一次，inode 就从 `a/b` 共享变成两个独立文件
    （实测 hardlink count 2 → 两边各 1，旧路径留成一份冻结快照）。⇒ 想"旧路径也能看到新内容"只有改代码这条路。
- **清单不是插件自己的数据，是学习工作区的文件**：它要进 git、要和 `PROGRESS.md` 并排，所以路径跟着注册工作区走，
  不要往插件目录里存，也不要在 profile 补丁里写死。
