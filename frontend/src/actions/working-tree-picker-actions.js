import { ApplicationAction } from './application-actions.js'

/** Read the current request state when either submit control runs. */
export function createWorkingTreePickerSubmit({ getSnapshot, onSelect }) {
  return () => {
    if (getSnapshot().status !== 'success') return false
    onSelect?.({ kind: 'working-tree', base: 'HEAD' })
    return true
  }
}

export function createWorkingTreePickerActionAdapter(onSubmit, treeActions = {}) {
  return {
    ...treeActions,
    [ApplicationAction.OVERLAY_SUBMIT]: onSubmit,
  }
}
