import { sendLogEvent } from './api.js'

let enabled = false
let selection
let sequence = 0
const traces = new WeakMap()
const listeners = new Set()

export function configureFileTiming(value) {
  enabled = value === true
  if (!enabled) selection = undefined
}
export function observeFileTiming(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function markFileSelection(path) {
  if (enabled) selection = { path, time: performance.now() }
}

export function startFileTiming(path, changed, { now = () => performance.now(), emit = sendLogEvent } = {}) {
  if (!enabled) return undefined
  const start = selection?.path === path ? selection.time : now()
  selection = undefined
  const traceId = globalThis.crypto?.randomUUID?.() ??
    `file-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`
  let ended = false
  let rendered = false
  const stages = new Set()
  const trace = {
    traceId,
    now,
    stage(stage, since = start) {
      if (ended) return
      const event = { level: 'debug', message: 'file load timing', traceId,
        context: { stage, durationMs: Math.max(0, now() - since), kind: changed ? 'diff' : 'file' } }
      emit(event)
      for (const listener of listeners) listener(event)
    },
    once(stage, since) {
      if (stages.has(stage)) return
      stages.add(stage)
      trace.stage(stage, since)
    },
    attach(file) {
      traces.set(file, trace)
      trace.received = now()
      trace.stage('response_ready')
      if (file.content.kind === 'unavailable') trace.finish('unavailable')
    },
    render(node, phase) {
      if (ended || phase === 'unmount') return
      trace.once('render_first', trace.received)
      // A painted-frame approximation; browsers do not expose element paint completion.
      if (!rendered) {
        rendered = true
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (node.isConnected) trace.once('visible')
        }))
      }
      // Detect token markup without reading text or private renderer state.
      if (!stages.has('highlight_tokens') && node.shadowRoot?.querySelector('[data-code] span[style], [data-code] span[class*="hl-"]')) {
        trace.once('highlight_tokens', trace.received)
      }
      trace.once('render_update', trace.received)
    },
    finish(outcome) {
      if (ended) return
      trace.stage(outcome === 'superseded' && stages.has('visible') ? 'completed' : outcome)
      ended = true
    },
  }
  trace.stage('request_schedule')
  return trace
}

export function recordFileRender(file, node, phase) {
  traces.get(file)?.render(node, phase)
}
