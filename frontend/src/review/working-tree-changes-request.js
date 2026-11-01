import { RequestStatus } from './request-state.js'

/** Keep only the latest working-tree request results. */
export function createWorkingTreeChangesRequest({ listChanges }) {
  let state = { status: RequestStatus.IDLE, files: [], error: null }
  let generation = 0
  const listeners = new Set()
  const publish = (next) => {
    state = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async load() {
      const requestId = ++generation
      publish({ status: RequestStatus.LOADING, files: [], error: null })
      try {
        const { files } = await listChanges()
        if (requestId !== generation) return
        publish({ status: RequestStatus.SUCCESS, files, error: null })
      } catch (error) {
        if (requestId !== generation) return
        publish({ status: RequestStatus.ERROR, files: [], error: error.message })
      }
    },
    cancel() {
      generation += 1
    },
  }
}
