import { comparisonEndpoints } from '../review/comparison-selection.js'
import { RequestStatus } from '../review/request-state.js'
import { ApplicationAction } from './application-actions.js'
import { moveFileFinderSelection } from './file-finder-actions.js'

function sameEndpoint(left, right) {
  return left?.kind === right?.kind && left?.sha === right?.sha
}

function endpointNode(list, endpoint) {
  if (!endpoint) return null
  const key = endpoint.kind === 'working-tree' ? 'working-tree' : endpoint.sha
  return Array.from(list?.querySelectorAll('[data-endpoint]') ?? [])
    .find((node) => node.dataset.endpoint === key)
}

/** Move focus without checking the endpoint. Keep the node visible. */
export function focusComparisonEndpoint(list, endpoint) {
  const node = endpointNode(list, endpoint)
  if (!node) return false
  node.focus({ preventScroll: true })
  node.scrollIntoView({ block: 'nearest' })
  return true
}

export function centerComparisonEndpoint(list, endpoint) {
  const node = endpointNode(list, endpoint)
  if (!node) return false
  node.scrollIntoView({ block: 'center' })
  return true
}

export function createComparisonPickerActionAdapter({ getRequest, getFocusedEndpoint, focus, center, toggle, submit }) {
  const getEndpoints = () => {
    const request = getRequest()
    return request.status === RequestStatus.SUCCESS ? comparisonEndpoints(request.data) : []
  }
  const focused = () => getEndpoints().find((endpoint) => sameEndpoint(endpoint, getFocusedEndpoint()))
  const move = (offset, count) => {
    const endpoints = getEndpoints()
    if (endpoints.length === 0) return false
    const index = endpoints.findIndex((endpoint) => sameEndpoint(endpoint, getFocusedEndpoint()))
    return focus(endpoints[moveFileFinderSelection(endpoints.length, index, offset, count)])
  }
  const edge = (last) => {
    const endpoints = getEndpoints()
    if (endpoints.length === 0) return false
    return focus(endpoints[last ? endpoints.length - 1 : 0])
  }

  return Object.freeze({
    [ApplicationAction.CURSOR_UP]: (count) => move(-1, count),
    [ApplicationAction.CURSOR_DOWN]: (count) => move(1, count),
    [ApplicationAction.CURSOR_FIRST]: () => edge(false),
    [ApplicationAction.CURSOR_LAST]: () => edge(true),
    [ApplicationAction.CURSOR_CENTER]: () => {
      const endpoint = focused()
      return endpoint ? center(endpoint) : false
    },
    [ApplicationAction.ITEM_ACTIVATE]: () => {
      const endpoint = focused()
      return endpoint ? toggle(endpoint) : false
    },
    [ApplicationAction.OVERLAY_SUBMIT]: submit,
  })
}
