import { useEffect, useId, useRef, useState } from 'react'
import { reviewSourceLabel } from '../review/source-label.js'
import { BLOCKED_DURING_DRAFT_MESSAGE } from '../review/reload-request.js'
import { filePathCopyRequestMessage } from '../review/file-path-copy-request.js'
import { RequestStatus } from '../review/request-state.js'

function diagnosticText(diagnostic) {
  if (!diagnostic) return null
  return `Configuration: ${diagnostic.message}. Fix ${diagnostic.path}, then restart Rvw. The current configuration remains active.`
}

export function FooterActionsMenu({ id, onReload, onSearchText, onChooseReviewSource, reloadDisabled }) {
  return (
    <span id={id} className="footer-actions-popover" role="group" aria-label="More actions">
      <button
        className="footer-actions-item"
        type="button"
        aria-haspopup="dialog"
        onClick={onChooseReviewSource}
      >
        Choose review source…
      </button>
      <button
        className="footer-actions-item"
        type="button"
        disabled={reloadDisabled}
        title={reloadDisabled ? BLOCKED_DURING_DRAFT_MESSAGE : 'Reload review'}
        onClick={onReload}
      >
        Reload
      </button>
      <button className="footer-actions-item" type="button" onClick={onSearchText}>
        Search text
      </button>
    </span>
  )
}

function FooterActions({ onReload, onSearchText, onChooseReviewSource, reloadDisabled }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function selectAction(action) {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
    action()
  }

  return (
    <span
      ref={containerRef}
      className="footer-actions"
      data-vim-ignore
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="footer-actions-trigger"
        type="button"
        aria-label="More actions"
        title="More actions"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && (
        <FooterActionsMenu
          id={popoverId}
          onChooseReviewSource={() => selectAction(onChooseReviewSource)}
          onReload={() => selectAction(onReload)}
          onSearchText={() => selectAction(onSearchText)}
          reloadDisabled={reloadDisabled}
        />
      )}
    </span>
  )
}

export default function ApplicationFooter({
  commandError,
  commandLine,
  clearMessage,
  clearStatus,
  commentsCount = 0,
  commentsOpen = false,
  copyMessage,
  copyRequest,
  diagnostic,
  onToggleComments,
  onReload,
  onSearchText,
  onChooseReviewSource,
  overview,
  pathCopyRequest,
  reloadDisabled = false,
  reloadMessage,
  reloadMessageIsError = false,
  reloadStatus,
  repositoryName,
  vimState,
}) {
  const pathCopyMessage = pathCopyRequest ? filePathCopyRequestMessage(pathCopyRequest) : ''
  const pending = vimState.pendingKeys.join(' ')
  const problem = diagnosticText(diagnostic)
  const copyIsError = copyRequest?.status === RequestStatus.ERROR

  return (
    <footer className="application-footer">
      {commandLine}
      <span className="footer-left">
        <span className="keyboard-input-status" aria-live="polite">
          <strong>{vimState.mode.toUpperCase()}</strong>
          {vimState.count && <span>count {vimState.count}</span>}
          {pending && <span>pending {pending}</span>}
          {!vimState.count && !pending && <span>ready</span>}
        </span>
        <span className="application-status">
          {commandError && (
            <span id="command-line-error" className="command-line-error" role="alert">
              {commandError}
            </span>
          )}
          {problem && (
            <span className="keyboard-diagnostic" role="alert" title={problem}>
              {problem}
            </span>
          )}
          {pathCopyMessage && (
            <span
              className={`file-path-copy-status ${pathCopyRequest.status}`}
              role={pathCopyRequest.status === RequestStatus.ERROR ? 'alert' : 'status'}
            >
              {pathCopyMessage}
            </span>
          )}
          {reloadMessage && (
            <span
              className={`reload-status ${reloadMessageIsError ? RequestStatus.ERROR : reloadStatus}`}
              role={reloadMessageIsError ? 'alert' : 'status'}
            >
              {reloadMessage}
            </span>
          )}
        </span>
      </span>
      {repositoryName && (
        <span className="repository-context">
          <strong className="repository-name" title={repositoryName}>{repositoryName}</strong>
          {overview && (
            <span className="review-source" title={reviewSourceLabel(overview)}>
              {reviewSourceLabel(overview, true)}
            </span>
          )}
        </span>
      )}
      <span className="footer-right">
        {repositoryName && (
          <>
            <span className="footer-comments-status">
              {clearMessage && (
                <span
                  className={`clear-status ${clearStatus}`}
                  role={clearStatus === RequestStatus.ERROR ? 'alert' : 'status'}
                  title={clearMessage}
                >
                  {clearMessage}
                </span>
              )}
              {copyMessage && (
                <span
                  className={`copy-status ${copyRequest?.status}`}
                  role={copyIsError ? 'alert' : 'status'}
                  title={copyMessage}
                >
                  {copyMessage}
                </span>
              )}
            </span>
            <FooterActions
              onReload={onReload}
              onSearchText={onSearchText}
              onChooseReviewSource={onChooseReviewSource}
              reloadDisabled={reloadDisabled}
            />
            <span className="footer-comments-action">
              <button
                className="comments-button"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={commentsOpen}
                onClick={onToggleComments}
              >
                <span aria-live="polite">Comments ({commentsCount})</span>
                <svg className="comments-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d={commentsOpen ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'} />
                </svg>
              </button>
            </span>
          </>
        )}
      </span>
    </footer>
  )
}
