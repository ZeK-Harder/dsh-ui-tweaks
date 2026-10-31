// @local/dsh-quote-reply - browser half.
//
// One drawn thing: a Doubao-style floating pill that appears after the user
// selects text inside the transcript — 复制 / 引用, no 朗读.
//
// The pill registers into `conversation.input.dock` (session-scope list slot,
// so it receives the standard session props incl. `inputActions`) and portals
// itself to <body>, which escapes the composer's stacking/clipping context.
// It only ever appears when the selection's ancestor is a transcript row
// (`[data-chat-flow-key]`) and not inside an editor; it never touches the
// native selection beyond `mousedown` + `preventDefault()` to keep it alive.
//
// Quote insertion uses the official InputActions:
//   captureInsertion()        captures the draft selection + revision
//   insertText(text, span)    one undoable plain-text edit while that revision
//                             is current and the editor permits editing
// Capturing right before the insert keeps the revision fresh; a refusal is
// retried once with a fresh capture.
//
// ID namespace: slot id `quote-reply-selection`, DOM ids and class names carry
// `dshqr-`. Nothing replaces a shipped cell, no keyboard shortcuts are bound,
// no foreign DOM is mutated.
window.__ModuleLoader__.load({
  id: '@local/dsh-quote-reply',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (ReactDOM && typeof ReactDOM.createPortal === 'function') createPortal = ReactDOM.createPortal
    } catch (error) {
      createPortal = null
    }

    const MAX_QUOTE_CHARS = 3000

    function toQuote(text) {
      const trimmed = String(text).replace(/\s+$/, '')
      const clipped = trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS - 6)}……` : trimmed
      return clipped.split(/\r?\n/).map((line) => (line.length > 0 ? `> ${line}` : '>')).join('\n') + '\n\n'
    }

    async function insertQuote(inputActions, text) {
      const quote = toQuote(text)
      try {
        const first = await inputActions.insertText(quote, inputActions.captureInsertion())
        if (first !== false) return true
        const second = await inputActions.insertText(quote, inputActions.captureInsertion())
        return second !== false
      } catch (error) {
        return false
      }
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (error) {
        // fall through to the legacy path
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok === true
      } catch (error) {
        return false
      }
    }

    const ICON_COPY = h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }),
      h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
    )
    const ICON_QUOTE = h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('path', { d: 'M9 17H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8' }),
      h('path', { d: 'M19 17h-4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8' }),
    )

    const BTN_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      height: '28px',
      padding: '0 8px',
      border: '0',
      borderRadius: '8px',
      background: 'transparent',
      color: 'var(--dsw-alias-text-primary, #1f2329)',
      fontSize: '12px',
      lineHeight: '1',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const BTN_ERROR = { ...BTN_STYLE, color: 'var(--dsw-alias-error, #dc2626)' }

    function pillButton(label, icon, onClick, error) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dshqr-pill-btn',
          style: error ? BTN_ERROR : BTN_STYLE,
          onMouseDown: (event) => event.preventDefault(), // keep the selection alive
          onClick,
        },
        icon,
        label,
      )
    }

    function SelectionPill(props) {
      const inputActions = props.inputActions
      const [target, setTarget] = useState(null) // { text, rect }
      const [copyState, setCopyState] = useState('idle') // idle | copied | error
      const [quoteState, setQuoteState] = useState('idle') // idle | busy | done | error

      useEffect(() => {
        let timer = null

        const read = () => {
          timer = null
          const selection = window.getSelection()
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            setTarget(null)
            return
          }
          const text = selection.toString()
          if (!text || text.trim().length === 0) {
            setTarget(null)
            return
          }
          const range = selection.getRangeAt(0)
          const anchor = range.startContainer
          const element = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)
          if (!element || !element.closest('[data-chat-flow-key]')) {
            setTarget(null) // only inside transcript rows
            return
          }
          if (element.closest('textarea, input, [contenteditable="true"]')) {
            setTarget(null) // never over an editor
            return
          }
          const rect = range.getBoundingClientRect()
          if (!rect || (rect.width === 0 && rect.height === 0)) {
            setTarget(null)
            return
          }
          setTarget({
            text: text.slice(0, MAX_QUOTE_CHARS),
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          })
        }

        const schedule = (delay) => {
          if (timer) window.clearTimeout(timer)
          timer = window.setTimeout(read, delay)
        }

        const onSelectionChange = () => schedule(80)
        const onPointerUp = () => schedule(10)
        const onScroll = () => setTarget(null)
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setTarget(null)
        }

        document.addEventListener('selectionchange', onSelectionChange)
        document.addEventListener('pointerup', onPointerUp, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          if (timer) window.clearTimeout(timer)
          document.removeEventListener('selectionchange', onSelectionChange)
          document.removeEventListener('pointerup', onPointerUp, true)
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [])

      const onCopy = useCallback(async () => {
        if (!target) return
        const ok = await copyText(target.text)
        setCopyState(ok ? 'copied' : 'error')
        window.setTimeout(() => setCopyState('idle'), 900)
      }, [target])

      const onQuote = useCallback(async () => {
        if (!target || !inputActions) return
        setQuoteState('busy')
        const ok = await insertQuote(inputActions, target.text)
        setQuoteState(ok ? 'done' : 'error')
        if (ok) {
          const selection = window.getSelection()
          if (selection) selection.removeAllRanges() // the pill leaves with the selection
          setTarget(null)
        }
        window.setTimeout(() => setQuoteState('idle'), 900)
      }, [inputActions, target])

      if (!target) return null

      const pill = h(
        'div',
        {
          id: 'dshqr-pill',
          role: 'toolbar',
          'aria-label': '选中文本操作',
          style: {
            position: 'fixed',
            zIndex: 2147483000,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: '3px',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-elevated, #ffffff)',
            boxShadow: '0 4px 16px rgba(0,0,0,.16)',
            border: '1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.08))',
          },
        },
        pillButton(copyState === 'copied' ? '已复制' : '复制', ICON_COPY, onCopy, copyState === 'error'),
        pillButton(quoteState === 'busy' ? '…' : '引用', ICON_QUOTE, onQuote, quoteState === 'error'),
      )

      // Place the pill above the selection, clamped into the viewport.
      const width = 132
      const top = Math.max(8, target.rect.top - 40)
      const left = Math.min(
        Math.max(8, target.rect.left + (target.rect.right - target.rect.left) / 2 - width / 2),
        Math.max(8, window.innerWidth - width - 8),
      )
      const positioned = React.cloneElement(pill, {
        style: { ...pill.props.style, top: `${top}px`, left: `${left}px` },
      })
      return createPortal ? createPortal(positioned, document.body) : positioned
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
          { name: 'conversation.input.dock', id: 'quote-reply-selection', order: 10, label: '选中文本工具条' },
          SelectionPill,
        ))
      },
    }
  },
})
