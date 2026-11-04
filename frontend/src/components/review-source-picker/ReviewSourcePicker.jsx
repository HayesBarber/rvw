import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { blockingOverlayActions, OverlayKind } from '../../actions/overlay-actions.js'
import { createReviewSourcePickerModeActionRegistry } from '../../actions/review-source-picker-mode-actions.js'
import { createReviewSourcePickerActionAdapter } from '../../actions/review-source-picker-actions.js'
import { createCommitsRequest } from '../../review/commits-request.js'
import { createPullRequestsRequest } from '../../review/pull-requests-request.js'
import Overlay from '../Overlay.jsx'
import { RequestStatus } from '../../review/request-state.js'
import ReviewSourceModeControl from './ReviewSourceModeControl.jsx'
import CommitRangePicker from './CommitRangePicker.jsx'
import PullRequestPicker from './PullRequestPicker.jsx'

const notBlocked = () => false

export function ReviewSourcePickerContent({ disabled = false, isBlocked = notBlocked, mode, registerActionAdapter, onSelectPullRequest, onSelectComparison, commitsRequest, pullRequestsRequest }) {
  switch (mode) {
    case 'commits': return <CommitRangePicker disabled={disabled} isBlocked={isBlocked} registerActionAdapter={registerActionAdapter} onSelect={onSelectComparison} request={commitsRequest} />
    case 'pull-requests': return <PullRequestPicker disabled={disabled} isBlocked={isBlocked} registerActionAdapter={registerActionAdapter} onSelect={onSelectPullRequest} request={pullRequestsRequest} />
    default: return null
  }
}

export function ReviewSourcePickerStatus({ request }) {
  if (request?.status === RequestStatus.LOADING) {
    return <p className="review-source-picker-status" role="status">Loading selected review…</p>
  }
  if (request?.status === RequestStatus.ERROR) {
    return (
      <div className="review-source-picker-status" role="alert">
        <span>{request.error}</span>
        {request.data && <button type="button" data-vim-native-activation onClick={() => request.reload()}>Retry loading review</button>}
      </div>
    )
  }
  return null
}

export default function ReviewSourcePicker({ onClose, registerActionAdapter, onSelectPullRequest, onSelectComparison, reloadRequest }) {
  const isBlocked = reloadRequest?.isLocked ?? notBlocked
  const disabled = isBlocked()
  const dialogRef = useRef(null)
  const titleId = useId()
  const [mode, setMode] = useState('commits')
  const [actions, setActions] = useState(blockingOverlayActions)
  const [modeActions] = useState(() => createReviewSourcePickerModeActionRegistry(setActions))
  const [commitsRequest] = useState(createCommitsRequest)
  const [pullRequestsRequest] = useState(createPullRequestsRequest)

  useEffect(() => {
    commitsRequest.load()
    pullRequestsRequest.load()
    return () => {
      commitsRequest.cancel()
      pullRequestsRequest.cancel()
    }
  }, [commitsRequest, pullRequestsRequest])

  const changeMode = useCallback((nextMode) => {
    if (isBlocked() || nextMode === mode) return
    modeActions.clear()
    setMode(nextMode)
  }, [isBlocked, mode, modeActions])
  const pickerActions = useMemo(() => createReviewSourcePickerActionAdapter({
    mode, modeActions: actions, onChange: changeMode, isBlocked,
  }), [mode, actions, changeMode, isBlocked])

  const close = useCallback(() => {
    if (!isBlocked()) onClose()
  }, [isBlocked, onClose])

  return (
    <Overlay
      kind={OverlayKind.REVIEW_SOURCE_PICKER}
      actions={pickerActions}
      registerActionAdapter={registerActionAdapter}
      dialogRef={dialogRef}
      initialFocusRef={dialogRef}
      nativeDialog
      className="review-source-picker-dialog"
      labelledBy={titleId}
      onClose={close}
    >
      <header className="review-source-picker-header">
        <h2 id={titleId}>Choose review source</h2>
        <button
          type="button"
          data-vim-native-activation
          onClick={close}
          disabled={disabled}
          aria-label="Close review source picker"
        >
          Close
        </button>
      </header>
      <ReviewSourceModeControl mode={mode} onChange={changeMode} disabled={disabled} />
      <ReviewSourcePickerStatus request={reloadRequest} />
      <div className="review-source-picker-body" data-mode={mode} aria-busy={disabled}>
        <ReviewSourcePickerContent
          mode={mode}
          disabled={disabled}
          isBlocked={isBlocked}
          registerActionAdapter={modeActions.register}
          onSelectPullRequest={onSelectPullRequest}
          onSelectComparison={onSelectComparison}
          commitsRequest={commitsRequest}
          pullRequestsRequest={pullRequestsRequest}
        />
      </div>
    </Overlay>
  )
}
