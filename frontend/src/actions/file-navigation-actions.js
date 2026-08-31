import { prepareFileTreeInput } from '@pierre/trees'

function normalizedCount(count) {
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}

/** Returns file paths in the same leaf order produced by the file tree. */
export function orderedFilePaths(files) {
  if (!Array.isArray(files) || files.length === 0) return []
  return prepareFileTreeInput(files.map((file) => file.path)).paths
}

/**
 * Finds a file relative to the currently open path without wrapping. Counts
 * that cross a boundary stop at the first or last file.
 */
export function relativeFilePath(paths, currentPath, direction, count = 1) {
  if (!Array.isArray(paths) || paths.length === 0 || !currentPath) return null
  if (direction !== -1 && direction !== 1) return null

  const currentIndex = paths.indexOf(currentPath)
  if (currentIndex < 0) return null

  const nextIndex = Math.max(
    0,
    Math.min(
      paths.length - 1,
      currentIndex + direction * normalizedCount(count),
    ),
  )
  return nextIndex === currentIndex ? null : paths[nextIndex]
}
