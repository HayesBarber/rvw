import { RequestStatus } from '../review/request-state.js'

/** Check the current request when a tile submits, including after a reload. */
export function createPullRequestSubmitHandler({ getRequest, onSelect }) {
  return (number) => {
    const request = getRequest()
    if (request.status !== RequestStatus.SUCCESS || typeof onSelect !== 'function') return false
    if (!request.data.some((pullRequest) => pullRequest.number === number)) return false
    onSelect(number)
    return true
  }
}
