import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'
import { listWorkingTreeChanges } from '../../review/api.js'
import { createWorkingTreeChangesRequest } from '../../review/working-tree-changes-request.js'
import WorkingTreePickerTree from './WorkingTreePickerTree.jsx'

export function WorkingTreePickerView({ status, files, error, onRetry, registerActionAdapter }) {
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
        <WorkingTreePickerTree files={files} registerActionAdapter={registerActionAdapter} />
      ))}
    </div>
  )
}

export default function WorkingTreePicker({ registerActionAdapter }) {
  const [request] = useState(() => createWorkingTreeChangesRequest({ listChanges: listWorkingTreeChanges }))
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)

  useEffect(() => {
    request.load()
    return () => request.cancel()
  }, [request])
  const hasTree = state.status === 'success' && state.files.length > 0
  useLayoutEffect(() => {
    if (!hasTree) return registerActionAdapter(blockingOverlayActions)
  }, [hasTree, registerActionAdapter])
  return <WorkingTreePickerView {...state} onRetry={request.load} registerActionAdapter={registerActionAdapter} />
}
