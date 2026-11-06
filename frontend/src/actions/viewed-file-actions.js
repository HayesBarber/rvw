import { orderedFilePaths } from './file-navigation-actions.js'

/** Sets viewed status and uses the next-file action to advance after marking. */
export function setFileViewed({
  path,
  viewed,
  changedFiles,
  viewedPaths,
  dispatchWorkspace,
  navigateFile,
}) {
  if (typeof viewed !== 'boolean' || !changedFiles.some((file) => file.path === path)) return false
  if (viewedPaths.includes(path) === viewed) return false

  dispatchWorkspace({ type: 'file_viewed_set', path, viewed })
  if (viewed) {
    const viewedSet = new Set(viewedPaths)
    // Keep the current file as the navigation anchor; all other paths are unviewed.
    const paths = orderedFilePaths(changedFiles)
      .filter((candidate) => candidate === path || !viewedSet.has(candidate))
    navigateFile(1, 1, { paths, wrap: true })
  }
  return true
}
