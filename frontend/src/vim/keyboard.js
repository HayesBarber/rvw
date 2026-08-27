const namedKeys = Object.freeze({
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backspace: 'BS',
  Delete: 'Del',
  End: 'End',
  Enter: 'Enter',
  Escape: 'Esc',
  Home: 'Home',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  ' ': 'Space',
  Tab: 'Tab',
})

function printableKey(event) {
  if (event.code?.startsWith('Key')) return event.code.slice(3).toLowerCase()
  if (event.code?.startsWith('Digit')) return event.code.slice(5)
  return event.key.length === 1 ? event.key.toLowerCase() : null
}

/** Converts a KeyboardEvent into stable Vim-style key notation. */
export function keyboardEventToKey(event) {
  if (event.key === 'Dead' || event.key === 'Process' || event.key === 'Unidentified') {
    return null
  }

  const named = namedKeys[event.key]
  const hasModifier = event.ctrlKey || event.altKey || event.metaKey
  if (!hasModifier && !named) {
    return event.key.length === 1 ? event.key : null
  }

  const base = named ?? printableKey(event)
  if (!base) return null
  const modifiers = []
  if (event.ctrlKey) modifiers.push('C')
  if (event.altKey) modifiers.push('M')
  if (event.metaKey) modifiers.push('D')
  if (event.shiftKey) modifiers.push('S')
  return `<${modifiers.length > 0 ? `${modifiers.join('-')}-` : ''}${base}>`
}

function eventTarget(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  return path[0] ?? event.target
}

/**
 * Text-editing controls opt out by default. A descendant can explicitly opt in
 * with data-vim-capture; any subtree can opt out with data-vim-ignore.
 */
export function shouldCaptureKeyboardEvent(event) {
  if (event.defaultPrevented || event.isComposing) return false

  let target = eventTarget(event)
  while (target) {
    if (typeof target.hasAttribute === 'function') {
      if (target.hasAttribute('data-vim-capture')) return true
      if (target.hasAttribute('data-vim-ignore')) return false
    }
    const tagName = target.tagName?.toLowerCase()
    if (target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return false
    }
    target = target.parentElement
  }
  return true
}

/**
 * Installs the sole DOM boundary for Vim input. It returns a disposer and does
 * not assume anything about the commands emitted by the state machine.
 */
export function attachVimKeyboardCapture({
  target,
  dispatch,
  shouldCapture = shouldCaptureKeyboardEvent,
}) {
  if (!target?.addEventListener || !target?.removeEventListener) {
    throw new TypeError('Vim keyboard capture requires an event target')
  }

  const onKeyDown = (event) => {
    if (!shouldCapture(event)) return
    const key = keyboardEventToKey(event)
    if (!key) return

    const result = dispatch({ type: 'key', key })
    if (!result.handled) return
    event.preventDefault()
    event.stopPropagation()
  }

  target.addEventListener('keydown', onKeyDown, { capture: true })
  return () => target.removeEventListener('keydown', onKeyDown, { capture: true })
}
