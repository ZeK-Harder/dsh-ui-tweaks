/**
 * 浏览器半：只注入一张样式表，把「关掉图片」的 × 从右上角挪到左上角。
 *
 * 为什么需要它：图片浮层（ImageLightbox，实现在 @deepseek-ai/dsh-client-ui-primitives）
 * 的关闭按钮是 `position: fixed; top: 20px; right: 20px; 36×36` —— 正好落在 Windows
 * 窗口标题栏那排「最小化 / 最大化 / 关闭」的正下方、同一个右上角里。两个 × 上下相距
 * 只有几十像素，手一歪点到窗口关闭键，整个 DSH 就退了。
 * 挪到左上角后，两者相隔一整屏宽度，误触不可能发生。
 *
 * 选择器为什么写成这样（下面是实查到的证据，不是猜的）：
 *   1. 浮层由 createPortal 直挂 <body>：`<div role="dialog" aria-modal="true">`
 *      里依次是 遮罩 div[aria-hidden] + <img> + <button>`；构建产物
 *      `dsh-web-frontend\dist\assets\index-5SrrfWpU.js` 里能读到这段 JSX
 *      和 CSS-module 映射，按钮类名 = `._close_1hos8_29`，原规则 =
 *      `position:fixed;top:20px;right:20px;width:36px;height:36px`。
 *   2. 因此用「结构式选择器」为主，再加一条 `[class*="_close_"]` 兜底；
 *      两条都要求浮层直接子级里有 <img>，这样别的模态框（比如快捷键弹窗）
 *      不会被误伤。
 *
 * ⚠️ 纪律（2026-10-11 因为这条踩过一次，代价是 DSH 起不来）：
 *   DSH 把**所有插件的 client.js 拼成一个 combo 脚本**一次性加载，所以顶层
 *   （factory 外面）**不许声明任何 const / let / class / function** —— 两个插件
 *   各写一个顶层 `const CSS` 就是 `Identifier 'CSS' has already been declared`，
 *   整个 combo 语法错误 → web boot 失败。所有常量一律写在 factory() 里面。
 *   改完先跑 `node verify\check-client-bundles.cjs` 自查（它会真拼一遍再解析）。
 *
 * 改完要刷新页面（客户端半边在页面加载时取）。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-image-lightbox-close',
  factory() {
    // ── 可调旋钮 ─────────────────────────────────────────────────────
    const CORNER = 'left'; // 'left' = 左上角（默认，离窗口关闭键最远）；'right' = 回右上角
    const OFFSET = '24px'; // 距上边 / 侧边的距离
    const RIGHT_MODE_TOP = '72px'; // 选 'right' 时用这个上边距：从标题栏下面再让一截
    const SIZE = '40px'; // 按钮直径（官方是 36px，略放大一点更好按）
    // ─────────────────────────────────────────────────────────────────

    const POSITION =
      CORNER === 'left'
        ? `top: ${OFFSET} !important;\n  left: ${OFFSET} !important;\n  right: auto !important;`
        : `top: ${RIGHT_MODE_TOP} !important;\n  right: ${OFFSET} !important;\n  left: auto !important;`;

    // 两个选择器都指向「浮层里的那个关闭按钮」，且都要求浮层直接子级里有 <img>：
    //   1. 结构式：遮罩 div + 图片 + 按钮，是最精确的写法；
    //   2. 兜底：类名里含 _close_ 且浮层里有 <img>。
    const TARGET =
      'body > div[role="dialog"][aria-modal="true"]:has(> div[aria-hidden="true"] + img) > button,\n' +
      'body > div[role="dialog"][aria-modal="true"]:has(> img) > button[class*="_close_"]';

    const CSS = `
${TARGET} {
  ${POSITION}
  width: ${SIZE} !important;
  height: ${SIZE} !important;
  transition: transform .12s ease, box-shadow .12s ease;
}

${TARGET}:hover {
  transform: scale(1.06);
  box-shadow: 0 4px 16px rgb(0 0 0 / 24%);
}
`;

    return {
      apply(ctx) {
        // 注册式资源：卸载/重载时这张 <style> 会被一起摘掉，不会留脏。
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-image-lightbox-close';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        });
      },
    };
  },
});
