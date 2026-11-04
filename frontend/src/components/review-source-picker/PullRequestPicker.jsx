import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { centerPullRequestTile, createPullRequestPickerActionAdapter, createPullRequestSubmitHandler, focusPullRequestTile } from '../../actions/pull-request-picker-actions.js'

const notBlocked = () => false

export function PullRequestPickerContent({ disabled = false, state, onSubmit, onRetry, listRef, onFocus }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <p role="status">Loading pull requests…</p>
  }
  if (state.status === 'error') {
    return (
      <div className="pull-request-picker-error" role="alert">
        <p>Unable to load pull requests: {state.error}</p>
        <button type="button" data-vim-native-activation disabled={disabled} onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (state.data.length === 0) return <p role="status">No open pull requests.</p>

  return (
    <ul ref={listRef} className="pull-request-picker-list" aria-label="Open pull requests">
      {state.data.map((pullRequest) => (
        <li key={pullRequest.number}>
          <button
            type="button"
            className="pull-request-picker-tile"
            data-vim-native-activation
            data-pull-request-number={pullRequest.number}
            onFocus={() => onFocus?.(pullRequest.number)}
            disabled={disabled}
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

export default function PullRequestPicker({ registerActionAdapter, onSelect, request, disabled = false, isBlocked = notBlocked }) {
  const listRef = useRef(null)
  const focusedNumber = useRef(null)
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  const rememberFocus = useCallback((number) => { focusedNumber.current = number }, [])
  const getFocusedNumber = useCallback(() => focusedNumber.current, [])
  const focus = useCallback((number) => focusPullRequestTile(listRef.current, number), [])
  const center = useCallback((number) => centerPullRequestTile(listRef.current, number), [])
  const submit = useMemo(() => createPullRequestSubmitHandler({
    getRequest: request.getSnapshot, onSelect, isBlocked,
  }), [isBlocked, onSelect, request])

  useLayoutEffect(() => registerActionAdapter(createPullRequestPickerActionAdapter({
    getRequest: request.getSnapshot,
    getFocusedNumber,
    focus,
    center,
    submit,
  })), [center, focus, getFocusedNumber, registerActionAdapter, request, submit])
  useLayoutEffect(() => {
    if (disabled || state.status !== 'success' || state.data.length === 0) return
    const number = state.data.some((item) => item.number === focusedNumber.current)
      ? focusedNumber.current : state.data[0].number
    focus(number)
  }, [disabled, focus, state.data, state.status])
  const retry = useCallback(() => {
    if (!isBlocked()) return request.load()
  }, [isBlocked, request])

  return <PullRequestPickerContent disabled={disabled} state={state} onSubmit={submit} onRetry={retry} listRef={listRef} onFocus={rememberFocus} />
}
