import { useEffect, useId, useRef, useState } from 'react'
import { reviewSourceLabel } from '../review/source-label.js'
import { copyRequestButtonLabel } from '../review/comment-copy-request.js'
import { BLOCKED_DURING_DRAFT_MESSAGE } from '../review/reload-request.js'
import { RequestStatus } from '../review/request-state.js'

function diagnosticText(diagnostic) {
  if (!diagnostic) return null
  return `Configuration: ${diagnostic.message}. Fix ${diagnostic.path}, then restart Rvw. The current configuration remains active.`
}

function FooterActions({ onReload, onSearchText, reloadDisabled }) {
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

  function handleKeyDown(event) {
    if (!open || event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  return (
    <span
      ref={containerRef}
      className="footer-actions"
      data-vim-ignore
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="footer-actions-trigger"
        type="button"
        aria-label="More actions"
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
        <span id={popoverId} className="footer-actions-popover" role="group" aria-label="More actions">
          <button
            className="footer-actions-item"
            type="button"
            disabled={reloadDisabled}
            title={reloadDisabled ? BLOCKED_DURING_DRAFT_MESSAGE : 'Reload review'}
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus({ preventScroll: true })
              onReload()
            }}
          >
            Reload
          </button>
          <button
            className="footer-actions-item"
            type="button"
            onClick={() => {
              setOpen(false)
              triggerRef.current?.focus({ preventScroll: true })
              onSearchText()
            }}
          >
            Search text
          </button>
        </span>
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
  copyMessage,
  copyRequest,
  diagnostic,
  onCopyComments,
  onReload,
  onSearchText,
  overview,
  reloadDisabled = false,
  reloadMessage,
  reloadMessageIsError = false,
  reloadStatus,
  repositoryName,
  vimState,
}) {
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
          {clearMessage && (
            <span
              className={`clear-status ${clearStatus}`}
              role={clearStatus === RequestStatus.ERROR ? 'alert' : 'status'}
            >
              {clearMessage}
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
            <FooterActions
              onReload={onReload}
              onSearchText={onSearchText}
              reloadDisabled={reloadDisabled}
            />
            <span className="footer-copy-action">
              {copyIsError && (
                <span className="copy-status error" role="alert" title={copyMessage}>
                  {copyMessage}
                </span>
              )}
              <button
                className="copy-markdown-button"
                type="button"
                disabled={commentsCount === 0 || copyRequest.status === RequestStatus.LOADING}
                title={commentsCount === 0 ? 'Add a comment before copying' : undefined}
                onClick={onCopyComments}
              >
                <span aria-live="polite">{copyRequestButtonLabel(copyRequest)}</span>
              </button>
            </span>
          </>
        )}
      </span>
    </footer>
  )
}
