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
const namedKeyNotations = new Set(Object.values(namedKeys))
const eventModifiers = Object.freeze([
  Object.freeze(['ctrlKey', 'C']),
  Object.freeze(['altKey', 'M']),
  Object.freeze(['metaKey', 'D']),
  Object.freeze(['shiftKey', 'S']),
])
const modifierPrefixes = Object.freeze(
  Array.from({ length: (1 << eventModifiers.length) - 1 }, (_, index) => (
    `${eventModifiers
      .filter((_, bit) => (index + 1) & (1 << bit))
      .map(([, notation]) => notation)
      .join('-')}-`
  )).sort((left, right) => right.length - left.length),
)

function isControlCharacter(key) {
  const code = key.charCodeAt(0)
  return code <= 0x1f || code === 0x7f
}

/** Returns whether a key matches the notation emitted by keyboardEventToKey. */
export function isNormalizedVimKey(key) {
  if (typeof key !== 'string' || key.length === 0) return false

  if (key.length === 1) {
    return key !== ' ' && !isControlCharacter(key)
  }

  if (!key.startsWith('<') || !key.endsWith('>')) return false
  const notation = key.slice(1, -1)
  if (namedKeyNotations.has(notation)) return true
  const prefix = modifierPrefixes.find((candidate) => notation.startsWith(candidate))
  if (!prefix) return false
  const base = notation.slice(prefix.length)
  if (namedKeyNotations.has(base)) return true
  return base.length === 1 && base === base.toLowerCase() &&
    !isControlCharacter(base) && base !== ' '
}

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
  const modifiers = eventModifiers
    .filter(([property]) => event[property])
    .map(([, notation]) => notation)
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
    const role = typeof target.getAttribute === 'function'
      ? target.getAttribute('role')
      : null
    if (
      target.isContentEditable ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      tagName === 'dialog' ||
      role === 'dialog'
    ) {
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
