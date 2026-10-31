# image-lightbox-close —— 把「关图片」的 × 挪出窗口关闭键那个角

## 它解决什么

图片浮层（点消息里的图放大后的那个）的关闭按钮，官方位置是**视口右上角**
（`position: fixed; top: 20px; right: 20px; 36×36`），正好落在 Windows 窗口标题栏
那排「最小化 / 最大化 / 关闭」的正下方 —— 两个 × 上下只差几十像素，手一歪点到
窗口关闭键，整个 DSH 就退了。

这个插件把关闭键挪到**视口左上角**，两者相隔一整屏宽度，误触不可能发生。

## 证据（不是猜的）

| 事实 | 出处 / 原始值 |
| --- | --- |
| 浮层结构与按钮位置 | `dsh-web-frontend\dist\assets\index-5SrrfWpU.js` 里能读到这段 JSX：`createPortal(<div className=backdrop role="dialog" aria-modal="true">[mask, img, button])` |
| 构建后的类名 | `_backdrop_1hos8_1` / `_mask_1hos8_11` / `_image_1hos8_18` / **`_close_1hos8_29`** |
| 原规则原文 | `._close_1hos8_29{position:fixed;top:20px;right:20px;z-index:1;...width:36px;height:36px;border-radius:999px;...}` |

## 改了什么

- 位置：`top: 24px; left: 24px; right: auto`（左上角）
- 尺寸：36px → **40px**（更好按）
- 悬停：放大 6% + 投影，明确区分于系统窗口按钮
- 选择器（两条都要求浮层直接子级里有 `<img>`，避免误伤快捷键弹窗等其它模态）：
  ```css
  body > div[role="dialog"][aria-modal="true"]:has(> div[aria-hidden="true"] + img) > button,
  body > div[role="dialog"][aria-modal="true"]:has(> img) > button[class*="_close_"]
  ```

## 想改回右上角

`client.js` 顶部旋钮：

```js
const CORNER = 'left';   // 改成 'right' 就回到右上角
const RIGHT_MODE_TOP = '72px'; // 选 right 时的上边距：从标题栏下面再让一截
const OFFSET = '24px';   // 距边距离
const SIZE = '40px';     // 按钮直径
```

改完执行一次「禁用 → 启用」即可热重载（不必 pnpm 重装）：

```powershell
# 用 plugin_manager 工具：set_plugin include:image-lightbox-close enabled=false，再 enabled=true
```

## 安装 / 卸载

- 安装：`plugin_manager install_bundle` → `C:\Users\24552\Documents\deepseek-harness\default-workspace\ui-tweaks\image-lightbox-close`
  （安装前若报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，照 `study-energy-bar\README.md` 里记的临时
  `minimumReleaseAge: 0` 绕法，装完**立刻还原** `pnpm-workspace.yaml`）
- 停用：`set_plugin include:image-lightbox-close enabled=false`
- 卸载：`remove_bundle @local/dsh-image-lightbox-close`

## 边界

- 导师没有 DOM / 截图通道 ⇒ 位置到底顺不顺眼，只能你刷新页面后自己看。
- 纯样式修正：不接管点击、不改浮层逻辑；`Esc`、点遮罩关闭等原生行为一个都没动。
