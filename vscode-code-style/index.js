/**
 * 宿主半：不做任何事。
 *
 * 这一行存在的唯一理由，是让 bundle 被 Loader 认领，从而把同一包的
 * `./client` 半边交给浏览器加载（见 package.json 的 dsh.client）。
 */
export function apply() {}
