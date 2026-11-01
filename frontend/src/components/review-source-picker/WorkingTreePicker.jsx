import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { createWorkingTreePickerActionAdapter, createWorkingTreePickerSubmit } from '../../actions/working-tree-picker-actions.js'
import WorkingTreePickerTree from './WorkingTreePickerTree.jsx'

export function WorkingTreePickerView({ status, files, error, onRetry, onSubmit, registerActionAdapter }) {
  return (
    <div className="working-tree-picker" aria-busy={status === 'idle' || status === 'loading'}>
      {(status === 'idle' || status === 'loading') && (
        <p role="status">Loading working tree changes…</p>
      )}
      {status === 'error' && (
        <div className="working-tree-picker-error" role="alert">
          <p>Unable to load working tree changes: {error}</p>
          <button type="button" data-vim-native-activation onClick={onRetry}>Retry</button>
        </div>
      )}
      {status === 'success' && (files.length === 0 ? (
        <p role="status">No working tree changes.</p>
      ) : (
        <WorkingTreePickerTree files={files} onSubmit={onSubmit} registerActionAdapter={registerActionAdapter} />
      ))}
      <div className="working-tree-picker-footer">
        <button type="button" data-vim-native-activation disabled={status !== 'success'} onClick={onSubmit}>
          Review working tree
        </button>
      </div>
    </div>
  )
}

export default function WorkingTreePicker({ request, onSelect, registerActionAdapter }) {
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  const submit = useMemo(() => createWorkingTreePickerSubmit({ getSnapshot: request.getSnapshot, onSelect }), [request, onSelect])

  const hasTree = state.status === 'success' && state.files.length > 0
  useLayoutEffect(() => {
    if (!hasTree) return registerActionAdapter(createWorkingTreePickerActionAdapter(submit))
  }, [hasTree, registerActionAdapter, submit])
  return <WorkingTreePickerView {...state} onRetry={request.load} onSubmit={submit} registerActionAdapter={registerActionAdapter} />
}
