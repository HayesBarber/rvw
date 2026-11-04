import { RequestStatus } from './request-state.js'

/**
 * @typedef {{ kind: 'commit', sha: string } | { kind: 'working-tree' }} ComparisonEndpoint
 */

const workingTreeEndpoint = Object.freeze({ kind: 'working-tree' })

/** The working tree is above HEAD, including when the tree is clean. */
export function comparisonEndpoints(commits) {
  return [workingTreeEndpoint, ...commits.map((commit) => ({ ...commit, kind: 'commit' }))]
}

function validEndpoint(endpoint) {
  if (endpoint?.kind === 'working-tree') return !('sha' in endpoint)
  return endpoint?.kind === 'commit' && typeof endpoint.sha === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(endpoint.sha)
}

function sameEndpoint(left, right) {
  return validEndpoint(left) && validEndpoint(right)
    && left.kind === right.kind && left.sha === right.sha
}

/** Toggle an endpoint, or replace the nearest selected endpoint. Ties replace Base. */
export function toggleComparisonEndpoint(endpoints, selected, endpoint) {
  const available = endpoints.find((item) => sameEndpoint(item, endpoint))
  if (!available) return selected
  if (selected.some((item) => sameEndpoint(item, available))) {
    return selected.filter((item) => !sameEndpoint(item, available))
  }
  if (selected.length === 2) {
    const pair = comparisonPair(endpoints, selected)
    if (!pair) return selected
    const index = endpoints.indexOf(available)
    const targetDistance = Math.abs(index - endpoints.indexOf(pair.target))
    const baseDistance = Math.abs(index - endpoints.indexOf(pair.base))
    const replaced = targetDistance < baseDistance ? pair.target : pair.base
    return selected.map((item) => sameEndpoint(item, replaced) ? available : item)
  }
  if (selected.length > 2) return selected
  return [...selected, available]
}

/** Assign roles by list position, independent of the order of selection. */
export function comparisonPair(endpoints, selected) {
  if (selected.length !== 2 || sameEndpoint(selected[0], selected[1])) return null
  const indices = selected.map((endpoint) => endpoints.findIndex((item) => sameEndpoint(item, endpoint)))
  if (indices.some((index) => index < 0)) return null
  indices.sort((a, b) => a - b)
  const target = endpoints[indices[0]]
  const base = endpoints[indices[1]]
  if (base.kind !== 'commit') return null
  return { base, target }
}

/** Check current data and selection for both button and action submission. */
export function createComparisonSubmitHandler({ getRequest, getSelection, onSelect, isBlocked = () => false }) {
  return () => {
    if (isBlocked()) return false
    const request = getRequest()
    if (request.status !== RequestStatus.SUCCESS || typeof onSelect !== 'function') return false
    const pair = comparisonPair(comparisonEndpoints(request.data), getSelection())
    if (!pair) return false
    const source = pair.target.kind === 'working-tree'
      ? { kind: 'working-tree', base: pair.base.sha }
      : { kind: 'commit-range', base: pair.base.sha, head: pair.target.sha }
    onSelect(source)
    return true
  }
}
