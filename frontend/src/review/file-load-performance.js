import { sendLogEvent } from './api.js'

let enabled = false
const traces = new WeakMap()
let selection = null

export function configureFileLoadPerformance(value) {
  enabled = value === true
}

export function markFileSelection(path) {
  if (enabled) selection = { path, start: performance.now() }
}

export function beginFileLoad(key, path) {
  if (!enabled || !key) return null
  return { id: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''), start: selection?.path === path ? selection.start : performance.now(), visible: false, cancelled: false }
}

export function fileLoadStage(trace, stage, start, fields = {}) {
  if (!trace) return
  sendLogEvent({
    level: 'debug', message: 'file load timing', traceId: trace.id,
    context: { stage, durationMs: performance.now() - start, ...fields },
  })
}

export function attachFileLoad(file, trace) {
  if (trace) traces.set(file, trace)
  return file
}

export function fileRendered(file, node, phase, highlighted = false) {
  const trace = traces.get(file)
  if (!trace || trace.cancelled || phase === 'unmount') return
  if (!trace.rendered) {
    trace.rendered = true
    fileLoadStage(trace, 'render_first', trace.responseAt ?? trace.start)
  }
  if (highlighted && !trace.highlighted) {
    trace.highlighted = true
    fileLoadStage(trace, 'highlight_ready', trace.responseAt ?? trace.start)
  }
  if (trace.visible || !node.shadowRoot?.querySelector('pre')) return
  trace.visible = true
  // A frame followed by a task runs after the browser had an opportunity to
  // paint. This is an approximation of visibility, not a compositor timestamp.
  requestAnimationFrame(() => setTimeout(() => {
    if (!trace.cancelled && node.isConnected) fileLoadStage(trace, 'selection_to_visible', trace.start)
  }, 0))
}

export function activateFileLoad(trace) {
  if (trace) trace.cancelled = false
  selection = null
}
export function cancelFileLoad(trace) {
  if (trace && !trace.visible && !trace.cancelled) fileLoadStage(trace, 'cancelled', trace.start)
  if (trace) trace.cancelled = true
}
export function receivedFileLoad(trace) {
  if (trace) trace.responseAt = performance.now()
}
