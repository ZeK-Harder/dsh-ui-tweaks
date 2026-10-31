# 引用回复（`@local/dsh-quote-reply`）

选中对话里的任意文字 → 上方浮出小药丸：**复制 · 引用**（照豆包，无朗读）。

- 点「复制」：选中文本进剪贴板（按钮短暂变「已复制」）
- 点「引用」：选中文本以 `> …` 引用格式插进输入框，药丸消失、选区清空

只有一个入口：**选中文本**。整条回复的「引用」按钮已按学生要求移除。

## 它不是什么

- ❌ 不是新版自带的 `@` 引用（那个引用**文件/目录/会话**，是另一个功能）。
- ❌ 不做朗读 / TTS。
- ❌ 不绑定键盘快捷键、不监听键盘组合键、不改任何内置 UI。

## 为什么不冲突（设计约束）

| 风险 | 做法 |
| --- | --- |
| 抢输入框 | 只调官方 `InputActions.captureInsertion()` / `insertText(text, span)`（一次可撤销的纯文本编辑）；不直接改 DOM、不模拟键盘 |
| 被输入框裁剪/遮挡 | 注册在 `conversation.input.dock`（会话级插槽），但 **portal 到 `<body>`** 绝对定位 |
| 抢文本选择 | 按按钮时 `mousedown` 只 `preventDefault()` 保住选区，不拦事件、不改别人的 DOM |
| 误弹 | 只在「选区祖先在对话行 `[data-chat-flow-key]` 内、且不在 `textarea/input/contenteditable` 里」时出现；滚动 / 改窗口大小 / Esc 立刻收起 |
| 样式 | 只用内联样式 + 主题 token（`--dsw-alias-*`），不注入全局 CSS |
| 命名 | 插槽 id `quote-reply-selection`、DOM id 与 class 带 `dshqr-` 前缀 |

## 文件

- `index.js` — 宿主半：空 `apply()`（功能全在浏览器半；bundle 行需要它存在）
- `client.js` — 浏览器半：选区监测 + 药丸 + 复制 + 引用插入
- `cordis.patch.yml` — bundle patch（一行 insert，行 id `quote-reply`）
- `package.json` — `dsh.bundle.patch` + `dsh.client`

## 安装 / 卸载

```powershell
# 装（需要临时放宽 pnpm 供应链策略：pnpm-workspace.yaml 末尾加 minimumReleaseAge: 0，装完还原）
plugin_manager → install_bundle → target: C:\Users\24552\Documents\deepseek-harness\default-workspace\ui-tweaks\quote-reply
# 卸
plugin_manager → remove_bundle → target: @local/dsh-quote-reply
```

**改完 `client.js` 只需刷新页面（F5）**，不用重装、不用重启。

## 验收

```powershell
# 刷新后：
# 1) 选中任意一条消息里的文字 → 上方出现「复制 / 引用」药丸
# 2) 点复制 → 剪贴板拿到选中文本（按钮变「已复制」）
# 3) 点引用 → 输入框出现 "> …"，药丸消失
# 4) 在输入框里选文字 → 不弹药丸；滚动 → 药丸消失
# 5) 助手回复底部只有 shipped 的 feedback / 删除，没有多余的「引用」
```
