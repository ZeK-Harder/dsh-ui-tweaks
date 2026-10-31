# ui-tweaks / vscode-code-style —— 把 DSH 的代码字体改成 VS Code 风格

> 包名 `@local/dsh-ui-vscode-code`，Loader 行 id `ui-vscode-code`。
> 只做一件事：**注入一张样式表**，覆盖 DSH 里写死的「代码字体族 / 代码字号 / 代码行高」。

## 1. 为什么需要它（不是我的臆测，是产品写死的）

设置 → 通用 只有两行：配色方案 + **字号大小**（10–22px）。那根滑杆只改
`--dsh-content-font-size`（写在 `<body>` 的行内样式上），而代码用的是**另一套钉死的 token**：

`@deepseek-ai/dsh-client-ui-theme` 的样式表原文（`lib/client.js` 内联）：

```
--dsw-font-markdown-code:12px/19px var(--ds-font-family-code)
--dsw-font-markdown-code-block:11px/19px var(--ds-font-family-code)
--dsw-font-markdown-code-block-small:11px/16px var(--ds-font-family-code)
--ds-font-family-code:"SF Mono", "JetBrains Mono", "Fira Code", Consolas, ...
```

同包 `README.zh.md:32` 原话：**「小号文本和代码保持固定字号」** —— 这是刻意设计，不是 bug。
于是你把正文字号拉到 22px 时，正文 22px、代码块仍 11px，反差就是这么来的。

`ctx.theme` 只能注册**颜色别名**覆盖（Theme inspect provider 只列颜色 token），
所以没有"第三方主题"这条路；唯一办法就是客户端插件注入 CSS。

## 2. 它改了什么

| 位置 | 原值 | 现在 |
| --- | --- | --- |
| `--ds-font-family-code`、`--dsw-font-mono`（文件预览） | SF Mono / JetBrains Mono … | `MONO_STACK`（Windows 上首取 **Cascadia Code → Consolas**，即 VS Code 观感） |
| 行内代码 `--dsw-font-markdown-code-*` | 12px / 19px | 正文 + `CODE_DELTA`、行高 1.5 |
| 代码块 `--dsw-font-markdown-code-block-*` | 11px / 19px | 同上 |
| 工具输出/终端 `--dsw-font-markdown-code-block-small-*` | 11px / 16px | 正文 + `SMALL_DELTA`、行高 1.5 |

- 字号写成 `max(下限, calc(var(--dsh-content-font-size,14px) + 偏移))`：**跟着设置里的字号滑杆走**，不再钉死。
- 全部声明带 `!important`，并在 `html body` 上（比主题的 `body` 选择器更具体）→ 覆盖稳定。
- 样式通过 `ctx.effect()` 注册，插件被卸载时 `<style>` 会一起摘掉，不留脏。

## 3. 旋钮（改 `client.js` 顶部常量，不用懂 CSS）

```js
const MONO_STACK   = '"Cascadia Code", "Cascadia Mono", Consolas, ...'; // 想换字体改这里
const CODE_DELTA   = '-1px';   // 代码字号 = 正文字号 + 这个值
const SMALL_DELTA  = '-2px';   // 工具输出那档
const MIN_SIZE     = '13px';   // 字号下限（正文调小时代码不至于糊）
const MIN_SMALL_SIZE = '12px';
const LINE_HEIGHT  = '1.5';    // VS Code 默认
```

想要「代码固定在某个 px，不跟正文缩放」→ 把 `--dsh-vscode-code-size` 的定义从
`max(...calc(var(--dsh-content-font-size)...))` 改成字面量，如 `15px`。

## 4. 安装 / 重装 / 卸载

```powershell
# 安装（或改完 client.js 后重装，同样一条命令）
#   target = 本目录的绝对路径
plugin_manager install_bundle target="C:\Users\24552\Documents\deepseek-harness\default-workspace\ui-tweaks\vscode-code-style"
```

成功后落盘为：

- `~/.dsh/profiles/desktop/package.json` → `dependencies["@local/dsh-ui-vscode-code"] = "link:<本目录>"`，
  且 `dsh.profile.bundles` 末尾追加 `@local/dsh-ui-vscode-code`。
- Loader 行 `include:ui-vscode-code` → `enabled: true`、`fiberPhase: active`。

验证（任一条）：

```powershell
plugin_manager list_plugins offset=180 limit=20   # 找 include:ui-vscode-code → active
```

卸载：从 `dsh.profile.bundles` 去掉 `@local/dsh-ui-vscode-code`，或在该 bundle 的
插件管理页把行开关关掉（会把 `disabled` 覆盖写进 profile patch）。

## 5. 必须刷新页面

客户端半边是在**页面加载时**取进 boot manifest 的。装完 / 改完必须
**Ctrl+R 刷新一个标签页**（除非同时跑着 `pnpm run dev:web`，那样客户端插件免刷新）。

刷新后没变化时先看浏览器 Console 有没有 `@local/dsh-ui-vscode-code` 相关报错。

## 6. 坑

- **pnpm 供应链策略会挡安装**：pnpm 11.7 的 lockfile **复验**路径不读 `minimumReleaseAgeExclude`，
  于是 24h 内的新包（如 `billion-context@0.1.192`）会让整次 install 失败
  （`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，`application: failed`）。
  临时解法：在 `~/.dsh/profiles/desktop/pnpm-workspace.yaml` 里加 `minimumReleaseAge: 0` →
  装完**立刻删掉**（不要长期放宽）。或者等那个包满 24h 后自动放行。
- **视觉验证导师做不了**：工具层没有浏览器控制，只能验证「Loader 行 active」这一层；
  最终观感必须你自己刷新页面看。别把"我实测过"用在看效果上。
- 字体栈里没装的字体名会被跳过（浏览器自动回退到下一个），不必删没装的字体。
