export const ActiveSurface = Object.freeze({
  FILE_TREE: 'file_tree',
  DIFF_PANE: 'diff_pane',
})

export const TreeMode = Object.freeze({
  CHANGES: 'changes',
  FILES: 'files',
})

export const initialWorkspaceState = Object.freeze({
  selectedPath: null,
  treeMode: TreeMode.CHANGES,
  finderOpen: false,
  activeSurface: ActiveSurface.FILE_TREE,
})

function validPath(selectedPath, visiblePaths, initialPath) {
  if (selectedPath && visiblePaths.includes(selectedPath)) return selectedPath
  if (initialPath && visiblePaths.includes(initialPath)) return initialPath
  return visiblePaths[0] ?? null
}

export function workspaceReducer(state, action) {
  switch (action.type) {
    case 'review_loaded':
      return { ...state, selectedPath: action.initialPath }
    case 'surface_activated':
      return state.activeSurface === action.surface
        ? state
        : { ...state, activeSurface: action.surface }
    case 'file_selected':
      return state.selectedPath === action.path
        ? state
        : { ...state, selectedPath: action.path }
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
    case 'finder_opened':
      return state.finderOpen ? state : { ...state, finderOpen: true }
    case 'finder_closed':
      return state.finderOpen ? { ...state, finderOpen: false } : state
    case 'finder_file_opened':
      return {
        ...state,
        selectedPath: action.path,
        treeMode: action.changed ? state.treeMode : TreeMode.FILES,
        finderOpen: false,
        activeSurface: ActiveSurface.DIFF_PANE,
      }
    default:
      return state
  }
}
