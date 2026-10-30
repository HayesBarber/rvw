import { useId, useRef } from 'react'
import { OverlayKind } from '../../actions/overlay-actions.js'
import Overlay from '../Overlay.jsx'

export default function ReviewSourcePicker({ onClose, registerActionAdapter }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  return (
    <Overlay
      kind={OverlayKind.REVIEW_SOURCE_PICKER}
      registerActionAdapter={registerActionAdapter}
      dialogRef={dialogRef}
      initialFocusRef={closeRef}
      nativeDialog
      className="review-source-picker-dialog"
      labelledBy={titleId}
      onClose={onClose}
    >
      <header className="review-source-picker-header">
        <h2 id={titleId}>Choose review source</h2>
        <button
          ref={closeRef}
          type="button"
          data-vim-ignore
          onClick={onClose}
          aria-label="Close review source picker"
        >
          Close
        </button>
      </header>
      <div className="review-source-picker-body" />
    </Overlay>
  )
}
