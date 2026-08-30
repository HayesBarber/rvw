import { ApplicationAction } from './application-actions.js'

// Adapts review comments to the application action vocabulary.

/** Finds the line comment attached to the active diff cursor. */
export function commentAtCursor(comments, path, cursor) {
  if (!path || !cursor) return null
  const side = cursor.side === 'deletions' ? 'old' : 'new'
  return comments.find((comment) => (
    comment.target.kind === 'line' &&
    comment.target.path === path &&
    comment.target.side === side &&
    comment.target.endLine === cursor.lineNumber
  )) ?? null
}

/** Adds stable contextual comment actions to a diff-pane action adapter. */
export function createCommentActionAdapter({ getComment, beginEdit, beginDelete }) {
  const invoke = (operation) => {
    const comment = getComment()
    if (!comment) return false
    operation(comment)
    return true
  }

  return Object.freeze({
    [ApplicationAction.EDIT_COMMENT]: () => invoke(beginEdit),
    [ApplicationAction.DELETE_COMMENT]: () => invoke(beginDelete),
  })
}
