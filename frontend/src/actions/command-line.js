import { applicationActionCatalog } from './application-actions.js'

const COMMAND_HISTORY_LIMIT = 1000

export function resolveCommand(input, aliases = {}) {
  const name = input.trim()
  if (!name) return { kind: 'empty' }
  if (!Object.hasOwn(aliases, name) && /^[0-9]+$/.test(name)) {
    const lineNumber = Number(name)
    if (Number.isSafeInteger(lineNumber) && lineNumber > 0) {
      return { kind: 'line', lineNumber }
    }
  }
  const action = Object.hasOwn(aliases, name) ? aliases[name] : name
  return Object.hasOwn(applicationActionCatalog, action)
    ? { kind: 'action', action }
    : { kind: 'unknown', name }
}

/** Input lifecycle for application actions and current-file line navigation. */
export function createCommandLine({ getFocus, setMode, onChange }) {
  let open = false
  let submitting = false
  let previousFocus = null
  const history = []
  let historyIndex = 0
  let historyDraft = ''
  const close = (restore = true) => {
    open = false
    setMode('normal')
    if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    onChange({ open: false, error: null })
  }
  return {
    open() {
      if (open || submitting) return false
      previousFocus = getFocus()
      historyIndex = history.length
      open = true
      setMode('command')
      onChange({ open: true, error: null })
      return true
    },
    cancel() {
      if (open && !submitting) close()
    },
    recallPrevious(input) {
      if (!open || submitting || history.length === 0) return input
      if (historyIndex === history.length) historyDraft = input
      historyIndex = Math.max(0, historyIndex - 1)
      return history[historyIndex]
    },
    recallNext(input) {
      if (!open || submitting || historyIndex === history.length) return input
      historyIndex++
      return historyIndex === history.length ? historyDraft : history[historyIndex]
    },
    submit(input, aliases, dispatch, focusInput, navigateToLine = () => false) {
      if (!open || submitting) return false
      const result = resolveCommand(input, aliases)
      if (result.kind === 'empty') { close(); return true }
      history.push(input)
      if (history.length > COMMAND_HISTORY_LIMIT) history.shift()
      historyIndex = history.length
      if (result.kind === 'unknown') {
        onChange({ open: true, error: `Unknown command: ${result.name}` })
        return false
      }
      submitting = true
      try {
        // Restore before dispatch so focus-changing actions and newly opened
        // editors/overlays inherit workspace focus, never the disappearing input.
        setMode('normal')
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
        const handled = result.kind === 'line'
          ? navigateToLine(result.lineNumber)
          : dispatch(result.action)
        if (handled) {
          open = false
          onChange({ open: false, error: null })
          return true
        }
        focusInput()
        setMode('command')
        onChange({ open: true, error: result.kind === 'line'
          ? `Line unavailable: ${result.lineNumber}`
          : `Action unavailable: ${result.action}` })
        return false
      } finally {
        submitting = false
      }
    },
  }
}

export function handleCommandLineKey(event, { submit, cancel, recallPrevious, recallNext }) {
  event.stopPropagation()
  if (event.isComposing || event.nativeEvent?.isComposing) return
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault()
    if (event.key === 'ArrowUp') recallPrevious()
    else recallNext()
    return
  }
  if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    if (event.repeat) return
    if (event.key === 'Enter') submit()
    if (event.key === 'Escape') cancel()
  }
}
