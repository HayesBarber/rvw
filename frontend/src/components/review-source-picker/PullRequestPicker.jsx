import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPullRequestSubmitHandler } from '../../actions/pull-request-picker-actions.js'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'
import { createPullRequestsRequest } from '../../review/pull-requests-request.js'

export function PullRequestPickerContent({ state, onSubmit, onRetry }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <p role="status">Loading pull requests…</p>
  }
  if (state.status === 'error') {
    return (
      <div className="pull-request-picker-error" role="alert">
        <p>Unable to load pull requests: {state.error}</p>
        <button type="button" data-vim-native-activation onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (state.data.length === 0) return <p role="status">No open pull requests.</p>

  return (
    <ul className="pull-request-picker-list" aria-label="Open pull requests">
      {state.data.map((pullRequest) => (
        <li key={pullRequest.number}>
          <button
            type="button"
            className="pull-request-picker-tile"
            data-vim-native-activation
            onClick={() => onSubmit(pullRequest.number)}
          >
            <span className="pull-request-picker-title">
              <span className="pull-request-picker-number">#{pullRequest.number}</span>
              <strong>{pullRequest.title}</strong>
              {pullRequest.isDraft && <span className="pull-request-picker-draft">Draft</span>}
            </span>
            <span className="pull-request-picker-author">{pullRequest.authorLogin}</span>
            <span className="pull-request-picker-branches">
              <span>Base: {pullRequest.baseRefName}</span>
              <span>Head: {pullRequest.headRefName}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function PullRequestPicker({ registerActionAdapter, onSelect }) {
  const [request] = useState(createPullRequestsRequest)
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  const submit = useMemo(() => createPullRequestSubmitHandler({
    getRequest: request.getSnapshot, onSelect,
  }), [onSelect, request])

  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])
  useEffect(() => {
    request.load()
    return () => request.cancel()
  }, [request])

  return <PullRequestPickerContent state={state} onSubmit={submit} onRetry={request.load} />
}
