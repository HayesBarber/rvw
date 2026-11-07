import { moveListSelection } from '../utils/list-selection.js'
import { ApplicationAction } from './application-actions.js'

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

    setActiveIndex(moveListSelection(
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
    [ApplicationAction.ITEM_ACTIVATE]: () => {
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
