import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { blockingOverlayActions, OverlayKind } from '../../actions/overlay-actions.js'
import { createReviewSourcePickerModeActionRegistry } from '../../actions/review-source-picker-mode-actions.js'
import { createReviewSourcePickerActionAdapter } from '../../actions/review-source-picker-actions.js'
import Overlay from '../Overlay.jsx'
import ReviewSourceModeControl from './ReviewSourceModeControl.jsx'
import CommitRangePicker from './CommitRangePicker.jsx'
import PullRequestPicker from './PullRequestPicker.jsx'
import WorkingTreePicker from './WorkingTreePicker.jsx'

export function ReviewSourcePickerContent({ mode, registerActionAdapter }) {
  switch (mode) {
    case 'commits': return <CommitRangePicker registerActionAdapter={registerActionAdapter} />
    case 'pull-requests': return <PullRequestPicker registerActionAdapter={registerActionAdapter} />
    case 'working-tree': return <WorkingTreePicker registerActionAdapter={registerActionAdapter} />
    default: return null
  }
}

export default function ReviewSourcePicker({ onClose, registerActionAdapter }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const [mode, setMode] = useState('commits')
  const [actions, setActions] = useState(blockingOverlayActions)
  const [modeActions] = useState(() => createReviewSourcePickerModeActionRegistry(setActions))

  const changeMode = useCallback((nextMode) => {
    if (nextMode === mode) return
    modeActions.clear()
    setMode(nextMode)
  }, [mode, modeActions])
  const pickerActions = useMemo(() => createReviewSourcePickerActionAdapter({
    mode, modeActions: actions, onChange: changeMode,
  }), [mode, actions, changeMode])

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
      onClose={onClose}
    >
      <header className="review-source-picker-header">
        <h2 id={titleId}>Choose review source</h2>
        <button
          type="button"
          data-vim-native-activation
          onClick={onClose}
          aria-label="Close review source picker"
        >
          Close
        </button>
      </header>
      <ReviewSourceModeControl mode={mode} onChange={changeMode} />
      <div className="review-source-picker-body">
        <ReviewSourcePickerContent mode={mode} registerActionAdapter={modeActions.register} />
      </div>
    </Overlay>
  )
}
