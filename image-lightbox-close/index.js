/**
 * 宿主半：这一版不需要宿主做任何事（纯样式修正）。
 *
 * 但 bundle patch 插的那一行必须有个能 import 的模块，`apply` 存在即可。
 * 真正的改动在 client.js（浏览器半），由 package.json 的 `dsh.client` 声明。
 */
export function apply() {}
