import PaneStatus from './PaneStatus.jsx'

function formatCommentTarget(target) {
  if (target.kind === 'file') {
    return `${target.path} · File comment`
  }

  const side = target.side === 'old' ? 'Old' : 'New'
  const lines =
    target.startLine === target.endLine
      ? `line ${target.startLine}`
      : `lines ${target.startLine}–${target.endLine}`
  return `${target.path} · ${side} ${lines}`
}

export default function ReviewPane({ comments }) {
  if (comments.length === 0) {
    return <PaneStatus>No comments in this review.</PaneStatus>
  }

  return (
    <div className="comments">
      {comments.map((comment) => (
        <article className="comment" key={comment.id}>
          <p className="comment-target">{formatCommentTarget(comment.target)}</p>
          <p>{comment.body}</p>
        </article>
      ))}
    </div>
  )
}

