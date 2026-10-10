import { ApplicationAction } from './application-actions.js'

function normalizedCount(count) {
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}

export function moveCommentSelection(length, index, direction, count = 1) {
  if (length === 0) return -1
  const current = Math.max(0, Math.min(index, length - 1))
  return Math.max(0, Math.min(current + direction * normalizedCount(count), length - 1))
}

/** Move by half a viewport, using the heights of the rendered comments. */
export function pageCommentSelection(centers, index, direction, viewportHeight, count = 1) {
  if (centers.length === 0 || viewportHeight <= 0) return -1
  const current = Math.max(0, Math.min(index, centers.length - 1))
  const target = centers[current] + direction * viewportHeight / 2 * normalizedCount(count)
  for (let next = current + direction; next >= 0 && next < centers.length; next += direction) {
    if (direction > 0 ? centers[next] >= target : centers[next] <= target) return next
  }
  return direction > 0 ? centers.length - 1 : 0
}

/** Scroll only the comments list. Keep the workspace scroll position. */
export function revealSelectedComment(list, item) {
  if (!list || !item || list.clientHeight <= 0) return
  const bounds = list.getBoundingClientRect()
  const top = bounds.top + list.clientTop
  const bottom = top + list.clientHeight
  const selected = item.getBoundingClientRect()
  if (selected.top < top || selected.height > list.clientHeight) {
    list.scrollBy({ top: selected.top - top, behavior: 'instant' })
  } else if (selected.bottom > bottom) {
    list.scrollBy({ top: selected.bottom - bottom, behavior: 'instant' })
  }
}

export function createCommentsListActionAdapter({ getComments, getSelectedId, selectComment, getPageIndex }) {
  const select = (getIndex) => (count) => {
    const comments = getComments()
    if (comments.length === 0) return false
    const current = Math.max(0, comments.findIndex((comment) => comment.id === getSelectedId()))
    const next = getIndex(comments.length, current, count)
    if (next < 0 || next >= comments.length) return false
    selectComment(comments[next].id)
    return true
  }
  return Object.freeze({
    [ApplicationAction.CURSOR_UP]: select((length, index, count) => moveCommentSelection(length, index, -1, count)),
    [ApplicationAction.CURSOR_DOWN]: select((length, index, count) => moveCommentSelection(length, index, 1, count)),
    [ApplicationAction.CURSOR_FIRST]: select(() => 0),
    [ApplicationAction.CURSOR_LAST]: select((length) => length - 1),
    [ApplicationAction.CURSOR_PAGE_UP]: select((length, index, count) => getPageIndex(index, -1, count)),
    [ApplicationAction.CURSOR_PAGE_DOWN]: select((length, index, count) => getPageIndex(index, 1, count)),
  })
}
