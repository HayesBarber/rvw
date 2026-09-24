// Each change invalidates pending work immediately, including the debounce window.
export function createTextSearchRequest({ search, mode = 'ignore-aware', delay = 150 }) {
  let state = { query: '', mode, status: 'idle', matches: [], truncated: false, error: null, activeIndex: 0 }
  let generation = 0
  let timer
  const listeners = new Set()
  const publish = (next) => {
    state = next
    for (const listener of listeners) listener()
  }
  const cancel = () => {
    generation += 1
    clearTimeout(timer)
  }
  const update = (query, nextMode = state.mode) => {
    cancel()
    const requestId = generation
    publish({ query, mode: nextMode, status: query.length ? 'loading' : 'idle',
      matches: [], truncated: false, error: null, activeIndex: 0 })
    if (!query.length) return
    timer = setTimeout(async () => {
      try {
        const result = await search(query, nextMode)
        if (requestId !== generation) return
        publish({ ...state, ...result, status: 'success' })
      } catch (error) {
        if (requestId !== generation) return
        publish({ ...state, status: 'error', error: error.message })
      }
    }, delay)
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update,
    select: (index) => {
      if (index >= 0 && index < state.matches.length) publish({ ...state, activeIndex: index })
    },
    cancel,
  }
}
