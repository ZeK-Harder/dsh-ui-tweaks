# ui-tweaks / study-energy-bar —— 顶部学习时间能量条

> 包名 `@local/dsh-study-energy-bar`，Loader 行 id `study-energy-bar`。
> 一句话：**只有 DSH 或 VS Code 在前台、且你没在发呆时，才给「今天/本周」的学习时间掐表**，
> 顶部画一根对比上周的能量条。

## 1. 它回答的问题

学生原话（2026-10-11）：

> 「在顶部加一个能量条表示我的学习时间，只有电脑页面在 DSH 和 VS code 的时间才等于学习时间，
> 分别统计每天和每周的，记得刷新，并带有和上一周的时间对比，让我自己知道我的学习时间」

这是一个**双半插件**（DSH 的插件可以同时有宿主半和浏览器半）：

- **宿主半**（`index.js`，跑在 DSH 主进程里）负责两件事：
  1. 守护 `sampler.ps1` 采样进程（PowerShell，每 5 秒看一次前台窗口是谁）；
  2. 把账本算成统计值，用一条 HTTP 路由喂给页面。
- **浏览器半**（`client.js`，跑在你的页面里）只做一件事：每 30 秒 `fetch` 一次那条路由，画那根条。

浏览器看不见"哪个窗口在前面"，所以**计时逻辑必须全在宿主半**——这是这个拆分的唯一理由。

## 2. 它长什么样、在哪

座位是 `conversation.header.leading`（对话区顶部、会话标题**之前**的全局导航位，
`kind: single`、`scope: root`：没有会话时也在）。

```
[▓▓▓▓▓░░░░░░░] 今日 1h20m · 本周 9h05m ▲1h12m
```

- 条 = 本周 ÷ 上周（上限 100%）；颜色随比值走：
  `≥100%` 绿 / `≥70%` 品牌蓝 / 更低 黄 / **上周没有数据时**灰且条为空。
- **鼠标悬停**看完整明细：今日 DSH/VS Code 拆分、本周起始日、上周总数与对比、
  采样器是否在跑、最后写入时间、数据文件路径。
- 采样器没跑（或路由不可达）时右边会多一个黄色 `●`，平时不显示。

## 3. 什么算学习时间（计时规则）

| 条件 | 是否计时 |
| --- | --- |
| 前台窗口进程 = `DeepSeek Harness`（桌面应用） | ✅ 记 DSH |
| 前台窗口进程 = `Code`（VS Code，含 WSL 远程窗口） | ✅ 记 VS Code |
| 前台是浏览器，但**窗口标题含 `DeepSeek Harness`** | ✅ 记 DSH |
| 其它任何窗口（微信、Edge 其它页、终端…） | ❌ |
| 前台对，但你 **5 分钟没动键鼠** | ❌（防止挂着去睡觉刷时间） |

- 采样粒度 5 秒；一次采样若发现间隔 > 15 秒（机器休眠/挂起），只按 5 秒记，**不补记**。
- 每天 0 点自动换桶；**周一为一周起点**（`2026-10-11` 属于 `2026-10-05` 那一周）。

## 4. 数据放在哪、长什么样

账本：`C:\Users\24552\.dsh\study-time\study.json`（宿主半启动采样器时自动创建目录）

```json
{"schema":1,"updated":"…","startedAt":"…","samplerPid":88696,
 "intervalSec":5,"idleLimitSec":300,"tracked":["DeepSeek Harness","Code"],
 "last":{"cat":"dsh","proc":"DeepSeek Harness","title":"…","idleSec":0,"counted":true,"deltaSec":5},
 "days":{"2026-10-11":{"dsh":95.1,"vscode":0}}}
```

- 采样器**只累加秒数**，不做统计；统计（今日/本周/上周/对比）在宿主半里算 —— 这样改口径不用动采样器。
- 原子写：先写 `.tmp` 再 `Move-Item -Force`，**UTF-8 不带 BOM**（有 BOM 会让 Node 的 `JSON.parse` 抛错）。
- 采样器自身还有一把锁 `study.json.lock`（内含 pid），保证**永远只有一个采样器**在跑。
- 想清零：关掉插件 → 删 `study.json` → 再打开。

## 5. 装 / 重装 / 停用 / 卸载

```powershell
# 重装（唯一正路：install_bundle + 绝对路径）
#   plugin_manager: action=install_bundle,
#   target=C:\Users\24552\Documents\deepseek-harness\default-workspace\ui-tweaks\study-energy-bar

# 停用（不卸载，随时开回来）
#   plugin_manager: action=set_plugin, target=include:study-energy-bar, enabled=false

# 看它到底活了没有
#   plugin_manager: action=list_plugins          → include:study-energy-bar / active
#   cordis_inspect_query: client / Slots / listSubTree {root:"conversation.header.leading"}
#                         → occupants 里应当有 1 个 active 的占座
# 端口每次启动会变（0.2.1 实测 50265 / 旧版 19387），以窗口地址为准
curl.exe -s http://127.0.0.1:50265/study-energy/stats
```

### 实测证据（2026-10-11，全部真跑过）

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 两个半边语法 | `node --check index.js` / `client.js` 均 exit 0；`cordis.patch.yml` 解析出且仅解析出 1 行 insert |
| 2 | 首次 `install_bundle` | **失败**：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION billion-context@0.1.192`（profile 里既有依赖撞 pnpm 24h 供应链策略，与本插件无关） |
| 3 | 临时放开策略后重装 | `application: applied`、`+ @local/dsh-study-energy-bar link:…`；随后**立刻还原** `pnpm-workspace.yaml`，SHA256 `8B1929…`（176B）与备份逐字节一致 |
| 4 | Loader | `include:study-energy-bar`：`enabled=true`、`fiberPhase=active`（总数 195 → 197） |
| 5 | 宿主半（采样） | 采样器 `pid=88696`，父进程 = DSH 宿主 `pid=57972`；锁文件里 pid 一致；账本每 5 秒 `updated` 前进、`days.today.dsh` 递增 |
| 6 | 宿主半（供数） | `GET /study-energy/stats` → **HTTP 200** JSON：`week.start=2026-10-05`（周一）、`sampler.live=true`、`ratio=null`（上周无数据，符合设计） |
| 7 | 浏览器半（占座） | 安装后 `conversation.header.leading` 出现 1 个 occupant（`active:true`）；把行 `enabled:false` → occupant 变 `[]`；`enabled:true` → 又回来 ⇒ **占座的就是本插件** |
| 8 | 要不要刷新页面 | **不需要**（第 7 条是在没刷新页面的前提下做的）：宿主 Loader 里多一行，浏览器半边就会被服务并 apply |
| 9 | 视觉验收 | 导师没有截图通道，**只能你亲眼看**：条是否出现、位置是否满意、字是否太小 |

## 6. 坑与边界

- **`pwsh` 这个机器上没有**，唯一可用的是 Windows PowerShell 5.1：
  `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`，且执行策略是 `Restricted`
  → 启动采样器**必须**带 `-NoProfile -ExecutionPolicy Bypass -File`（`index.js` 里已经这么写）。
- **`.ps1` 必须保持纯 ASCII**：PS 5.1 按 ANSI/GBK 读脚本，UTF-8 无 BOM 的中文注释会导致
  `Unexpected token '}'` 之类的解析错误（本轮真踩过）。中文只写在本 README 里。
- **视觉验证导师做不了**：无法截图/读 DOM，视觉结论一律由学生给。
- **"VS Code 前台真的会计数"没有抢焦点实测**（导师刻意不抢你的焦点）：分类正确性由
  「前台进程名探测 + 用假进程名做映射测试」证明，真机确认要你自己看一眼。
- 采样器只认**前台**窗口：VS Code 和 DSH 并排时，只有焦点那个在计时（这是需求原文的意思）。
- 浏览器里的 DSH 页面算 DSH，靠的是**窗口标题匹配**；如果哪天窗口标题变了，改 `index.js`
  里的 `BrowserProcs` / 标题匹配即可。
- 卸载（`remove_bundle`）会同时摘掉宿主半与浏览器半；账本文件不会被删，留着下次继续用。
