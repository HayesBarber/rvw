/** One transport instance belongs to one frontend document. */
export function createReviewTransport({
  getNative = () => window.webkit?.messageHandlers?.native,
  fetchRequest = (...args) => fetch(...args),
} = {}) {
  let sessionId = null
  let startup = null

  async function request(url, nativeRequest, options = {}) {
    const native = getNative()
    if (native) {
      return native.postMessage(sessionId === null ? nativeRequest : { ...nativeRequest, sessionId })
    }
    const response = await fetchRequest(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...options.headers,
        ...(sessionId === null ? {} : { 'X-Rvw-Session': String(sessionId) }),
      },
    })
    let body
    try {
      body = await response.json()
    } catch {
      throw new Error(`The rvw service returned an invalid response (${response.status})`)
    }
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `The rvw service returned ${response.status}`)
    }
    return body
  }

  function initialize() {
    if (sessionId !== null) return Promise.resolve({ id: sessionId })
    if (startup) return startup
    startup = request('/api/review/session', { type: 'get_review_session' }).then((result) => {
      if (!Number.isSafeInteger(result?.id) || result.id <= 0) {
        throw new Error('The rvw service returned an invalid review session')
      }
      sessionId = result.id
      return result
    }).finally(() => { startup = null })
    return startup
  }

  return Object.freeze({ initialize, request })
}

export const reviewTransport = createReviewTransport()
