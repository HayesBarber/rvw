import { applicationActionCatalog } from './application-actions.js'

const COMMAND_HISTORY_LIMIT = 1000

export function resolveCommand(input, aliases = {}) {
  const name = input.trim()
  if (!name) return { kind: 'empty' }
  const action = Object.hasOwn(aliases, name) ? aliases[name] : name
  return Object.hasOwn(applicationActionCatalog, action)
    ? { kind: 'action', action }
    : { kind: 'unknown', name }
}

/** Input lifecycle; execution is supplied by the shared application dispatcher. */
export function createCommandLine({ getFocus, setMode, onChange }) {
  let open = false
  let submitting = false
  let previousFocus = null
  const history = []
  let historyIndex = 0
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
      historyIndex = Math.max(0, historyIndex - 1)
      return history[historyIndex]
    },
    submit(input, aliases, dispatch, focusInput) {
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
        if (dispatch(result.action)) {
          open = false
          onChange({ open: false, error: null })
          return true
        }
        focusInput()
        setMode('command')
        onChange({ open: true, error: `Action unavailable: ${result.action}` })
        return false
      } finally {
        submitting = false
      }
    },
  }
}

export function handleCommandLineKey(event, { submit, cancel, recallPrevious }) {
  event.stopPropagation()
  if (event.isComposing || event.nativeEvent?.isComposing) return
  if (event.key === 'ArrowUp' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault()
    recallPrevious()
    return
  }
  if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    if (event.repeat) return
    if (event.key === 'Enter') submit()
    if (event.key === 'Escape') cancel()
  }
}
