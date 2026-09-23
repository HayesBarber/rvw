import { ApplicationAction } from './application-actions.js'

// Placeholders for codebase text search. Execution and UI are added separately.
export function openCodebaseSearch() {
  return true
}

export function openCodebaseSearchAll() {
  return true
}

export const codebaseSearchActions = Object.freeze({
  [ApplicationAction.OPEN_CODEBASE_SEARCH]: openCodebaseSearch,
  [ApplicationAction.OPEN_CODEBASE_SEARCH_ALL]: openCodebaseSearchAll,
})
