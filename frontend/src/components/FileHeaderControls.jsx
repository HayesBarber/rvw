import { filePathCopyRequestMessage } from '../review/file-path-copy-request.js'
import { RequestStatus } from '../review/request-state.js'

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M5 1.75A1.75 1.75 0 0 1 6.75 0h7.5A1.75 1.75 0 0 1 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11H13V9.5h1.25a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5a.25.25 0 0 0-.25.25V3H5V1.75Z" />
      <path d="M1.75 5h7.5A1.75 1.75 0 0 1 11 6.75v7.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5A1.75 1.75 0 0 1 1.75 5Zm0 1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M13.78 3.72a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 8.78a.75.75 0 0 1 1.06-1.06L6 10.44l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  )
}

export function FilePathCopyControl({ path, request, onCopy }) {
  const message = filePathCopyRequestMessage(request)
  const succeeded = request.status === RequestStatus.SUCCESS
  const failed = request.status === RequestStatus.ERROR

  return (
    <span className="file-path-copy-control">
      <button
        className="file-path-copy-button"
        type="button"
        disabled={!path || request.status === RequestStatus.LOADING}
        title="Copy repository-relative path"
        aria-label="Copy repository-relative path"
        onClick={() => onCopy(path, 'relative')}
      >
        {succeeded ? <CheckIcon /> : <CopyIcon />}
      </button>
      {message && (
        <span
          className={`file-path-copy-status ${request.status} ${failed ? '' : 'visually-hidden'}`}
          role={failed ? 'alert' : 'status'}
          title={failed ? message : undefined}
        >
          {message}
        </span>
      )}
    </span>
  )
}

export function FileHeaderActions({ canCommentOnFile, onCommentOnFile }) {
  return (
    <span className="file-header-actions">
      <button
        className="file-comment-button"
        type="button"
        disabled={!canCommentOnFile}
        onClick={onCommentOnFile}
      >
        Comment on file
      </button>
    </span>
  )
}
