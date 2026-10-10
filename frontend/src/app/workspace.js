// Owns state and transitions for the application workspace shell.
export const ActiveSurface = Object.freeze({
  FILE_TREE: 'file_tree',
  DIFF_PANE: 'diff_pane',
})

export const TreeMode = Object.freeze({
  CHANGES: 'changes',
  FILES: 'files',
})

export const FinderMode = Object.freeze({
  VISIBLE: 'visible',
  ALL: 'all',
})

export const FILE_TREE_WIDTH = Object.freeze({
  INITIAL: 320,
  STEP: 40,
  VIM_MAX: 17_000,
})

export const initialWorkspaceState = Object.freeze({
  selectedPath: null,
  fileHistory: [],
  fileHistoryIndex: -1,
  unavailablePaths: [],
  lineNavigation: null,
  treeMode: TreeMode.CHANGES,
  fileTreeWidth: FILE_TREE_WIDTH.INITIAL,
  searchMode: null,
  finderOpen: false,
  finderMode: null,
  keymapReferenceOpen: false,
  commentsOpen: false,
  activeSurface: ActiveSurface.DIFF_PANE,
  relativeLineNumbers: false,
  wrapLines: true,
})

function validPath(selectedPath, visiblePaths, initialPath) {
  if (selectedPath && visiblePaths.includes(selectedPath)) return selectedPath
  if (initialPath && visiblePaths.includes(initialPath)) return initialPath
  return visiblePaths[0] ?? null
}

function reduceWorkspace(state, action) {
  switch (action.type) {
    case 'review_loaded':
      return {
        ...state,
        selectedPath: action.initialPath,
        lineNavigation: null,
        fileHistory: action.initialPath ? [action.initialPath] : [],
        fileHistoryIndex: action.initialPath ? 0 : -1,
        unavailablePaths: [],
      }
    case 'file_unavailable':
      return state.unavailablePaths.includes(action.path)
        ? state
        : { ...state, unavailablePaths: [...state.unavailablePaths, action.path] }
    case 'file_availability_reset':
      return { ...state, unavailablePaths: [] }
    case 'file_history_moved': {
      const index = fileHistoryTarget(state, action.direction, action.count, action.availablePaths)
      if (index === null) return state
      return {
        ...state,
        fileHistoryIndex: index,
        selectedPath: state.fileHistory[index],
        lineNavigation: null,
        treeMode: action.changedPaths.includes(state.fileHistory[index]) ? state.treeMode : TreeMode.FILES,
      }
    }
    case 'surface_activated':
      return state.activeSurface === action.surface
        ? state
        : { ...state, activeSurface: action.surface }
    case 'file_selected':
      return state.selectedPath === action.path
        ? state
        : { ...state, selectedPath: action.path, lineNavigation: null }
    case 'tree_mode_changed':
      return {
        ...state,
        treeMode: action.mode,
        selectedPath: validPath(
          state.selectedPath,
          action.visiblePaths,
          action.initialPath,
        ),
      }
    case 'file_tree_resized': {
      const steps = Number.isSafeInteger(action.steps) ? action.steps : 0
      const fileTreeWidth = Math.max(
        0,
        Math.min(
          FILE_TREE_WIDTH.VIM_MAX,
          state.fileTreeWidth + steps * FILE_TREE_WIDTH.STEP,
        ),
      )
      return fileTreeWidth === state.fileTreeWidth
        ? state
        : { ...state, fileTreeWidth }
    }
    case 'file_tree_width_set': {
      if (!Number.isFinite(action.width)) return state
      const fileTreeWidth = Math.max(0, action.width)
      return fileTreeWidth === state.fileTreeWidth
        ? state
        : { ...state, fileTreeWidth }
    }
    case 'search_opened':
      return { ...state, searchMode: action.mode === 'all-files' ? 'all-files' : 'ignore-aware' }
    case 'search_closed':
      return { ...state, searchMode: null }
    case 'finder_opened': {
      const finderMode = action.mode === FinderMode.ALL
        ? FinderMode.ALL
        : FinderMode.VISIBLE
      return state.finderOpen
        ? { ...state, finderMode }
        : { ...state, finderOpen: true, finderMode }
    }
    case 'finder_closed':
      return state.finderOpen
        ? { ...state, finderOpen: false, finderMode: null }
        : state
    case 'search_result_opened':
    case 'finder_file_opened':
      return {
        ...state,
        selectedPath: action.path,
        lineNavigation: action.type === 'search_result_opened'
          ? { path: action.path, lineNumber: action.lineNumber }
          : null,
        searchMode: null,
        treeMode: action.changed ? state.treeMode : TreeMode.FILES,
        finderOpen: false,
        finderMode: null,
        activeSurface: ActiveSurface.DIFF_PANE,
      }
    case 'comments_opened':
      return state.commentsOpen ? state : { ...state, commentsOpen: true }
    case 'comments_closed':
      return state.commentsOpen ? { ...state, commentsOpen: false } : state
    case 'comment_location_opened':
      return {
        ...state,
        selectedPath: action.location.path,
        lineNavigation: { ...action.location },
        commentsOpen: false,
        treeMode: action.changed ? state.treeMode : TreeMode.FILES,
        activeSurface: ActiveSurface.DIFF_PANE,
      }
    case 'keymap_reference_opened':
      return state.keymapReferenceOpen
        ? state
        : { ...state, keymapReferenceOpen: true }
    case 'keymap_reference_closed':
      return state.keymapReferenceOpen
        ? { ...state, keymapReferenceOpen: false }
        : state
    case 'wrap_lines_toggled':
      return { ...state, wrapLines: !state.wrapLines }
    case 'wrap_lines_set':
      if (typeof action.wrapLines !== 'boolean') return state
      return state.wrapLines === action.wrapLines
        ? state
        : { ...state, wrapLines: action.wrapLines }
    case 'relative_line_numbers_toggled':
      return { ...state, relativeLineNumbers: !state.relativeLineNumbers }
    case 'relative_line_numbers_set':
      if (typeof action.relativeLineNumbers !== 'boolean') return state
      return state.relativeLineNumbers === action.relativeLineNumbers
        ? state
        : { ...state, relativeLineNumbers: action.relativeLineNumbers }
    default:
      return state
  }
}

/** Find a reachable entry without changing history or stopping at missing files. */
export function fileHistoryTarget(state, direction, count = 1, availablePaths = null) {
  if (direction !== -1 && direction !== 1) return null
  let remaining = Number.isSafeInteger(count) && count > 0 ? count : 1
  let target = null
  for (let index = state.fileHistoryIndex + direction;
    index >= 0 && index < state.fileHistory.length; index += direction) {
    const path = state.fileHistory[index]
    if (path === state.selectedPath || state.unavailablePaths.includes(path)) continue
    if (availablePaths && !availablePaths.includes(path)) continue
    target = index
    if (--remaining === 0) break
  }
  return target
}

export function workspaceReducer(state, action) {
  const next = reduceWorkspace(state, action)
  if (action.type === 'review_loaded' || action.type === 'file_history_moved' ||
    !next.selectedPath || next.selectedPath === state.selectedPath) return next
  const fileHistory = [...state.fileHistory.slice(0, state.fileHistoryIndex + 1), next.selectedPath]
  return { ...next, fileHistory, fileHistoryIndex: fileHistory.length - 1 }
}
