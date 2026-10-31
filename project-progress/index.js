// @local/dsh-project-progress - host half.
//
// One job: turn `项目进度.md` (a hand-editable two-level checklist) into JSON for
// the browser half. `GET /project-progress/stats` is the only endpoint.
//
// The file is the single source of truth. The mentor window and the student edit
// it by hand; this half re-reads it on every request (a few KB) instead of
// caching, so a tick in the file reaches the bar within one poll.
//
// Which file? Resolved per request (2026-10-31: the study workspace moved, and a
// hard-coded path cannot follow a workspace):
//   1. `?file=<absolute path>` on the route - an explicit override, and the way
//      the live check below proves resolution without touching settings.
//   2. `DSH_PROJECT_PROGRESS_FILE` in the environment.
//   3. A registered workspace whose root holds `项目进度.md`, newest file first.
//      This is the normal case: the checklist sits next to PROGRESS.md in
//      whichever workspace the student is working in.
//   4. The legacy location `<plugin>/../../项目进度.md` as a last resort. It is
//      deliberately excluded from the scan in step 3 so a leftover compatibility
//      copy can never shadow the real workspace.
//
// Format (documented in the file itself):
//   `# title`        project name
//   `## title`       big step
//   `- [ ]` / `- [x]`  sub-step
//   `- [~]`          sub-step consciously deferred (still counts in the total, but
//                    no longer holds "current position" back - see `current` below)
// Everything else is ignored, fenced code blocks included.
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = '@local/dsh-project-progress'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
// ../../ from ui-tweaks/project-progress/ = the workspace root the plugin was
// first written against. Kept only as a fallback; see resolveChecklist below.
const LEGACY_FILE = join(PLUGIN_DIR, '..', '..', '项目进度.md')
const LEGACY_KEY = resolve(LEGACY_FILE).toLowerCase()
const CHECKLIST_NAME = '项目进度.md'
const ROUTE_PREFIX = '/project-progress'

const TITLE_RE = /^#\s+(.+?)\s*$/
const STEP_RE = /^##\s+(.+?)\s*$/
const ITEM_RE = /^\s*[-*+]\s+\[([ xX~])\]\s+(.+?)\s*$/
const FENCE_RE = /^\s*(?:```|~~~)/

function isLegacyPath(file) {
  return resolve(file).toLowerCase() === LEGACY_KEY
}

function clean(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

// --- parsing -----------------------------------------------------------------

function parseProgress(text) {
  const warnings = []
  const steps = []
  let title = ''
  let current = null
  let inFence = false

  for (const line of String(text).split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const item = ITEM_RE.exec(line)
    if (item) {
      if (!current) {
        current = { title: '（未分组）', items: [] }
        steps.push(current)
        warnings.push('有「- [ ]」小步不在任何「## 」大步骤下，已归入「（未分组）」')
      }
      current.items.push({
        text: clean(item[2]),
        done: item[1].toLowerCase() === 'x',
        deferred: item[1] === '~',
      })
      continue
    }

    const step = STEP_RE.exec(line)
    if (step) {
      current = { title: clean(step[1]), items: [] }
      steps.push(current)
      continue
    }

    const heading = TITLE_RE.exec(line)
    if (heading && !title) title = clean(heading[1])
  }

  const shaped = steps.map((step) => {
    const total = step.items.length
    const done = step.items.filter((entry) => entry.done).length
    const deferred = step.items.filter((entry) => entry.deferred).length
    return {
      title: step.title,
      done,
      deferred,
      total,
      pct: total ? Math.round((done / total) * 100) : 0,
      items: step.items,
    }
  })

  const total = shaped.reduce((sum, step) => sum + step.total, 0)
  const done = shaped.reduce((sum, step) => sum + step.done, 0)
  const deferred = shaped.reduce((sum, step) => sum + step.deferred, 0)
  // "Current position" = the first big step that still has open work. A step whose
  // open items were all marked deferred is settled for navigation purposes (the
  // debt is still counted in `total` and surfaced by the tooltip), so it no longer
  // holds the bar back.
  const index = shaped.findIndex((step) => step.total > 0 && step.done + step.deferred < step.total)
  const currentStep = index >= 0
    ? {
        index,
        title: shaped[index].title,
        done: shaped[index].done,
        deferred: shaped[index].deferred,
        total: shaped[index].total,
      }
    : null

  if (!total) warnings.push('没有解析到任何「- [ ]」小步，进度条会显示 0/0')
  if (deferred && !currentStep) warnings.push(`全部剩余小步（${deferred} 条）都标成了「延后」，没有「当前位置」可指`)

  return {
    title,
    stats: { done, deferred, total, pct: total ? Math.round((done / total) * 100) : 0 },
    current: currentStep,
    steps: shaped,
    warnings,
  }
}

// --- which file --------------------------------------------------------------

function overrideFile(req) {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const value = url.searchParams.get('file')
    if (value && isAbsolute(value)) return value
  } catch (error) {
    // A malformed request URL just means "no override"; the default chain below
    // still answers.
  }
  return null
}

async function checklistMtime(file) {
  try {
    return (await stat(file)).mtimeMs
  } catch (error) {
    return null
  }
}

async function resolveChecklist(ctx, req) {
  const override = overrideFile(req)
  if (override) return override

  const fromEnv = process.env.DSH_PROJECT_PROGRESS_FILE
  if (fromEnv) return fromEnv

  // Registered workspaces only, newest checklist wins. The legacy path is skipped
  // on purpose so a stale compatibility copy cannot shadow the live workspace.
  let registry
  try {
    registry = ctx.get('workspaceRegistry')
  } catch (error) {
    registry = undefined
  }
  const workspaces = registry && typeof registry.list === 'function' ? registry.list() : []
  let best = null
  for (const workspace of workspaces) {
    const root = workspace && workspace.path
    if (!root || !isAbsolute(root)) continue
    const file = join(root, CHECKLIST_NAME)
    if (isLegacyPath(file)) continue
    const mtime = await checklistMtime(file)
    if (mtime === null) continue
    if (!best || mtime > best.mtime) best = { file, mtime }
  }
  return best ? best.file : LEGACY_FILE
}

// --- route -------------------------------------------------------------------

function isLoopback(req) {
  const address = (req.socket && req.socket.remoteAddress) || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function buildPayload(file) {
  try {
    const info = await stat(file)
    const parsed = parseProgress(await readFile(file, 'utf8'))
    return { ok: true, file, mtime: info.mtimeMs, ...parsed }
  } catch (error) {
    const code = error && error.code
    return {
      ok: false,
      file,
      error: code === 'ENOENT'
        ? '进度文件不存在'
        : `读取失败：${String((error && error.message) || error)}`,
    }
  }
}

function registerRoute(webServer, ctx) {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/stats`,
    handler: async (req, res) => {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, error: 'loopback only' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET only' })
        return
      }
      try {
        sendJson(res, 200, await buildPayload(await resolveChecklist(ctx, req)))
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }))
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer) {
    registerRoute(webServer, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerRoute(sub.webServer, sub))
  }
}

// Named test hooks for `verify/check-project-progress-host.cjs`. They are inert:
// the loader only consumes `name` / `apply` / `Config`, and nothing here mutates
// process state.
export const __check = { parseProgress, resolveChecklist, LEGACY_FILE, isLegacyPath }
