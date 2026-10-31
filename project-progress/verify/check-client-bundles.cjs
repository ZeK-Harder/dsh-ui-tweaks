// 客户端产物护栏：改完 client.js 必跑。
//
// 三条硬约束（都踩过，见 README §6）：
//   1. 文件要能通过语法检查（没有构建步骤，写坏就是浏览器静默不加载）。
//   2. `window.__ModuleLoader__.load({ id })` 的 id 必须等于 package.json 的 name，
//      否则报 "loaded without registering ..."。
//   3. 顶层零声明：除 `window.__ModuleLoader__.load(...)` 调用外不在全局留东西。
//
// 跑：node verify/check-client-bundles.cjs
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const clientFile = join(root, 'client.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const source = readFileSync(clientFile, 'utf8')

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

// 1) 语法
try {
  execFileSync(process.execPath, ['--check', clientFile], { stdio: 'pipe' })
  check('client.js 语法通过 node --check', true)
} catch (error) {
  check('client.js 语法通过 node --check', false, String(error.stderr || error.message).trim().split('\n').slice(0, 3).join(' | '))
}

// 2) __ModuleLoader__ 的 id 与包名一致
const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(source)
check('__ModuleLoader__.load 存在', !!idMatch)
check('loader id 等于 package.json name', !!idMatch && idMatch[1] === pkg.name,
  idMatch ? `${idMatch[1]} vs ${pkg.name}` : '')

// 3) 顶层零声明
const loaderAt = source.indexOf('window.__ModuleLoader__.load')
const prefix = source.slice(0, loaderAt < 0 ? source.length : loaderAt)
const stripped = prefix.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const leak = stripped.split(/\r?\n/).find((line) => /^\s*(?:const|let|var|function|class|import|export)\b/.test(line))
check('顶层没有任何声明', !leak, leak ? leak.trim().slice(0, 60) : '')

// 4) 客户端方式注册的座位（防止有人改成别的注入方式）
check('用 ctx.slots.inject / register 注册座位',
  /ctx\.slots\.inject\(/.test(source) && /ctx\.slots\.register\(/.test(source))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
