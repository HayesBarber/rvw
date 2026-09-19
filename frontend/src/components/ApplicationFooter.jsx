import { copyRequestButtonLabel } from '../review/comment-copy-request.js'
import { BLOCKED_DURING_DRAFT_MESSAGE } from '../review/reload-request.js'
import { RequestStatus } from '../review/request-state.js'

function diagnosticText(diagnostic) {
  if (!diagnostic) return null
  return `Keyboard configuration: ${diagnostic.message}. Fix ${diagnostic.path}, then restart rvw. The current keymap remains active.`
}

export default function ApplicationFooter({
  clearMessage,
  clearStatus,
  commentsCount = 0,
  copyMessage,
  copyRequest,
  diagnostic,
  onCopyComments,
  onReload,
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
      <span className="footer-left">
        <span className="keyboard-input-status" aria-live="polite">
          <strong>{vimState.mode.toUpperCase()}</strong>
          {vimState.count && <span>count {vimState.count}</span>}
          {pending && <span>pending {pending}</span>}
          {!vimState.count && !pending && <span>ready</span>}
        </span>
        <span className="application-status">
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
        <strong className="repository-name" title={repositoryName}>
          {repositoryName}
        </strong>
      )}
      <span className="footer-right">
        {repositoryName && (
          <>
            <span className="footer-reload-action">
              <button
                className="reload-button"
                type="button"
                disabled={reloadDisabled}
                title={reloadDisabled ? BLOCKED_DURING_DRAFT_MESSAGE : 'Reload review'}
                onClick={onReload}
              >
                Reload
              </button>
            </span>
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
