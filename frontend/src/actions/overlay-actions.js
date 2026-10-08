export const OverlayKind = Object.freeze({
  FILE_FINDER: 'file_finder',
  CODEBASE_SEARCH: 'codebase_search',
  KEYMAP_REFERENCE: 'keymap_reference',
})

// An empty adapter blocks workspace actions while an overlay is open.
export const blockingOverlayActions = Object.freeze({})
