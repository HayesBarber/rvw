import { parseDiffFromFile } from '@pierre/diffs'

import { getFile, getFileDiff } from './api.js'

export const FILE_CACHE_CAPACITY = 20
export const FILE_WARM_RADIUS = 2

// Match navigation order, nearest first, without wrapping at either end.
export function nearbyFilePaths(paths, selected) {
  const index = paths.indexOf(selected)
  if (index < 0) return []
  const nearby = []
  for (let distance = 1; distance <= FILE_WARM_RADIUS; distance++) {
    if (index + distance < paths.length) nearby.push(paths[index + distance])
    if (index - distance >= 0) nearby.push(paths[index - distance])
  }
  return nearby
}

function scheduleIdle(callback) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback)
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(callback, 50)
  return () => clearTimeout(id)
}

export function createReviewFileCache({
  capacity = FILE_CACHE_CAPACITY,
  fetchFile = getFile,
  fetchDiff = getFileDiff,
  parseDiff = parseDiffFromFile,
  schedule = scheduleIdle,
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid file cache capacity')
  const entries = new Map()
  const pending = new Map()
  let snapshot = null
  let epoch = 0
  let selectedKey = null
  let wanted = new Set()
  let queue = []
  let cancelScheduled = null
  // Keep the physical slot occupied across invalidation until the request ends.
  let warming = false
  const keyFor = ({ changed, path }) => JSON.stringify([changed === true, path])

  function stopWarming() {
    cancelScheduled?.()
    cancelScheduled = null
    queue = []
    wanted = new Set()
  }

  function invalidate() {
    stopWarming()
    entries.clear()
    snapshot = null
    selectedKey = null
    epoch++
    for (const job of pending.values()) job.resume?.()
    pending.clear()
  }

  function ensureSnapshot({ diffId, generation = 0 }) {
    const next = JSON.stringify([diffId, generation])
    if (snapshot !== next) {
      invalidate()
      snapshot = next
    }
  }

  function pump() {
    if (warming || cancelScheduled || !queue.length || pending.has(selectedKey)) return
    cancelScheduled = schedule(() => {
      cancelScheduled = null
      if (pending.has(selectedKey)) return
      const input = queue.shift()
      if (!input) return
      const key = keyFor(input)
      if (entries.has(key) || pending.has(key)) { pump(); return }
      warming = true
      get(input, undefined, true).catch(() => {
        // Speculative failures are silent. An active selection can retry.
      }).finally(() => { warming = false; pump() })
    })
  }

  function warm(input, paths, changedPaths) {
    ensureSnapshot(input)
    stopWarming()
    queue = nearbyFilePaths(paths, input.path).slice(0, capacity - 1)
      .map((path) => ({ ...input, path, changed: changedPaths.has(path) }))
    wanted = new Set(queue.map(keyFor))
    pump()
  }

  async function get(input, timing, speculative = false) {
    const key = keyFor(input)
    if (!speculative) selectedKey = key
    if (entries.has(key)) {
      const file = entries.get(key)
      entries.delete(key)
      entries.set(key, file)
      timing?.stage('cache_hit')
      return { ...file }
    }
    timing?.stage('cache_miss')
    let job = pending.get(key)
    if (job) {
      if (!speculative) { job.active = true; job.resume?.() }
    } else {
      const currentEpoch = epoch
      job = { active: !speculative, resume: null }
      const valid = () => epoch === currentEpoch && (job.active || wanted.has(key))
      job.promise = (async () => {
        const file = input.changed
          ? await fetchDiff(input.diffId, input.path, timing)
          : await fetchFile(input.path, timing)
        if (!valid()) return null
        if (!job.active && file.content.kind === 'diff') {
          await new Promise((resolve) => {
            const cancel = schedule(() => { job.resume = null; resolve() })
            job.resume = () => { cancel(); job.resume = null; resolve() }
          })
        }
        if (!valid()) return null
        const prepared = file.content.kind === 'diff'
          ? { ...file, parsedDiff: parseDiff(file.content.oldFile, file.content.newFile) }
          : file
        if (file.content.kind !== 'unavailable') {
          entries.set(key, prepared)
          if (entries.size > capacity) {
            // The selected entry is protected even while another load finishes.
            const victim = [...entries.keys()].find((candidate) => candidate !== selectedKey)
            entries.delete(victim)
            timing?.stage('cache_eviction')
          }
        }
        return prepared
      })().finally(() => {
        if (pending.get(key) === job) pending.delete(key)
        pump()
      })
      pending.set(key, job)
    }
    const file = await job.promise
    return file ? { ...file } : null
  }

  function load(input, timing) {
    ensureSnapshot(input)
    // Cancel old queued work immediately, before the warming effect runs.
    if (selectedKey !== keyFor(input)) stopWarming()
    return get(input, timing)
  }

  return { load, warm, stopWarming, invalidate }
}
