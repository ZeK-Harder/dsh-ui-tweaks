// @local/dsh-study-energy-bar - browser half.
//
// One drawn element: the study-time energy bar in the conversation header's
// leading seat (`conversation.header.leading`, kind "single", scope "root", no
// occupants - verified live through the Slots inspect provider before this was
// written). "single" means no id/order is accepted: the registration IS the
// seat's content.
//
// All data comes from the host half: GET /study-energy/stats. This half renders
// numbers it is handed and never measures anything itself - a browser cannot see
// which window is in front.
//
// The module is a classic client bundle (client-modules protocol). The id MUST
// equal package.json's name, otherwise the loader reports the bundle as loaded
// without a matching registration.
window.__ModuleLoader__.load({
  id: '@local/dsh-study-energy-bar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const ROUTE = '/study-energy/stats'
    // The sampler writes every 5s; 30s is often enough for a study clock and
    // keeps the poll invisible. A focus/visibility change refreshes at once.
    const REFRESH_MS = 30_000

    // Seconds -> "2h14m" / "45m". Sub-hour values stay in minutes on purpose:
    // "0h14m" reads worse than "14m" at 11px.
    function fmtDuration(seconds) {
      const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}m`
    }

    function fmtDelta(seconds) {
      const value = Number(seconds) || 0
      if (Math.abs(value) < 60) return '±0m'
      return (value > 0 ? '▲' : '▼') + fmtDuration(Math.abs(value))
    }

    function fmtClock(iso) {
      if (typeof iso !== 'string') return '未知'
      const stamp = Date.parse(iso)
      if (Number.isNaN(stamp)) return '未知'
      const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000))
      if (seconds < 60) return `${seconds} 秒前`
      if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`
      return `${Math.round(seconds / 3600)} 小时前`
    }

    function useStats() {
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let alive = true
        const load = () => {
          fetch(ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(async (res) => {
              const body = await res.json().catch(() => ({}))
              if (!alive) return
              if (res.ok && body && body.ok) setState({ status: 'ready', data: body })
              else setState({ status: 'error', message: (body && body.error) || `HTTP ${res.status}` })
            })
            .catch((error) => {
              // A failed poll must never break the header: keep the last good
              // numbers on screen and only flag the sampler as unreachable.
              if (!alive) return
              setState((previous) => (previous.status === 'ready'
                ? { ...previous, stale: true }
                : { status: 'error', message: String((error && error.message) || error) }))
            })
        }

        load()
        const timer = window.setInterval(load, REFRESH_MS)
        const onWake = () => {
          if (document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onWake)
        window.addEventListener('focus', onWake)
        return () => {
          alive = false
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onWake)
          window.removeEventListener('focus', onWake)
        }
      }, [])

      return state
    }

    const S = {
      wrap: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginRight: '10px',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        cursor: 'default',
      },
      track: {
        width: '56px',
        height: '6px',
        flex: '0 0 auto',
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        overflow: 'hidden',
      },
      text: { color: 'var(--dsw-alias-label-primary)' },
      dim: { color: 'var(--dsw-alias-label-secondary)' },
      dot: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '10px' },
    }

    function StudyEnergyBar() {
      const state = useStats()
      const data = state.status === 'ready' ? state.data : null

      if (!data) {
        // Loading or a failing route: draw nothing rather than a broken chip,
        // but still surface the reason in the tooltip when there is one.
        if (state.status !== 'error') return null
        return h('div', { style: S.wrap, title: `学习时间：无法读取统计（${state.message}）` },
          h('span', { style: S.dot }, '●'),
          h('span', null, '学习时间 --'))
      }

      const live = Boolean(data.sampler && data.sampler.live) && !state.stale
      const ratio = typeof data.ratio === 'number' ? data.ratio : null
      const fillPercent = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100
      const fillColor = ratio === null
        ? 'var(--dsw-alias-state-idle-primary)'
        : ratio >= 1
          ? 'var(--dsw-alias-state-success-primary)'
          : ratio >= 0.7
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-state-warn-primary)'

      const todayText = fmtDuration(data.today.total)
      const weekText = fmtDuration(data.week.total)
      const deltaText = ratio === null ? null : fmtDelta(data.deltaSec)

      const lines = [
        '学习时间（仅统计 DSH / VS Code 在前台且未空闲的时间）',
        `今日 ${todayText}（DSH ${fmtDuration(data.today.dsh)} · VS Code ${fmtDuration(data.today.vscode)}）`,
        `本周 ${weekText}（自 ${data.week.start}，DSH ${fmtDuration(data.week.dsh)} · VS Code ${fmtDuration(data.week.vscode)}）`,
        ratio === null
          ? '上周暂无数据，无法对比'
          : `上周 ${fmtDuration(data.lastWeek.total)}（自 ${data.lastWeek.start}） → 对比 ${deltaText}`,
        live
          ? `采样器运行中：每 ${data.config.intervalSec} 秒一次，空闲超过 ${Math.round(data.config.idleLimitSec / 60)} 分钟不计`
          : `⚠ 采样器未在运行（最后写入 ${fmtClock(data.sampler && data.sampler.lastUpdate)}）`,
        `数据文件：${(data.sampler && data.sampler.dataFile) || '未知'}`,
      ]

      return h('div', { style: S.wrap, title: lines.join('\n') },
        h('div', { style: S.track },
          h('div', {
            style: {
              width: `${fillPercent}%`,
              height: '100%',
              background: fillColor,
              transition: 'width 300ms ease, background 300ms ease',
            },
          })),
        h('span', { style: S.text }, `今日 ${todayText}`),
        h('span', { style: S.dim }, '·'),
        h('span', { style: S.text }, `本周 ${weekText}`),
        deltaText ? h('span', { style: deltaText.startsWith('▲') ? S.text : S.dim }, deltaText) : null,
        live ? null : h('span', { style: S.dot }, '●'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // `inject` waits for the declaration: registering into a slot that is
        // not declared yet throws, and the declaration can collapse and come
        // back (HMR, panel switch), in which case the callback runs again.
        ctx.slots.inject('conversation.header.leading', () => ctx.slots.register(
          { name: 'conversation.header.leading' },
          StudyEnergyBar,
        ))
      },
    }
  },
})
