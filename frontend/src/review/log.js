import { sendLogEvent } from './api.js'

// Call sites own privacy: messages must be fixed descriptions and context must
// contain only deliberately selected diagnostics. Never pass exception objects.
function log(level, message, context, traceId) {
  try { sendLogEvent({ level, message, context, traceId }) } catch { /* non-fatal */ }
}
export const logError = (message, context, traceId) => log('error', message, context, traceId)
export const logWarning = (message, context, traceId) => log('warning', message, context, traceId)
export const logInfo = (message, context, traceId) => log('info', message, context, traceId)
export const logDebug = (message, context, traceId) => log('debug', message, context, traceId)

const installed = Symbol.for('rvw.globalLogging')
export function installGlobalLogging(target = window) {
  if (target[installed]) return
  target[installed] = true
  // Do not inspect the Error/rejection, URL, filename, or arbitrary properties.
  target.addEventListener('error', () => logError('frontend error'))
  target.addEventListener('unhandledrejection', () => logError('frontend unhandled rejection'))
  logInfo('frontend started')
}

export async function measureOverviewRequest(request) {
  const started = performance.now()
  let status = 'error'
  try {
    const result = await request()
    status = 'ok'
    return result
  } finally {
    logDebug('api request', {
      operation: 'get_diff_overview',
      durationMs: Math.max(0, performance.now() - started),
      status,
    })
  }
}
