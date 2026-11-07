import { normalizedCount } from './normalized-count.js'

/** Move within the list bounds. Return -1 for an empty list. */
export function moveListSelection(length, index, direction, count = 1) {
  if (length === 0) return -1
  const current = Math.max(0, Math.min(index, length - 1))
  return Math.max(0, Math.min(current + direction * normalizedCount(count), length - 1))
}
