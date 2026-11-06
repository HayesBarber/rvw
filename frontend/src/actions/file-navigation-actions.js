import { prepareFileTreeInput } from '@pierre/trees'
import { normalizedCount } from '../utils/normalized-count.js'

/** Returns file paths in the same leaf order produced by the file tree. */
export function orderedFilePaths(files) {
  if (!Array.isArray(files) || files.length === 0) return []
  return prepareFileTreeInput(files.map((file) => file.path)).paths
}

/**
 * Finds a file relative to the currently open path. Counts stop at the first
 * or last file unless wrapping is enabled.
 */
export function relativeFilePath(paths, currentPath, direction, count = 1, { wrap = false } = {}) {
  if (!Array.isArray(paths) || paths.length === 0 || !currentPath) return null
  if (direction !== -1 && direction !== 1) return null

  const currentIndex = paths.indexOf(currentPath)
  if (currentIndex < 0) return null

  const offset = direction * normalizedCount(count)
  const nextIndex = wrap
    ? ((currentIndex + offset) % paths.length + paths.length) % paths.length
    : Math.max(
      0,
      Math.min(
        paths.length - 1,
        currentIndex + offset,
      ),
    )
  return nextIndex === currentIndex ? null : paths[nextIndex]
}
