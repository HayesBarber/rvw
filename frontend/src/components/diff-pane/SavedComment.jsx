import { useLayoutEffect, useRef } from 'react'

import CommentEditor from './CommentEditor.jsx'

export default function SavedComment({
  active,
  comment,
  commentTypes,
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
      data-active={active ? '' : undefined}
      data-comment-kind={comment.target.kind}
      tabIndex={0}
      onFocus={() => onActivate(comment.id)}
      onPointerDown={() => onActivate(comment.id)}
    >
      <header>
        <span className="saved-comment-labels">
          <span>{lineLabel}</span>
          {comment.commentType && (
            <span className="comment-type-badge">{comment.commentType}</span>
          )}
        </span>
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
        <CommentEditor
          comment={comment}
          commentTypes={commentTypes}
          onCancel={onCancelEdit}
          onSave={onEdit}
        />
      ) : (
        <p>{comment.body}</p>
      )}
      {deleteError && <p className="comment-error" role="alert">{deleteError}</p>}
    </article>
  )
}
