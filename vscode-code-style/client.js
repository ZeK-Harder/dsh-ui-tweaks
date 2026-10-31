/**
 * 浏览器半：只注入一张样式表，把 DSH 里「写死的代码字体」改成 VS Code 风格。
 *
 * 为什么需要它：`@deepseek-ai/dsh-client-ui-theme` 在 `gradient-shadow-text.css`
 * 里把代码字号钉死在 11px/12px（README 原话：“小号文本和代码保持固定字号”），
 * 设置页的「字号大小」只动 `--dsh-content-font-size`，所以正文能放大、代码不动。
 * 这里用同名 CSS 变量把它们改成「等宽字体栈 + 随正文字号缩放 + 1.5 行高」。
 *
 * ⚠️ 纪律（2026-10-11 踩过一次，代价是 DSH 起不来）：
 *   DSH 把**所有插件的 client.js 拼成一个 combo 脚本**一次性加载，所以顶层
 *   （factory 外面）**不许声明任何 const / let / class / function** —— 两个插件
 *   各写一个顶层 `const CSS` 就会 `Identifier 'CSS' has already been declared`，
 *   整个 combo 语法错误 → web boot 失败。所有常量一律写在 factory() 里面。
 *   改完先跑 `node verify\check-client-bundles.cjs` 自查（它会真拼一遍再解析）。
 *
 * 改动后：install_bundle 重装 → 刷新页面（客户端半边在页面加载时取）。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-ui-vscode-code',
  factory() {
    // ── 可调旋钮（改这里，不用懂下面的 CSS）──────────────────────────
    // 等宽字体栈：从左往右取第一个装了的字体。VS Code 在 Windows 上默认
    // Consolas / Cascadia Code，所以这个顺序基本等同 VS Code。
    const MONO_STACK =
      '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", "JetBrains Mono", "Fira Code", "Liberation Mono", Menlo, monospace';
    const CODE_DELTA = '-1px'; // 代码字号 = 正文字号 + 这个值（负数=比正文小）
    const SMALL_DELTA = '-2px'; // 工具输出/终端那种“小号代码块”
    const MIN_SIZE = '13px'; // 字号下限，别让正文调小时代码糊掉
    const MIN_SMALL_SIZE = '12px';
    const LINE_HEIGHT = '1.5'; // VS Code 默认 1.5
    // ─────────────────────────────────────────────────────────────────

    const CSS = `
:root {
  --dsh-vscode-mono: ${MONO_STACK};
  /* 代码族字体族：DSH 的 monospace 权威变量 */
  --ds-font-family-code: var(--dsh-vscode-mono) !important;
  /* 文件预览用的是 --dsw-font-mono（原本没定义，靠 ui-monospace 兜底） */
  --dsw-font-mono: var(--dsh-vscode-mono) !important;
}

html body {
  --dsh-vscode-code-size: max(${MIN_SIZE}, calc(var(--dsh-content-font-size, 14px) + (${CODE_DELTA})));
  --dsh-vscode-code-small-size: max(${MIN_SMALL_SIZE}, calc(var(--dsh-content-font-size, 14px) + (${SMALL_DELTA})));
  --dsh-vscode-code-line: ${LINE_HEIGHT};

  /* 行内代码 */
  --dsw-font-markdown-code: var(--dsh-vscode-code-size)/var(--dsh-vscode-code-line) var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-font-family: var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-font-size: var(--dsh-vscode-code-size) !important;
  --dsw-font-markdown-code-line-height: var(--dsh-vscode-code-line) !important;
  --dsw-font-markdown-code-font-weight: 400 !important;
  --dsw-font-markdown-code-font-style: normal !important;

  /* 代码块 */
  --dsw-font-markdown-code-block: var(--dsh-vscode-code-size)/var(--dsh-vscode-code-line) var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-block-font-family: var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-block-font-size: var(--dsh-vscode-code-size) !important;
  --dsw-font-markdown-code-block-line-height: var(--dsh-vscode-code-line) !important;
  --dsw-font-markdown-code-block-font-weight: 400 !important;
  --dsw-font-markdown-code-block-font-style: normal !important;

  /* 工具输出 / 终端面板（原来的 11px/16px 那档） */
  --dsw-font-markdown-code-block-small: var(--dsh-vscode-code-small-size)/var(--dsh-vscode-code-line) var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-block-small-font-family: var(--dsh-vscode-mono) !important;
  --dsw-font-markdown-code-block-small-font-size: var(--dsh-vscode-code-small-size) !important;
  --dsw-font-markdown-code-block-small-line-height: var(--dsh-vscode-code-line) !important;
  --dsw-font-markdown-code-block-small-font-weight: 400 !important;
  --dsw-font-markdown-code-block-small-font-style: normal !important;
}
`;

    return {
      apply(ctx) {
        // 注册式资源：卸载/重载时这张 <style> 会被一起摘掉，不会留脏。
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-ui-vscode-code';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        });
      },
    };
  },
});
