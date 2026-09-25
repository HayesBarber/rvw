/** Position a new file or an explicit search target after the layout pass.
 * A new target object requests navigation even when its line has not changed.
 * onPostRender runs inside the virtualizer's render pass, before scroll anchoring
 * and height reconciliation. A synchronous scroll reset there can be undone.
 */
export function createInitialFilePosition({
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  observeResize = (node, callback) => {
    const observer = new ResizeObserver(callback)
    observer.observe(node)
    return () => observer.disconnect()
  },
} = {}) {
  let current = null
  const positionedInstances = new WeakMap()

  function cancel() {
    if (!current) return
    if (current.frame !== null) cancelFrame(current.frame)
    current.disconnect?.()
    current = null
  }

  function rendered(node, instance, target = null, navigate = null) {
    if (!node.isConnected) return false
    if (current?.instance !== instance || current?.target !== target) {
      cancel()
      current = {
        instance, target, frame: null,
        positioned: positionedInstances.has(instance) && positionedInstances.get(instance) === target,
      }
    }
    const pending = current
    if (pending.positioned || pending.frame !== null) return true
    const container = node.closest('.diff-scroll')
    if (!container) return true

    const schedule = () => {
      if (current !== pending || pending.positioned || pending.frame !== null) return
      pending.frame = requestFrame(() => {
        pending.frame = null
        if (current !== pending || !node.isConnected) return
        // Placeholder renders and hidden panes have no usable layout yet.
        if (!node.shadowRoot?.querySelector('pre') || container.clientHeight === 0) return
        if (target) {
          // Expansion changes virtual row positions. Wait for its layout pass.
          if (instance.revealLine?.(target.lineNumber)) {
            schedule()
            return
          }
          navigate(target)
        } else {
          container.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        }
        pending.positioned = true
        positionedInstances.set(instance, target)
        pending.disconnect?.()
      })
    }
    pending.disconnect ??= observeResize(container, schedule)
    schedule()
    return true
  }

  function unmounted(instance) {
    if (current?.instance === instance) cancel()
  }

  return { rendered, unmounted }
}
