import { parseDiffFromFile, processFile } from '@pierre/diffs'
import { fileLoadStage } from './file-load-performance.js'

// Keep source and parsed metadata together. Content equality, rather than path
// alone, prevents stale syntax/diff results after reload or a live file edit.
export function createPreparedFileCache(maxBytes = 8 * 1024 * 1024, maxEntries = 16) {
  const entries = new Map()
  let bytes = 0
  let serial = 0
  return (file, trace) => {
    if (file.content.kind === 'unavailable') return file
    const start = trace ? performance.now() : 0
    const oldFile = file.content.kind === 'diff' ? file.content.oldFile : null
    const newFile = file.content.kind === 'diff' ? file.content.newFile : file.content.file
    const key = `${file.content.kind}\0${file.path}`
    const prior = entries.get(key)
    const same = (a, b) => a?.contents === b?.contents && a?.name === b?.name && a?.lang === b?.lang
    if (prior && same(oldFile, prior.oldFile) && same(newFile, prior.newFile)) {
      entries.delete(key)
      entries.set(key, prior)
      fileLoadStage(trace, 'diff_prepare', start, { cacheHit: true })
      return { ...file, content: prior.content, parsedDiff: prior.parsedDiff }
    }
    if (prior) {
      bytes -= prior.bytes
      entries.delete(key)
    }
    const id = `file-${++serial}`
    const old = oldFile && { ...oldFile, cacheKey: `${id}-old` }
    const next = newFile && { ...newFile, cacheKey: `${id}-new` }
    const content = file.content.kind === 'diff'
      ? { kind: 'diff', oldFile: old, newFile: next }
      : { kind: 'file', file: next }
    const parsedDiff = content.kind === 'diff' ? parseDisplayDiff(old, next) : undefined
    const size = 2 * ((oldFile?.contents.length ?? 0) + (newFile?.contents.length ?? 0))
    if (size <= maxBytes) {
      entries.set(key, { oldFile, newFile, content, parsedDiff, bytes: size })
      bytes += size
      while (bytes > maxBytes || entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        bytes -= entries.get(oldest).bytes
        entries.delete(oldest)
      }
    }
    fileLoadStage(trace, 'diff_prepare', start, { cacheHit: false })
    return { ...file, content, parsedDiff }
  }
}

const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Exact shortcut for a replaced region with no matching lines. Myers diff
 * otherwise explores a quadratic number of edits just to prove this fact.
 * Common prefix/suffix and all newline bytes retain their original meaning.
 */
export function parseDisplayDiff(oldFile, newFile) {
  if (!oldFile || !newFile) return parseDiffFromFile(oldFile, newFile)
  const old = lines(oldFile.contents)
  const next = lines(newFile.contents)
  let prefix = 0
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (suffix < old.length - prefix && suffix < next.length - prefix &&
    old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  const removed = old.slice(prefix, old.length - suffix)
  const added = next.slice(prefix, next.length - suffix)
  if (removed.length * added.length < 250_000) return parseDiffFromFile(oldFile, newFile)
  const shared = new Set(removed)
  if (added.some((line) => shared.has(line))) return parseDiffFromFile(oldFile, newFile)

  const contextBefore = old.slice(Math.max(0, prefix - 4), prefix)
  const contextAfter = old.slice(old.length - suffix, old.length - suffix + 4)
  const patchLines = (items, sign) => items.map((line) =>
    `${sign}${line}${line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'}`).join('')
  const start = prefix - contextBefore.length + 1
  const patch = `--- old\n+++ new\n@@ -${start},${contextBefore.length + removed.length + contextAfter.length} +${start},${contextBefore.length + added.length + contextAfter.length} @@\n` +
    patchLines(contextBefore, ' ') + patchLines(removed, '-') +
    patchLines(added, '+') + patchLines(contextAfter, ' ')
  const result = processFile(patch, { oldFile, newFile, throwOnError: true,
    cacheKey: `${oldFile.cacheKey}:${newFile.cacheKey}` })
  result.name = newFile.name
  result.prevName = oldFile.name === newFile.name ? undefined : oldFile.name
  result.type = result.prevName ? 'rename-changed' : 'change'
  result.lang = newFile.lang
  return result
}

export const prepareFile = createPreparedFileCache()
