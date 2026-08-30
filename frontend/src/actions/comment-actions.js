import { ApplicationAction } from './application-actions.js'

// Adapts review comments to the application action vocabulary.

/** Builds a file-level target for a currently open repository path. */
export function fileCommentTarget(path) {
  if (typeof path !== 'string' || path.length === 0) return null
  return { kind: 'file', path }
}

/** Resolves a file target only when displayable text is currently loaded. */
export function openFileCommentTarget(fileDiff) {
  if (
    !fileDiff ||
    (fileDiff.content?.kind !== 'diff' && fileDiff.content?.kind !== 'file')
  ) {
    return null
  }
  return fileCommentTarget(fileDiff.path)
}

/** Builds a single-line target when the cursor still identifies a renderable row. */
export function commentTargetAtCursor(path, cursor, rows) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    !cursor ||
    !Array.isArray(rows) ||
    !Number.isSafeInteger(cursor.lineNumber) ||
    cursor.lineNumber <= 0 ||
    (cursor.side !== 'additions' && cursor.side !== 'deletions') ||
    !rows.some((row) => row?.[cursor.side] === cursor.lineNumber)
  ) {
    return null
  }

  return {
    kind: 'line',
    path,
    side: cursor.side === 'deletions' ? 'old' : 'new',
    startLine: cursor.lineNumber,
    endLine: cursor.lineNumber,
  }
}

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
export function createCommentActionAdapter({
  getAddTarget,
  beginAdd,
  getAddFileTarget,
  beginAddFile,
  getComment,
  beginEdit,
  deleteComment,
}) {
  const invoke = (operation) => {
    const comment = getComment()
    if (!comment) return false
    operation(comment)
    return true
  }

  return Object.freeze({
    [ApplicationAction.ADD_COMMENT]: () => {
      const target = getAddTarget()
      if (!target) return false
      beginAdd(target)
      return true
    },
    [ApplicationAction.ADD_FILE_COMMENT]: () => {
      const target = getAddFileTarget()
      if (!target) return false
      beginAddFile(target)
      return true
    },
    [ApplicationAction.EDIT_COMMENT]: () => invoke(beginEdit),
    [ApplicationAction.DELETE_COMMENT]: () => invoke(deleteComment),
  })
}
