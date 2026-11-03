import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { blockingOverlayActions } from '../../actions/overlay-actions.js'
import { createCommitsRequest } from '../../review/commits-request.js'
import { comparisonEndpoints, comparisonPair, createComparisonSubmitHandler, toggleComparisonEndpoint } from '../../review/comparison-selection.js'

export function CommitRangePickerContent({ state, selected, onToggle, onSubmit, onRetry }) {
  const loaded = state.status === 'success'
  const endpoints = comparisonEndpoints(loaded ? state.data : [])
  const pair = loaded ? comparisonPair(endpoints, selected) : null

  return (
    <div className="comparison-picker">
      <p className="comparison-picker-help">Compare the file state at Base with the file state at Target.</p>
      <p className="comparison-picker-help">Select two endpoints. A new selection replaces the nearest endpoint. Equal distances replace Base.</p>
      {(state.status === 'idle' || state.status === 'loading') && <p role="status">Loading commits…</p>}
      {state.status === 'error' && (
        <div className="comparison-picker-error" role="alert">
          <p>Unable to load commits: {state.error}</p>
          <button type="button" data-vim-native-activation onClick={onRetry}>Retry</button>
        </div>
      )}
      {loaded && state.data.length === 0 && <p role="status">No commits. Two endpoints are required for a comparison.</p>}
      <ul className="comparison-picker-list" aria-label="Comparison endpoints">
        {endpoints.map((endpoint) => {
          const workingTree = endpoint.kind === 'working-tree'
          const checked = selected.some((item) => item.kind === endpoint.kind && item.sha === endpoint.sha)
          const role = pair?.target === endpoint ? 'Target' : pair?.base === endpoint ? 'Base' : null
          return (
            <li key={workingTree ? 'working-tree' : endpoint.sha}>
              <button
                type="button"
                className="comparison-picker-node"
                data-endpoint={workingTree ? 'working-tree' : endpoint.sha}
                data-vim-native-activation
                aria-pressed={checked}
                disabled={!loaded}
                onClick={() => onToggle(endpoint)}
              >
                <span className={`comparison-picker-marker${workingTree ? ' comparison-picker-marker-working-tree' : ''}`} aria-hidden="true">{checked ? '✓' : ''}</span>
                <span className="comparison-picker-details">
                  <span className="comparison-picker-title">
                    {workingTree ? <strong>Working tree</strong> : <><code>{endpoint.sha.slice(0, 7)}</code><strong>{endpoint.subject}</strong></>}
                    {role && <span className="comparison-picker-role">{role}</span>}
                  </span>
                  {!workingTree && (
                    <span className="comparison-picker-metadata">
                      <span>{endpoint.authorName}</span>
                      <time dateTime={endpoint.commitDate} title={endpoint.commitDate}>{endpoint.commitDate.slice(0, 10)}</time>
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="comparison-picker-help">Lines show list order. They do not show branch or merge relationships.</p>
      <button type="button" className="comparison-picker-submit" data-vim-native-activation disabled={!pair} onClick={onSubmit}>Review comparison</button>
    </div>
  )
}

export default function CommitRangePicker({ registerActionAdapter, onSelect, request: providedRequest }) {
  const [request] = useState(() => providedRequest ?? createCommitsRequest())
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  const [selected, setSelected] = useState([])

  useEffect(() => {
    request.load()
    return () => request.cancel()
  }, [request])
  useLayoutEffect(() => registerActionAdapter(blockingOverlayActions), [registerActionAdapter])

  const toggle = useCallback((endpoint) => {
    const current = request.getSnapshot()
    if (current.status !== 'success') return
    setSelected((previous) => toggleComparisonEndpoint(comparisonEndpoints(current.data), previous, endpoint))
  }, [request])
  const retry = useCallback(() => {
    setSelected([])
    return request.load()
  }, [request])
  const submit = useMemo(() => createComparisonSubmitHandler({
    getRequest: request.getSnapshot, getSelection: () => selected, onSelect,
  }), [request, selected, onSelect])

  return <CommitRangePickerContent state={state} selected={selected} onToggle={toggle} onSubmit={submit} onRetry={retry} />
}
