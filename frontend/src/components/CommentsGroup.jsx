import { commentLocation } from '../actions/comments-list-actions.js'

function targetLabel(target) {
  if (target.kind === 'review') return 'Review comment'
  if (target.kind === 'file') return 'File comment'
  const lines = target.startLine === target.endLine
    ? `Line ${target.startLine}`
    : `Lines ${target.startLine}–${target.endLine}`
  return `${target.side === 'old' ? 'Old' : 'New'} ${lines.toLowerCase()}`
}

export default function CommentsGroup({
  group, headingId, selectedId, busy, canEdit, canDelete, deletingId,
  onSelectComment, onOpenLocation, onEditComment, onDeleteComment,
}) {
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      className="comments-group"
    >
      <h3 id={headingId}>
        {group.kind === 'review' ? 'Review comments' : group.path}
      </h3>
      {group.comments.map((comment) => (
        <article
          id={`saved-comment-${comment.id}`}
          key={comment.id}
          role="option"
          aria-selected={selectedId === comment.id}
          tabIndex={0}
          className="comments-item"
          onFocus={() => { if (!busy) onSelectComment(comment.id) }}
          onClick={() => { if (!busy) onSelectComment(comment.id) }}
        >
          <header>
            <span>{targetLabel(comment.target)}</span>
            {comment.commentType && <span className="comment-type-badge">{comment.commentType}</span>}
            {comment.target.kind !== 'review' && (
              <a
                className="comment-location-link"
                href={`#${encodeURIComponent(comment.target.path)}`}
                data-vim-ignore
                aria-disabled={busy || undefined}
                aria-label={`Open ${targetLabel(comment.target).toLowerCase()} on ${comment.target.path}`}
                onClick={(event) => {
                  event.preventDefault()
                  if (busy) return
                  onOpenLocation(commentLocation(comment))
                }}
              >
                Open location
              </a>
            )}
            <button
              type="button"
              className="comments-item-edit"
              data-vim-ignore
              disabled={!canEdit || busy}
              aria-label={`Edit ${targetLabel(comment.target).toLowerCase()}${comment.target.path ? ` on ${comment.target.path}` : ''}`}
              onClick={() => onEditComment(comment)}
            >
              Edit
            </button>
            <button
              type="button"
              className="comments-item-delete"
              data-vim-ignore
              disabled={!canDelete || busy}
              aria-label={`Delete ${targetLabel(comment.target).toLowerCase()}${comment.target.path ? ` on ${comment.target.path}` : ''}`}
              onClick={() => onDeleteComment(comment)}
            >
              {deletingId === comment.id ? 'Deleting…' : 'Delete'}
            </button>
          </header>
          <p>{comment.body}</p>
        </article>
      ))}
    </section>
  )
}
