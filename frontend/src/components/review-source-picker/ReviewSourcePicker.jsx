import { useId, useRef, useState } from 'react'
import { OverlayKind } from '../../actions/overlay-actions.js'
import Overlay from '../Overlay.jsx'
import ReviewSourceModeControl from './ReviewSourceModeControl.jsx'

export default function ReviewSourcePicker({ onClose, registerActionAdapter }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const [mode, setMode] = useState('commits')

  return (
    <Overlay
      kind={OverlayKind.REVIEW_SOURCE_PICKER}
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
      <ReviewSourceModeControl mode={mode} onChange={setMode} />
      <div className="review-source-picker-body" />
    </Overlay>
  )
}
