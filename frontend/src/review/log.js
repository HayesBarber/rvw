import { sendLogEvent } from './api.js'

// Call sites own privacy: messages must be fixed descriptions and context must
// contain only deliberately selected diagnostics. Never pass exception objects.
export function logError(message, context, traceId) {
  sendLogEvent({ level: 'error', message, context, traceId })
}

const installed = Symbol.for('rvw.globalLogging')
export function installGlobalLogging(target = window) {
  if (target[installed]) return
  target[installed] = true
  // Do not inspect the Error/rejection, URL, filename, or arbitrary properties.
  target.addEventListener('error', () => logError('frontend error'))
  target.addEventListener('unhandledrejection', () => logError('frontend unhandled rejection'))
}
