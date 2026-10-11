import { DiffCursorSide, fileLineCount } from './diff-cursor-actions.js'

/** Resolve a source line in the open file, including collapsed diff context. */
export function currentFileLineTarget(file, cursor, lineNumber) {
  if (!file?.path || !Number.isSafeInteger(lineNumber) || lineNumber < 1) return null
  const content = file.content
  let side = 'new'
  let count = 0
  if (content?.kind === 'file') {
    count = fileLineCount(content.file.contents)
  } else if (content?.kind === 'diff' && file.parsedDiff) {
    side = cursor?.side === DiffCursorSide.DELETIONS ? 'old' : 'new'
    count = (side === 'old' ? file.parsedDiff.deletionLines : file.parsedDiff.additionLines).length
  }
  return lineNumber <= count ? { path: file.path, lineNumber, side } : null
}

/** Navigate the open file from either workspace surface. */
export function createCurrentFileLineNavigation({ getTarget, dispatchWorkspace, focusDiffPane }) {
  return (lineNumber) => {
    const location = getTarget(lineNumber)
    if (!location) return false
    dispatchWorkspace({ type: 'line_navigation_requested', location })
    focusDiffPane()
    return true
  }
}
