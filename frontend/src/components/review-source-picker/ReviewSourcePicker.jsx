import { useId, useRef, useState } from 'react'
import { OverlayKind } from '../../actions/overlay-actions.js'
import { createReviewSourcePickerActionRouter } from '../../actions/review-source-picker-routing.js'
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
  const [modeActions] = useState(createReviewSourcePickerActionRouter)

  function changeMode(nextMode) {
    if (nextMode === mode) return
    modeActions.clear()
    setMode(nextMode)
  }

  return (
    <Overlay
      kind={OverlayKind.REVIEW_SOURCE_PICKER}
      actions={modeActions.actions}
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
          data-vim-ignore
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
