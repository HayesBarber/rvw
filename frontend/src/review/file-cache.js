import { parseDiffFromFile } from '@pierre/diffs'

import { getFile, getFileDiff } from './api.js'

// Each review session retains at most 20 files. Map order is least to most
// recently used. Pending requests do not occupy entries. Invalidation discards
// their responses.
export const FILE_CACHE_CAPACITY = 20

export function createReviewFileCache({
  capacity = FILE_CACHE_CAPACITY,
  fetchFile = getFile,
  fetchDiff = getFileDiff,
  parseDiff = parseDiffFromFile,
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid file cache capacity')
  const entries = new Map()
  let snapshot = null
  let epoch = 0

  function invalidate() {
    entries.clear()
    snapshot = null
    epoch++
  }

  async function load({ diffId, generation = 0, path, changed }, timing) {
    const nextSnapshot = JSON.stringify([diffId, generation])
    if (snapshot !== nextSnapshot) {
      invalidate()
      snapshot = nextSnapshot
    }
    const currentEpoch = epoch
    const key = JSON.stringify([changed === true, path])
    if (entries.has(key)) {
      const file = entries.get(key)
      entries.delete(key)
      entries.set(key, file)
      timing?.stage('cache_hit')
      // Each selection needs its own timing identity, including on cache hits.
      return { ...file }
    }
    timing?.stage('cache_miss')
    const file = changed
      ? await fetchDiff(diffId, path, timing)
      : await fetchFile(path, timing)
    // Check before parsing as well as insertion. Old responses cannot refill
    // the cache even if a reload reuses the same backend diff ID.
    if (epoch !== currentEpoch) return null
    const prepared = file.content.kind === 'diff'
      ? { ...file, parsedDiff: parseDiff(file.content.oldFile, file.content.newFile) }
      : file
    if (file.content.kind !== 'unavailable') {
      entries.delete(key)
      entries.set(key, prepared)
      if (entries.size > capacity) {
        entries.delete(entries.keys().next().value)
        timing?.stage('cache_eviction')
      }
    }
    return { ...prepared }
  }

  return { load, invalidate }
}
