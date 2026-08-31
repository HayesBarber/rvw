import { useLayoutEffect, useRef } from 'react'

import CommentEditor from './CommentEditor.jsx'

export default function SavedComment({
  comment,
  deleteError,
  deleting,
  editing,
  onActivate,
  onBeginEdit,
  onCancelEdit,
  onDelete,
  onEdit,
}) {
  const editButtonRef = useRef(null)
  const wasEditingRef = useRef(editing)
  const lineLabel = comment.target.kind === 'line'
    ? (comment.target.startLine === comment.target.endLine
        ? `Line ${comment.target.startLine}`
        : `Lines ${comment.target.startLine}–${comment.target.endLine}`)
    : 'File comment'

  useLayoutEffect(() => {
    if (wasEditingRef.current && !editing) {
      editButtonRef.current?.focus({ preventScroll: true })
    }
    wasEditingRef.current = editing
  }, [editing])

  return (
    <article
      className="saved-comment"
      data-comment-kind={comment.target.kind}
      tabIndex={0}
      onFocus={() => onActivate(comment.id)}
      onPointerDown={() => onActivate(comment.id)}
    >
      <header>
        <span>{lineLabel}</span>
        {!editing && (
          <span className="saved-comment-actions">
            <button
              ref={editButtonRef}
              type="button"
              aria-label={`Edit comment on ${lineLabel}`}
              onClick={() => onBeginEdit(comment)}
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`Delete comment on ${lineLabel}`}
              disabled={deleting}
              onClick={() => onDelete(comment)}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </span>
        )}
      </header>
      {editing ? (
        <CommentEditor comment={comment} onCancel={onCancelEdit} onSave={onEdit} />
      ) : (
        <p>{comment.body}</p>
      )}
      {deleteError && <p className="comment-error" role="alert">{deleteError}</p>}
    </article>
  )
}
