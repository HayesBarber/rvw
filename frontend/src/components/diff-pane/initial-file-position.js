export function lineNavigationCursor(target, instance) {
  return {
    lineNumber: target.lineNumber,
    side: target.side === 'old' && instance?.type === 'file-diff' ? 'deletions' : 'additions',
  }
}

/** Pierre reveals context by new-side line number. Translate old-side gaps. */
export function navigationRevealLine(instance, target) {
  if (target.lineNumber === 0) return null
  if (target.side !== 'old' || instance.type !== 'file-diff') return target.lineNumber
  let oldEnd = 1
  let newEnd = 1
  for (const hunk of instance.fileDiff.hunks) {
    const oldStart = hunk.deletionStart + (hunk.deletionCount === 0 ? 1 : 0)
    const newStart = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0)
    if (target.lineNumber < oldStart) return newStart - oldStart + target.lineNumber
    oldEnd = oldStart + hunk.deletionCount
    newEnd = newStart + hunk.additionCount
    // Lines inside a hunk are already visible, including deleted lines.
    if (target.lineNumber < oldEnd) return null
  }
  return newEnd - oldEnd + target.lineNumber
}

/** Position a new file or an explicit location after the layout pass.
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
          const revealLine = navigationRevealLine(instance, target)
          if (revealLine !== null && instance.revealLine?.(revealLine)) {
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
