import { scrollDiffCursorIntoView } from '../../actions/diff-cursor-actions.js'

/** Keep a cursor move pending until its virtual row has a measured layout. */
export function createCursorScroll({
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
} = {}) {
  let pending = null

  function cancel() {
    if (!pending) return
    if (pending.frame !== null) cancelFrame(pending.frame)
    pending.viewport?.removeEventListener('wheel', cancel)
    pending.viewport?.removeEventListener('touchstart', cancel)
    pending.viewport?.removeEventListener('pointerdown', cancel)
    pending = null
  }

  function schedule() {
    if (!pending || pending.frame !== null) return
    const move = pending
    move.frame = requestFrame(() => {
      move.frame = null
      if (pending !== move || !move.node.isConnected) return cancel()
      // React commits annotation slots before this frame. Measure them before
      // reading positions, including the positions of rows below each card.
      move.instance.reconcileHeights?.()
      scrollDiffCursorIntoView(move.instance, move.node, move.cursor)
      // The first scroll can bring an unrendered row into the virtual window.
      // Recheck after that render and its height reconciliation, outside the
      // virtualizer's own scroll-anchor pass. Limit work if the pane is hidden.
      if (++move.passes < 3) schedule()
      else cancel()
    })
  }

  function request(instance, node, cursor) {
    cancel()
    const viewport = instance.getEditorViewport?.()
    pending = { instance, node, cursor, viewport, frame: null, passes: 0 }
    viewport?.addEventListener('wheel', cancel, { passive: true })
    viewport?.addEventListener('touchstart', cancel, { passive: true })
    viewport?.addEventListener('pointerdown', cancel, { passive: true })
    schedule()
  }

  function rendered(instance) {
    if (pending?.instance === instance) schedule()
  }

  function unmounted(instance) {
    if (pending?.instance === instance) cancel()
  }

  return { request, rendered, unmounted, cancel }
}
