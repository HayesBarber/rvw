import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { centerComparisonEndpoint, createComparisonPickerActionAdapter, focusComparisonEndpoint } from '../../actions/comparison-picker-actions.js'
import { comparisonEndpoints, comparisonPair, createComparisonSubmitHandler, toggleComparisonEndpoint } from '../../review/comparison-selection.js'

const notBlocked = () => false

export function CommitRangePickerContent({ disabled = false, state, selected, onToggle, onSubmit, onRetry, listRef, onFocus }) {
  const loaded = state.status === 'success'
  const endpoints = comparisonEndpoints(loaded ? state.data : [])
  const pair = loaded ? comparisonPair(endpoints, selected) : null
  const targetIndex = pair ? endpoints.indexOf(pair.target) : -1
  const baseIndex = pair ? endpoints.indexOf(pair.base) : -1

  return (
    <div className="comparison-picker">
      <div className="comparison-picker-scroll">
        {(state.status === 'idle' || state.status === 'loading') && <p role="status">Loading commits…</p>}
        {state.status === 'error' && (
          <div className="comparison-picker-error" role="alert">
            <p>Unable to load commits: {state.error}</p>
            <button type="button" data-vim-native-activation disabled={disabled} onClick={onRetry}>Retry</button>
          </div>
        )}
        {loaded && state.data.length === 0 && <p role="status">No commits. Two endpoints are required for a comparison.</p>}
        <ul ref={listRef} className="comparison-picker-list" aria-label="Comparison endpoints">
          {endpoints.map((endpoint, index) => {
            const workingTree = endpoint.kind === 'working-tree'
            const checked = selected.some((item) => item.kind === endpoint.kind && item.sha === endpoint.sha)
            const role = pair?.target === endpoint ? 'Target' : pair?.base === endpoint ? 'Base' : null
            return (
              <li
                key={workingTree ? 'working-tree' : endpoint.sha}
                data-in-comparison={pair && index >= targetIndex && index <= baseIndex ? true : undefined}
                data-comparison-role={role ?? undefined}
              >
                <button
                  type="button"
                  className="comparison-picker-node"
                  data-endpoint={workingTree ? 'working-tree' : endpoint.sha}
                  data-vim-capture
                  onFocus={() => onFocus?.(endpoint)}
                  aria-pressed={checked}
                  disabled={!loaded || disabled}
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
      </div>
      <footer className="comparison-picker-footer">
        <button type="button" className="comparison-picker-submit" data-vim-native-activation disabled={!pair || disabled} onClick={onSubmit}>Review comparison</button>
      </footer>
    </div>
  )
}

export default function CommitRangePicker({ registerActionAdapter, onSelect, request, disabled = false, isBlocked = notBlocked }) {
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  const [selected, setSelected] = useState([])
  const listRef = useRef(null)
  const focusedEndpoint = useRef(null)
  const rememberFocus = useCallback((endpoint) => { focusedEndpoint.current = endpoint }, [])
  const getFocusedEndpoint = useCallback(() => focusedEndpoint.current, [])
  const focus = useCallback((endpoint) => focusComparisonEndpoint(listRef.current, endpoint), [])
  const center = useCallback((endpoint) => centerComparisonEndpoint(listRef.current, endpoint), [])

  const toggle = useCallback((endpoint) => {
    const current = request.getSnapshot()
    if (isBlocked() || current.status !== 'success') return false
    setSelected((previous) => toggleComparisonEndpoint(comparisonEndpoints(current.data), previous, endpoint))
    return true
  }, [isBlocked, request])
  const retry = useCallback(() => {
    if (isBlocked()) return false
    setSelected([])
    return request.load()
  }, [isBlocked, request])
  const submit = useMemo(() => createComparisonSubmitHandler({
    getRequest: request.getSnapshot, getSelection: () => selected, onSelect, isBlocked,
  }), [request, selected, onSelect, isBlocked])

  useLayoutEffect(() => registerActionAdapter(createComparisonPickerActionAdapter({
    getRequest: request.getSnapshot, getFocusedEndpoint, focus, center, toggle, submit,
  })), [registerActionAdapter, request, getFocusedEndpoint, focus, center, toggle, submit])
  useLayoutEffect(() => {
    if (disabled || state.status !== 'success') return
    const endpoints = comparisonEndpoints(state.data)
    const previous = focusedEndpoint.current
    const endpoint = endpoints.find((item) => item.kind === previous?.kind && item.sha === previous?.sha) ?? endpoints[0]
    focus(endpoint)
  }, [disabled, focus, state.data, state.status])

  return <CommitRangePickerContent disabled={disabled} listRef={listRef} onFocus={rememberFocus} state={state} selected={selected} onToggle={toggle} onSubmit={submit} onRetry={retry} />
}
