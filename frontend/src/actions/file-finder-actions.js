import { ApplicationAction } from './application-actions.js'

function normalizedCount(count) {
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}

export function moveFileFinderSelection(
  resultCount,
  activeIndex,
  offset,
  count = 1,
) {
  if (resultCount <= 0) return 0

  const selectedIndex = Math.max(0, Math.min(activeIndex, resultCount - 1))
  const nextIndex = selectedIndex + offset * normalizedCount(count)
  return ((nextIndex % resultCount) + resultCount) % resultCount
}

/** Adapts file-finder result operations to the application action vocabulary. */
export function createFileFinderActionAdapter({
  getResults,
  getActiveIndex,
  setActiveIndex,
  onOpen,
}) {
  const move = (offset, count) => {
    const results = getResults()
    if (results.length === 0) return false

    setActiveIndex(moveFileFinderSelection(
      results.length,
      getActiveIndex(),
      offset,
      count,
    ))
    return true
  }

  return Object.freeze({
    [ApplicationAction.CURSOR_UP]: (count) => move(-1, count),
    [ApplicationAction.CURSOR_DOWN]: (count) => move(1, count),
    [ApplicationAction.CURSOR_FIRST]: () => {
      if (getResults().length === 0) return false
      setActiveIndex(0)
      return true
    },
    [ApplicationAction.CURSOR_LAST]: () => {
      const results = getResults()
      if (results.length === 0) return false
      setActiveIndex(results.length - 1)
      return true
    },
    [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: () => {
      const results = getResults()
      if (results.length === 0) return false

      const activeIndex = Math.max(
        0,
        Math.min(getActiveIndex(), results.length - 1),
      )
      onOpen(results[activeIndex])
      return true
    },
  })
}
