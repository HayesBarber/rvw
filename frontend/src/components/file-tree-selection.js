import { focusFileTreePath } from '../actions/file-tree-actions.js'

export function synchronizeFileTreeSelection(model, filePaths, selectedPath) {
  // The selected file can arrive before the repository file list is available.
  if (selectedPath && filePaths.has(selectedPath) && !model.getItem(selectedPath)) {
    model.add(selectedPath)
  }

  const selectedPaths = model.getSelectedPaths()
  const selectionMatches =
    selectedPaths.length === (selectedPath ? 1 : 0) &&
    selectedPaths[0] === selectedPath
  if (!selectionMatches) {
    for (const path of selectedPaths) model.getItem(path)?.deselect()
    if (selectedPath && filePaths.has(selectedPath)) {
      model.getItem(selectedPath)?.select()
    }
  }

  if (selectedPath && filePaths.has(selectedPath)) {
    focusFileTreePath(model, selectedPath)
  }
}
