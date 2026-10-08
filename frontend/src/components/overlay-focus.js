export function trapOverlayFocus(event, dialog, navigationTarget) {
  if (event.key !== 'Tab') return
  const focusable = [...dialog.querySelectorAll(
    'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )]
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeElement = dialog.ownerDocument.activeElement
  if (activeElement === dialog || activeElement === navigationTarget) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  } else if (event.shiftKey && activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
