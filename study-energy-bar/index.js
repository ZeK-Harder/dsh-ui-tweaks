// @local/dsh-study-energy-bar - host half.
//
// Two jobs, nothing else:
//
//   1. supervise the study-time sampler (`sampler.ps1`, a standalone PowerShell
//      process). The sampler owns the measurement (which window is in front,
//      how long the machine has been idle); this half only starts it, restarts
//      it if it dies, and stops it when the plugin unloads. No measurement
//      logic lives here.
//   2. serve `GET /study-energy/stats`, the single JSON endpoint the browser
//      half polls. "today / this week / last week" are DERIVED here from the
//      sampler's per-day ledger - the sampler never computes statistics.
//
// The ledger is a plain JSON file on disk (`~/.dsh/study-time/study.json`), so
// this half reads whatever is there instead of keeping a second copy in memory:
// the file is the one source of truth, and the sampler can also be run by hand
// without DSH at all.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = '@local/dsh-study-energy-bar'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const SAMPLER_PATH = join(PLUGIN_DIR, 'sampler.ps1')
// Same default as the sampler's own -OutFile, so a hand-started sampler and a
// DSH-started one write the same ledger (and the single-instance lock in the
// sampler keeps them from double-counting).
const DATA_FILE = process.env.DSH_STUDY_DATA || join(homedir(), '.dsh', 'study-time', 'study.json')
const ROUTE_PREFIX = '/study-energy'
const SAMPLE_INTERVAL_SEC = 5
const IDLE_LIMIT_SEC = 300
// The sampler rewrites the file every interval; anything older than this means
// no sampler is running (typically: another DSH instance still holds the lock,
// or the script failed to start).
const STALE_AFTER_MS = 60_000
// This machine has no `pwsh`; Windows PowerShell 5.1 is the only interpreter,
// and its execution policy is Restricted, hence -ExecutionPolicy Bypass.
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

// --- ledger ------------------------------------------------------------------

async function readLedger() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    if (!raw.trim()) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // Missing file (sampler never ran), unreadable file, or invalid JSON: the
    // route reports "no data yet" instead of failing.
    return null
  }
}

function dayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfDay(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

// Weeks start on Monday (the convention the study plan uses).
function startOfWeek(date) {
  const start = startOfDay(date)
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

function addDays(date, count) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + count)
  return copy
}

function sumRange(ledger, from, toExclusive) {
  const days = (ledger && ledger.days) || {}
  let dsh = 0
  let vscode = 0
  for (let cursor = new Date(from); cursor < toExclusive; cursor = addDays(cursor, 1)) {
    const entry = days[dayKey(cursor)]
    if (!entry) continue
    dsh += Number(entry.dsh) || 0
    vscode += Number(entry.vscode) || 0
  }
  return { dsh, vscode, total: dsh + vscode }
}

function ledgerAgeMs(ledger) {
  if (!ledger || typeof ledger.updated !== 'string') return null
  const stamp = Date.parse(ledger.updated)
  if (Number.isNaN(stamp)) return null
  return Date.now() - stamp
}

function buildStats(ledger) {
  const now = new Date()
  const todayStart = startOfDay(now)
  const tomorrow = addDays(todayStart, 1)
  const weekStart = startOfWeek(now)
  const lastWeekStart = addDays(weekStart, -7)

  const today = sumRange(ledger, todayStart, tomorrow)
  const week = sumRange(ledger, weekStart, tomorrow)
  const lastWeek = sumRange(ledger, lastWeekStart, weekStart)
  const age = ledgerAgeMs(ledger)

  const series = []
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(todayStart, -i)
    const bucket = sumRange(ledger, day, addDays(day, 1))
    series.push({ date: dayKey(day), total: bucket.total })
  }

  return {
    ok: true,
    now: now.toISOString(),
    config: { intervalSec: SAMPLE_INTERVAL_SEC, idleLimitSec: IDLE_LIMIT_SEC },
    today: { date: dayKey(todayStart), ...today },
    week: { start: dayKey(weekStart), ...week },
    lastWeek: { start: dayKey(lastWeekStart), ...lastWeek },
    // Positive = ahead of last week. `ratio` is null until the previous week
    // holds any data, which is what the bar needs to stay honest.
    deltaSec: week.total - lastWeek.total,
    ratio: lastWeek.total > 0 ? week.total / lastWeek.total : null,
    series,
    sampler: {
      live: age !== null && age < STALE_AFTER_MS,
      dataFile: DATA_FILE,
      lastUpdate: (ledger && ledger.updated) || null,
      ageSec: age === null ? null : Math.round(age / 1000),
      intervalSec: (ledger && ledger.intervalSec) || SAMPLE_INTERVAL_SEC,
      idleLimitSec: (ledger && ledger.idleLimitSec) || IDLE_LIMIT_SEC,
      tracked: (ledger && ledger.tracked) || [],
      last: (ledger && ledger.last) || null,
      days: Object.keys((ledger && ledger.days) || {}).length,
    },
  }
}

// --- sampler supervision -----------------------------------------------------

function spawnSampler() {
  const exe = existsSync(POWERSHELL) ? POWERSHELL : 'powershell.exe'
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', SAMPLER_PATH,
    '-ParentPid', String(process.pid),
    '-IntervalSec', String(SAMPLE_INTERVAL_SEC),
    '-IdleLimitSec', String(IDLE_LIMIT_SEC),
    '-OutFile', DATA_FILE,
  ]
  // stdio 'ignore': the sampler prints nothing unless -Verbose2 is passed, and
  // nothing here needs to capture its output.
  return spawn(exe, args, { stdio: 'ignore', windowsHide: true })
}

// One sampler per DSH process. The script also carries its own single-instance
// lock, so a second DSH instance cannot double-count: its sampler exits at once
// and the supervisor here stands down (the ledger is fresh, so someone is
// already measuring).
function superviseSampler(ctx) {
  ctx.effect(() => {
    if (!existsSync(SAMPLER_PATH)) {
      console.warn(`[study-energy] sampler missing: ${SAMPLER_PATH}`)
      return undefined
    }
    let stopped = false
    let child = null
    let timer = null
    let quickExits = 0

    const launch = () => {
      if (stopped) return
      const startedAt = Date.now()
      try {
        child = spawnSampler()
      } catch (error) {
        console.warn('[study-energy] sampler spawn failed:', String((error && error.message) || error))
        return
      }
      child.on('error', (error) => {
        console.warn('[study-energy] sampler error:', String((error && error.message) || error))
      })
      child.on('exit', (code) => {
        child = null
        if (stopped) return
        const livedMs = Date.now() - startedAt
        quickExits = livedMs < 2000 ? quickExits + 1 : 0
        const age = ledgerAgeMs(null) // placeholder, replaced below
        void age
        readLedger().then((ledger) => {
          if (stopped) return
          const fresh = ledgerAgeMs(ledger) !== null && ledgerAgeMs(ledger) < STALE_AFTER_MS
          if (quickExits >= 3 && fresh) {
            console.warn('[study-energy] another sampler is already running; standing down')
            return
          }
          const delay = quickExits >= 3 ? 60_000 : 30_000
          timer = setTimeout(launch, delay)
          if (timer.unref) timer.unref()
          console.warn(`[study-energy] sampler exited (code=${code}); retrying in ${delay / 1000}s`)
        }).catch(() => {})
      })
    }

    launch()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (child) {
        try {
          child.kill()
        } catch {
          // already gone
        }
      }
    }
  })
}

// --- route -------------------------------------------------------------------

function isLoopback(req) {
  const address = (req.socket && req.socket.remoteAddress) || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function registerRoute(webServer, fiber) {
  fiber.effect(() => webServer.register({
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
        sendJson(res, 200, buildStats(await readLedger()))
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }))
}

export function apply(ctx) {
  superviseSampler(ctx)
  const webServer = ctx.get('webServer')
  if (webServer) {
    registerRoute(webServer, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerRoute(sub.webServer, sub))
  }
}
