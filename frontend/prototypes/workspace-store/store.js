// Evaluation only: no production entry point imports this module.
import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import { initialWorkspaceState, workspaceReducer } from '../../src/app/workspace.js'
import {
  createFilesModeEntries,
  includeSelectedFile,
  selectActivePath,
  selectVisibleFiles,
} from '../../src/review/review-session.js'
import { RequestStatus } from '../../src/review/request-state.js'

export const selectTreeMode = (state) => state.treeMode

// Request snapshots remain owned by hooks. React reruns this selector when its
// props change; imperative subscribers must unsubscribe/rebind for new inputs.
export function activePathSelector({ overview, paths = [], status = RequestStatus.IDLE }) {
  return (state) => {
    const entries = createFilesModeEntries(overview, paths)
    const files = status === RequestStatus.SUCCESS
      ? entries
      : includeSelectedFile(entries, state.selectedPath)
    return selectActivePath(
      selectVisibleFiles(overview, files, state.treeMode),
      state.selectedPath,
      overview?.initialPath,
    )
  }
}

// One factory call per mounted review session. No singleton, persistence,
// request cache, DOM refs, action adapters, Vim state, or renderer models.
export function createWorkspaceSession() {
  const store = createStore(subscribeWithSelector(() => ({ ...initialWorkspaceState })))
  const dispatch = (action) => store.setState(
    (state) => workspaceReducer(state, action),
    true,
  )
  return { store, dispatch }
}
