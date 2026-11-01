import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'
import { orderedFilePaths } from '../../actions/file-navigation-actions.js'
import { listWorkingTreeChanges } from '../../review/api.js'
import { createWorkingTreeChangesRequest } from '../../review/working-tree-changes-request.js'

function ChangeCount({ value }) {
  return value == null ? <span aria-label="Unavailable" title="Unavailable">—</span> : value
}

export function WorkingTreePickerView({ status, files, error, onRetry }) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const orderedFiles = orderedFilePaths(files).map((path) => byPath.get(path))

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
      {status === 'success' && (orderedFiles.length === 0 ? (
        <p role="status">No working tree changes.</p>
      ) : (
        <div className="working-tree-picker-files" role="region" aria-label="Working tree changes" tabIndex={0}>
          <table>
            <thead>
              <tr><th scope="col">File</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col">Deleted</th></tr>
            </thead>
            <tbody>
              {orderedFiles.map((file) => (
                <tr key={file.path}>
                  <th scope="row">
                    <span>{file.path}</span>
                    {file.previousPath != null && <span className="working-tree-picker-previous-path">From {file.previousPath}</span>}
                  </th>
                  <td>{file.status}</td>
                  <td><ChangeCount value={file.additions} /></td>
                  <td><ChangeCount value={file.deletions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])
  return <WorkingTreePickerView {...state} onRetry={request.load} />
}
