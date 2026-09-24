export function openCodebaseSearch(dispatchWorkspace) {
  dispatchWorkspace({ type: 'search_opened', mode: 'ignore-aware' })
  return true
}

export function openCodebaseSearchAll(dispatchWorkspace) {
  dispatchWorkspace({ type: 'search_opened', mode: 'all-files' })
  return true
}
