import { RequestStatus } from '../review/request-state.js'
import { ApplicationAction } from './application-actions.js'
import { moveFileFinderSelection } from './file-finder-actions.js'

/** Check the current request when a tile submits, including after a reload. */
export function createPullRequestSubmitHandler({ getRequest, onSelect, isBlocked = () => false }) {
  return (number) => {
    if (isBlocked()) return false
    const request = getRequest()
    if (request.status !== RequestStatus.SUCCESS || typeof onSelect !== 'function') return false
    if (!request.data.some((pullRequest) => pullRequest.number === number)) return false
    onSelect(number)
    return true
  }
}

/** Focus a tile without activating it. Keep it inside the visible area. */
export function focusPullRequestTile(list, number) {
  const tile = list?.querySelector(`[data-pull-request-number="${number}"]`)
  if (!tile) return false
  tile.focus({ preventScroll: true })
  tile.scrollIntoView({ block: 'nearest' })
  return true
}

/** Center the focused tile without changing focus or submitting a PR. */
export function centerPullRequestTile(list, number) {
  const tile = list?.querySelector(`[data-pull-request-number="${number}"]`)
  if (!tile) return false
  tile.scrollIntoView({ block: 'center' })
  return true
}

export function createPullRequestPickerActionAdapter({ getRequest, getFocusedNumber, focus, center, submit }) {
  const getResults = () => {
    const request = getRequest()
    return request.status === RequestStatus.SUCCESS ? request.data : []
  }
  const move = (offset, count) => {
    const results = getResults()
    if (results.length === 0) return false
    const index = results.findIndex(({ number }) => number === getFocusedNumber())
    return focus(results[moveFileFinderSelection(results.length, index, offset, count)].number)
  }
  const edge = (last) => {
    const results = getResults()
    if (results.length === 0) return false
    return focus(results[last ? results.length - 1 : 0].number)
  }
  const activate = () => submit(getFocusedNumber())

  return Object.freeze({
    [ApplicationAction.CURSOR_UP]: (count) => move(-1, count),
    [ApplicationAction.CURSOR_DOWN]: (count) => move(1, count),
    [ApplicationAction.CURSOR_FIRST]: () => edge(false),
    [ApplicationAction.CURSOR_LAST]: () => edge(true),
    [ApplicationAction.CURSOR_CENTER]: () => {
      const number = getFocusedNumber()
      if (!getResults().some((pullRequest) => pullRequest.number === number)) return false
      return center(number)
    },
    [ApplicationAction.ITEM_ACTIVATE]: activate,
    [ApplicationAction.OVERLAY_SUBMIT]: activate,
  })
}
