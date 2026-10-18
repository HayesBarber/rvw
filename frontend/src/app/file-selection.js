export function selectActivePath(visibleFiles, selectedPath, initialPath, retainSelection = false, preferRootFile = false) {
  const visiblePaths = new Set(visibleFiles.map((file) => file.path))
  if (selectedPath && (retainSelection || visiblePaths.has(selectedPath))) return selectedPath
  if (initialPath && visiblePaths.has(initialPath)) return initialPath
  if (preferRootFile) {
    const rootFile = visibleFiles.find((file) => !file.path.includes('/'))
    if (rootFile) return rootFile.path
  }
  return visibleFiles[0]?.path ?? null
}
