// @local/dsh-project-progress - browser half.
//
// Two drawn elements, one data source (GET /project-progress/stats, served by
// the node half from `项目进度.md`):
//
//   1. `shell.overlay` - the frame-wide strip along the very top edge. The layer
//      is click-through by contract ("the layer itself is click-through -
//      entries opt back into pointer events", verified live through the Slots
//      inspect provider) and this entry never opts back in, so the strip cannot
//      eat a click anywhere in the app.
//   2. `conversation.session.header.utilities` - the right-aligned chip with the
//      percentage, the position ("第2/9步") and the sub-step count. Its full
//      two-level checklist opens in a OUR-OWN scrollable panel on hover/focus (2026-10-13: the native
//      `title` tooltip was replaced because the OS tooltip has no scrollbar and
//      got clipped at the window edge - the student could not read the tail of
//      the list). Shipped cells `open-in-app` (-10) and `session-log-download`
//      (0) sit to its left, so order 10 lands at the right end.
//
// Both seats share ONE poller: 5s while a seat is mounted, stopped again when
// the last one unmounts. A focus/visibility change refreshes at once.
//
// The id MUST equal package.json's name, otherwise the loader reports the
// bundle as loaded without a matching registration.
window.__ModuleLoader__.load({
  id: '@local/dsh-project-progress',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    // Optional: a portal escapes the header's stacking/clipping context. If the
    // seed module ever stops exporting it, the panel still renders inline.
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (ReactDOM && typeof ReactDOM.createPortal === 'function') createPortal = ReactDOM.createPortal
    } catch (error) {
      createPortal = null
    }

    const ROUTE = '/project-progress/stats'
    // The file is local and tiny; 5s means an edit in 项目进度.md shows up while
    // the student is still looking at the bar.
    const REFRESH_MS = 5_000
    const STRIP_SLOT = 'shell.overlay'
    const CHIP_SLOT = 'conversation.session.header.utilities'
    // A fresh id in each slot = an added cell beside the shipped ones, never a
    // shipped cell replaced.
    const STRIP_ID = 'project-progress'
    const CHIP_ID = 'project-progress-chip'
    // Leaving the chip/panel hides the panel only after this grace period, so the
    // mouse can travel into the panel (and its scrollbar) without it vanishing.
    const CLOSE_DELAY_MS = 180

    // Segment width policy for the top strip. Student reviewed both on
    // 2026-10-11 and chose 'weighted' ("宽度等于工作量吧，这个段内填充不错").
    //   'weighted' - width proportional to the step's sub-step count, so a heavy
    //                module owns a wider segment and a small one a narrow one.
    //   'equal'    - every big step owns the same width, so the strip reads as
    //                "which step am I in" rather than a workload map.
    const WIDTH_MODE = 'weighted'

    const TRACK = 'rgba(127,127,127,0.22)'
    const TRACK_CURRENT = 'rgba(127,127,127,0.42)'
    // In-progress fill. Deliberately NOT `var(--dsw-alias-brand-primary)`: that
    // token exists in this theme and resolves to a near-black - measured
    // rgb(32,34,38) by sampling the rendered strip on 2026-10-11 - so the
    // half-finished module read as a black bar instead of progress. The literal
    // is the blue the fallback always intended.
    const IN_PROGRESS = '#4d6bfe'
    const SUCCESS = 'var(--dsw-alias-state-success-primary, #17a34a)'
    const WARN = 'var(--dsw-alias-state-warn-primary, #d97706)'

    // --- shared store: one fetch for both seats --------------------------------

    const store = (() => {
      let state = { status: 'loading' }
      const listeners = new Set()
      let timer = null

      const emit = () => {
        for (const listener of Array.from(listeners)) listener(state)
      }

      const load = () => {
        fetch(ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}))
            if (res.ok && body && body.ok) state = { status: 'ready', data: body }
            else state = { status: 'error', message: (body && body.error) || `HTTP ${res.status}` }
            emit()
          })
          .catch((error) => {
            // A failed poll must never blank the bar: keep the last good data
            // on screen and only flag it as stale.
            state = state.status === 'ready'
              ? { ...state, stale: true }
              : { status: 'error', message: String((error && error.message) || error) }
            emit()
          })
      }

      const wake = () => {
        if (document.visibilityState === 'visible') load()
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          if (listeners.size === 1) {
            load()
            timer = window.setInterval(load, REFRESH_MS)
            document.addEventListener('visibilitychange', wake)
            window.addEventListener('focus', wake)
          }
          listener(state)
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) {
              window.clearInterval(timer)
              timer = null
              document.removeEventListener('visibilitychange', wake)
              window.removeEventListener('focus', wake)
            }
          }
        },
      }
    })()

    function useProgress() {
      const [state, setState] = React.useState({ status: 'loading' })
      React.useEffect(() => store.subscribe(setState), [])
      return state
    }

    // --- formatting ------------------------------------------------------------

    // "项目一 · epoll 工业网关 V1.0" -> "项目一"
    function shortTitle(title) {
      const head = String(title || '项目进度').split(/[·|—–-]/)[0].trim()
      return (head || '项目进度').slice(0, 12)
    }

    function fmtAgo(mtime) {
      if (!mtime) return '未知'
      const seconds = Math.max(0, Math.round((Date.now() - mtime) / 1000))
      if (seconds < 5) return '刚刚'
      if (seconds < 60) return `${seconds} 秒前`
      if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`
      return `${Math.round(seconds / 3600)} 小时前`
    }

    // The first open sub-step of the CURRENT big step. This is the one question
    // the panel actually gets opened to answer ("what do I do now"); the student
    // should not have to scan 50 lines for it.
    function nextTaskOf(data) {
      if (!data || !data.current) return null
      const step = data.steps[data.current.index]
      if (!step) return null
      const item = step.items.find((entry) => !entry.done && !entry.deferred)
      return item ? item.text : null
    }

    // --- seat 1: the frame-wide strip -----------------------------------------

    function ProgressStrip() {
      const state = useProgress()
      const data = state.status === 'ready' ? state.data : null
      if (!data || !data.stats.total) return null
      const currentIndex = data.current ? data.current.index : -1

      // One segment per big step, in the spec's module order. `WIDTH_MODE`
      // decides whether they share the width equally or in proportion to their
      // sub-step count; the current step's track is brighter, which is where
      // "current position" comes from.
      return h(
        'div',
        { style: S.stripLayer, 'aria-hidden': true },
        data.steps.map((step, index) => h(
          'div',
          {
            key: index,
            style: {
              ...S.segment,
              flexGrow: WIDTH_MODE === 'weighted' ? Math.max(1, step.total) : 1,
              background: index === currentIndex ? TRACK_CURRENT : TRACK,
            },
          },
          h('div', {
            style: {
              height: '100%',
              width: `${step.pct}%`,
              background: step.total > 0 && step.done === step.total ? SUCCESS : IN_PROGRESS,
              transition: 'width 300ms ease',
            },
          }),
          // Position cursor: a 2px theme-contrast notch on the left edge of the
          // current big step. The brighter track alone was too subtle to answer
          // "where am I" at 3px height (2026-10-31: asked for a visible marker).
          index === currentIndex ? h('div', { style: S.cursor }) : null,
        )),
      )
    }

    // --- seat 2: the chip + its scrollable checklist panel ---------------------

    function ProgressChip() {
      const state = useProgress()
      const data = state.status === 'ready' ? state.data : null
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const chipRef = React.useRef(null)
      const panelRef = React.useRef(null)
      // The panel opens AT the current step: a 50-line list that always starts at
      // the top is useless when the real question is "where am I / what's next".
      const currentStepRef = React.useRef(null)
      const hintRef = React.useRef(null)
      const closeTimer = React.useRef(null)

      const cancelClose = () => {
        if (closeTimer.current) {
          window.clearTimeout(closeTimer.current)
          closeTimer.current = null
        }
      }

      const openPanel = () => {
        cancelClose()
        const node = chipRef.current
        if (!node) return
        const rect = node.getBoundingClientRect()
        // Fixed positioning instead of the native `title`: the OS tooltip has no
        // scrollbar and clipped the tail of a 40+ line checklist.
        setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) })
        setOpen(true)
      }

      const scheduleClose = () => {
        cancelClose()
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null
          setOpen(false)
        }, CLOSE_DELAY_MS)
      }

      React.useEffect(() => cancelClose, [])
      React.useEffect(() => {
        if (!open) return undefined
        const close = () => setOpen(false)
        // Scrolling INSIDE the panel must not close it: scroll events do not
        // bubble, but a capture listener on window still sees them.
        const onScroll = (event) => {
          const node = panelRef.current
          if (node && event && event.target && node.contains(event.target)) return
          setOpen(false)
        }
        window.addEventListener('resize', close)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          window.removeEventListener('resize', close)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [open])
      // Runs when the panel opens, not on every 5s poll: a manual scroll must not
      // be yanked back under the pointer. The sticky hint floats above the list,
      // so its height is subtracted from the target offset.
      React.useEffect(() => {
        if (!open) return
        const panel = panelRef.current
        const node = currentStepRef.current
        if (!panel || !node) return
        const hintHeight = hintRef.current ? hintRef.current.offsetHeight : 0
        panel.scrollTop = Math.max(0, node.offsetTop - hintHeight - 8)
      }, [open])

      if (!data) {
        const message = state.status === 'error' ? state.message : '读取中'
        return h(
          'div',
          { style: S.chip, title: `项目进度：${message}\n数据源：工作区根目录 项目进度.md` },
          h('span', { style: S.dim }, '项目进度 --'),
        )
      }

      const complete = data.stats.total > 0 && data.stats.done === data.stats.total
      // Position, not just percentage: "第2/9步" answers "where am I" at a glance,
      // without hovering the panel. When everything is done it parks on the last
      // step instead of pointing past the end.
      const stepCount = data.steps.length
      const stepNo = data.current ? data.current.index + 1 : stepCount
      // 清单文件是唯一数据源：超过 48 小时没改就明说（学生问过"条怎么不动了"）。
      const ageMs = Date.now() - (data.mtime || 0)
      const staleDays = ageMs > 48 * 3600 * 1000 ? Math.floor(ageMs / 86_400_000) : 0
      const nextTask = nextTaskOf(data)
      const currentIndex = data.current ? data.current.index : -1
      const panel = open && anchor
        ? h(
            'div',
            {
              role: 'tooltip',
              tabIndex: 0,
              ref: panelRef,
              style: { ...S.panel, top: `${anchor.top}px`, right: `${anchor.right}px` },
              onMouseEnter: cancelClose,
              onMouseLeave: scheduleClose,
              onFocus: cancelClose,
              onBlur: scheduleClose,
            },
            // Sticky: the answer to "what now" must stay visible while the list
            // scrolls to the current position.
            h('div', { ref: hintRef, style: S.panelHint },
              h('div', { style: S.hintNext },
                h('span', { style: S.hintLabel }, '下一步 · '),
                nextTask || '全部完成 🎉'),
              h('div', { style: S.hintMeta },
                (staleDays ? `清单已 ${staleDays} 天未更新（做完的小步要在 项目进度.md 里勾掉） · ` : '') +
                `总进度 ${data.stats.done}/${data.stats.total}（${data.stats.pct}%） · 第 ${stepNo}/${stepCount} 步 · 滚轮可滚动`),
            ),
            h('div', { style: S.panelBody },
              h('div', { style: S.panelHead },
                `${data.title || '项目进度'}\n${fmtAgo(data.mtime)}更新 · ${data.file}\n────────────────────`),
              data.steps.map((step, index) => {
                const isCurrent = index === currentIndex
                const isComplete = step.total > 0 && step.done === step.total
                const note = step.deferred ? `（延后 ${step.deferred}）` : ''
                return h('div', {
                  key: index,
                  ref: isCurrent ? currentStepRef : null,
                  style: isCurrent ? { ...S.step, ...S.stepCurrent } : S.step,
                },
                  h('div', { style: isCurrent ? { ...S.stepTitle, ...S.stepTitleCurrent } : S.stepTitle },
                    `## ${step.title}  ${step.done}/${step.total}${note}${isComplete ? ' ✓' : ''}`),
                  step.items.map((item, itemIndex) => h('div', { key: itemIndex, style: S.item },
                    `${item.done ? '✓' : item.deferred ? '~' : '·'} ${item.text}`)),
                )
              }),
              (data.warnings || []).length
                ? h('div', { style: S.panelWarn },
                    '────────────────────\n' + data.warnings.map((warning) => `! ${warning}`).join('\n'))
                : null,
            ),
          )
        : null

      const chip = h(
        'div',
        {
          ref: chipRef,
          style: S.chip,
          tabIndex: 0,
          'aria-label': '项目进度，悬停查看完整清单',
          onMouseEnter: openPanel,
          onMouseLeave: scheduleClose,
          onFocus: openPanel,
          onBlur: scheduleClose,
        },
        h('div', { style: S.chipTrack },
          h('div', {
            style: {
              height: '100%',
              width: `${data.stats.pct}%`,
              background: complete ? SUCCESS : IN_PROGRESS,
              transition: 'width 300ms ease',
            },
          })),
        h('span', { style: S.text }, `${shortTitle(data.title)} ${data.stats.pct}%`),
        h('span', { style: S.dim }, `第${stepNo}/${stepCount}步`),
        h('span', { style: S.dim }, `${data.stats.done}/${data.stats.total}`),
        state.stale || staleDays ? h('span', { style: S.dot }, '●') : null,
      )

      if (!panel) return chip
      return h(React.Fragment, null, chip, createPortal ? createPortal(panel, document.body) : panel)
    }

    const S = {
      // 3px pinned to the very top edge, full width, click-through.
      stripLayer: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        display: 'flex',
        gap: '2px',
        pointerEvents: 'none',
        zIndex: 2147483000,
      },
      segment: { position: 'relative', overflow: 'hidden' },
      chip: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height: '22px',
        padding: '0 2px',
        fontSize: '11px',
        lineHeight: '1',
        whiteSpace: 'nowrap',
        cursor: 'default',
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
      },
      chipTrack: { width: '56px', height: '6px', borderRadius: '3px', background: TRACK, overflow: 'hidden' },
      text: { color: 'var(--dsw-alias-label-primary)' },
      dim: { color: 'var(--dsw-alias-label-secondary)' },
      dot: { color: WARN, fontSize: '9px' },
      // The scrollable checklist panel. `maxHeight` + `overflow:auto` is the
      // whole point: a 40+ line list must stay readable on a small window.
      panel: {
        position: 'fixed',
        zIndex: 2147483000,
        boxSizing: 'border-box',
        maxHeight: 'min(72vh, 560px)',
        maxWidth: 'min(640px, calc(100vw - 24px))',
        overflow: 'auto',
        overscrollBehavior: 'contain',
        padding: '8px 12px 12px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'var(--dsw-alias-bg-overlay, #fff)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.20)',
        color: 'var(--dsw-alias-label-primary)',
      },
      panelHint: {
        position: 'sticky',
        top: '-8px',
        margin: '-8px -12px 6px',
        padding: '6px 12px',
        background: 'inherit',
        fontSize: '10.5px',
        lineHeight: '14px',
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.18))',
      },
      // Sticky hint content: the next actionable sub-step, then the meta line.
      hintNext: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '11.5px',
        lineHeight: '16px',
        fontWeight: 600,
      },
      hintLabel: { color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 },
      hintMeta: { marginTop: '2px' },
      panelHead: { color: 'var(--dsw-alias-label-secondary)', marginBottom: '6px' },
      // One block per big step so the CURRENT one can be highlighted and scrolled
      // to; the block is a plain div (no CSS file in a client bundle).
      step: { padding: '3px 6px', margin: '1px -6px', borderRadius: '6px' },
      stepCurrent: {
        background: 'rgba(77,107,254,0.14)',
        boxShadow: 'inset 2px 0 0 #4d6bfe',
        paddingLeft: '8px',
      },
      stepTitle: { color: 'var(--dsw-alias-label-primary)' },
      stepTitleCurrent: { fontWeight: 600 },
      item: { paddingLeft: '2px' },
      panelWarn: { marginTop: '8px', color: WARN },
      // The position cursor on the 3px top strip. Theme label colour: near-black
      // in the light theme, near-white in the dark one, so it never disappears.
      cursor: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '2px',
        background: 'var(--dsw-alias-label-primary, #111)',
      },
      panelBody: {
        fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
        fontSize: '11.5px',
        lineHeight: '1.6',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        userSelect: 'text',
      },
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // `inject` waits for the declaration: registering into a slot that is
        // not declared yet throws, and a declaration can collapse and come back
        // (HMR, panel switch), in which case the callback runs again.
        ctx.slots.inject(STRIP_SLOT, () => ctx.slots.register(
          { name: STRIP_SLOT, id: STRIP_ID, order: -50, label: '项目进度条' },
          ProgressStrip,
        ))
        ctx.slots.inject(CHIP_SLOT, () => ctx.slots.register(
          { name: CHIP_SLOT, id: CHIP_ID, order: 10, label: '项目进度' },
          ProgressChip,
        ))
      },
    }
  },
})
