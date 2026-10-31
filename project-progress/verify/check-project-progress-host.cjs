// 宿主半功能自检：假 Cordis ctx + 真 HTTP-ish req/res，把 index.js 真跑一遍。
//
// 覆盖：
//   - 路由注册 / 200 / 403（非 loopback）/ 405（POST）
//   - 清单格式解析（标题、大步骤、小步、当前位置）
//   - 路径解析顺序：?file= 覆盖 → 环境变量 → 注册工作区扫描 → legacy 兜底
//   - 缺文件时 ok:false 不崩
//   - 学习工作区的真清单冒烟（存在才跑）
//
// 跑：node verify/check-project-progress-host.cjs
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const STUDY_WORKSPACE = 'C:\\Users\\24552\\Documents\\机器人应用层学习'

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

// --- 夹具：一个带两层清单的工作区 --------------------------------------------
const fixture = mkdtempSync(join(tmpdir(), 'project-progress-'))
const fixtureRoot = join(fixture, '工作区A')
mkdirSync(fixtureRoot)
const fixtureFile = join(fixtureRoot, '项目进度.md')
writeFileSync(fixtureFile, [
  '# 夹具项目 · 解析测试',
  '',
  '## 第一段',
  '- [x] 已做',
  '- [ ] 没做',
  '',
  '## 第二段',
  '- [ ] 也没做',
  '',
].join('\n'), 'utf8')

// --- 假 ctx / 假 webServer ----------------------------------------------------
const routes = []
let workspaces = [{ id: 'a', path: fixtureRoot }]

function fakeCtx() {
  return {
    effect: (fn) => { fn() },
    get: (name) => {
      if (name === 'webServer') {
        return { register: (route) => { routes.push(route); return () => {} } }
      }
      if (name === 'workspaceRegistry') return { list: () => workspaces }
      return undefined
    },
  }
}

function call(route, { url = '/project-progress/stats', method = 'GET', remoteAddress = '127.0.0.1' } = {}) {
  return new Promise((resolveOuter) => {
    const res = {
      status: 0,
      headers: null,
      body: '',
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(chunk) {
        this.body = String(chunk)
        let json
        try { json = JSON.parse(this.body) } catch (error) { json = { unparsable: this.body } }
        resolveOuter({ status: this.status, headers: this.headers, json })
      },
    }
    Promise.resolve(route.handler({ url, method, socket: { remoteAddress } }, res))
      .catch((error) => resolveOuter({ status: 0, json: { thrown: String(error) } }))
  })
}

;(async () => {
  delete process.env.DSH_PROJECT_PROGRESS_FILE
  const mod = await import(pathToFileURL(join(__dirname, '..', 'index.js')).href)
  check('legacy 路径靠纯函数判定（不参与工作区扫描）',
    mod.__check.isLegacyPath(mod.__check.LEGACY_FILE), mod.__check.LEGACY_FILE)
  check('学习工作区的清单不算 legacy',
    !mod.__check.isLegacyPath(join(STUDY_WORKSPACE, '项目进度.md')))
  const ctx = fakeCtx()
  mod.apply(ctx)

  check('注册了唯一路由 /project-progress/stats',
    routes.length === 1 && routes[0].path === '/project-progress/stats',
    `routes=${routes.length}`)

  const route = routes[0]

  const ok = await call(route)
  check('GET → 200 + ok:true + no-store',
    ok.status === 200 && ok.json.ok === true && ok.headers['cache-control'] === 'no-store',
    `status=${ok.status}`)
  check('解析项目名', ok.json.title === '夹具项目 · 解析测试', ok.json.title)
  check('小步计数 done/total', ok.json.stats.done === 1 && ok.json.stats.total === 3,
    `${ok.json.stats.done}/${ok.json.stats.total}`)
  check('当前位置 = 第一个还有未完成小步的大步骤',
    ok.json.current && ok.json.current.index === 0 && ok.json.current.title === '第一段',
    JSON.stringify(ok.json.current))
  check('文件来自注册工作区扫描', ok.json.file === fixtureFile, ok.json.file)
  check('大步骤数 = 2', ok.json.steps.length === 2, String(ok.json.steps.length))

  const explicit = await call(route, {
    url: '/project-progress/stats?file=' + encodeURIComponent(join(fixtureRoot, '项目进度.md')),
  })
  check('?file= 绝对路径覆盖生效', explicit.json.ok === true && explicit.json.title === '夹具项目 · 解析测试')

  const relative = await call(route, { url: '/project-progress/stats?file=relative.md' })
  check('?file= 非绝对路径被忽略（仍走扫描）', relative.json.file === fixtureFile, relative.json.file)

  const explicitMissing = await call(route, {
    url: '/project-progress/stats?file=' + encodeURIComponent(join(fixture, 'nope', '项目进度.md')),
  })
  check('?file= 指向不存在的文件 → ok:false 且 file 原样',
    explicitMissing.json.ok === false && String(explicitMissing.json.file).includes('nope'),
    explicitMissing.json.file)

  const post = await call(route, { method: 'POST' })
  check('POST → 405', post.status === 405, String(post.status))

  const remote = await call(route, { remoteAddress: '10.0.0.9' })
  check('非 loopback → 403', remote.status === 403, String(remote.status))

  // 学习工作区的真清单冒烟
  workspaces = [{ id: 'study', path: STUDY_WORKSPACE }]
  const smoke = await call(route)
  if (smoke.json.ok) {
    check('学习工作区清单可解析', smoke.json.stats.total > 0 && !!smoke.json.current,
      `${smoke.json.title} ${smoke.json.stats.done}/${smoke.json.stats.total} · 当前位置：${smoke.json.current && smoke.json.current.title}`)
    check('下一位置指向 MVP-0', !!smoke.json.current && /MVP-0/.test(smoke.json.current.title),
      smoke.json.current && smoke.json.current.title)
  } else {
    console.log(`SKIP  学习工作区清单还没建：${smoke.json.error}`)
  }

  // 缺文件：不能崩，要给 ok:false
  workspaces = [{ id: 'empty', path: join(fixture, '不存在') }]
  const missing = await call(route)
  check('缺文件 → 200 + ok:false 不崩', missing.status === 200 && missing.json.ok === false,
    JSON.stringify(missing.json).slice(0, 90))

  console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
  process.exit(failures ? 1 : 0)
})()
