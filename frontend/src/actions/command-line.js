import { applicationActionCatalog } from './application-actions.js'

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
      open = true
      setMode('command')
      onChange({ open: true, error: null })
      return true
    },
    cancel() {
      if (open && !submitting) close()
    },
    submit(input, aliases, dispatch, focusInput) {
      if (!open || submitting) return false
      const result = resolveCommand(input, aliases)
      if (result.kind === 'empty') { close(); return true }
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

export function handleCommandLineKey(event, { submit, cancel }) {
  event.stopPropagation()
  if (event.isComposing || event.nativeEvent?.isComposing) return
  if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    if (event.repeat) return
    if (event.key === 'Enter') submit()
    if (event.key === 'Escape') cancel()
  }
}
