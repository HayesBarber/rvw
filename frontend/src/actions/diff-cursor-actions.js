import { ApplicationAction } from './application-actions.js'

// Adapts diff cursor operations to the application action vocabulary.

export const DiffCursorSide = Object.freeze({
  DELETIONS: 'deletions',
  ADDITIONS: 'additions',
})

function normalizedCount(count) {
  return Number.isSafeInteger(count) && count > 0 ? count : 1
}

function hunkSideStart(start, count) {
  return start - (count === 0 ? 0 : 1) + 1
}

function collectDefaultDiffLines(fileDiff) {
  const additions = new Set()
  const deletions = new Set()

  for (const hunk of fileDiff.hunks) {
    let additionLine = hunkSideStart(hunk.additionStart, hunk.additionCount)
    let deletionLine = hunkSideStart(hunk.deletionStart, hunk.deletionCount)

    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        for (let index = 0; index < content.lines; index += 1) {
          additions.add(additionLine + index)
          deletions.add(deletionLine + index)
        }
        additionLine += content.lines
        deletionLine += content.lines
        continue
      }

      for (let index = 0; index < content.additions; index += 1) {
        additions.add(additionLine + index)
      }
      for (let index = 0; index < content.deletions; index += 1) {
        deletions.add(deletionLine + index)
      }
      additionLine += content.additions
      deletionLine += content.deletions
    }
  }

  return { additions, deletions }
}

function fileLineCount(contents) {
  if (contents.length === 0) return 0
  const newlineCount = contents.split('\n').length - 1
  return newlineCount + (contents.endsWith('\n') ? 0 : 1)
}

function createFileRows(instance) {
  const count = fileLineCount(instance.file?.contents ?? '')
  return Array.from({ length: count }, (_, index) => ({
    index,
    additions: index + 1,
  }))
}

function createDiffRows(instance) {
  const fileDiff = instance.fileDiff
  if (!fileDiff || fileDiff.hunks.length === 0) return []

  const defaultLines = collectDefaultDiffLines(fileDiff)
  const rows = new Map()
  const addLine = (side, lineNumber) => {
    const indexes = instance.getLineIndex?.(lineNumber, side)
    const splitIndex = indexes?.[1]
    if (!Number.isSafeInteger(splitIndex)) return

    const row = rows.get(splitIndex) ?? { index: splitIndex }
    row[side] = lineNumber
    rows.set(splitIndex, row)
  }

  for (let lineNumber = 1; lineNumber <= fileDiff.additionLines.length; lineNumber += 1) {
    const renderable = instance.isLineRenderable?.(lineNumber)
      ?? defaultLines.additions.has(lineNumber)
    if (renderable) addLine(DiffCursorSide.ADDITIONS, lineNumber)
  }

  for (let lineNumber = 1; lineNumber <= fileDiff.deletionLines.length; lineNumber += 1) {
    const indexes = instance.getLineIndex?.(lineNumber, DiffCursorSide.DELETIONS)
    const splitIndex = indexes?.[1]
    if (!Number.isSafeInteger(splitIndex)) continue

    // Expanded context has a renderable new-side row at the same visual index.
    // Deletion-only change rows remain visible even without a paired new line.
    if (rows.has(splitIndex) || defaultLines.deletions.has(lineNumber)) {
      const row = rows.get(splitIndex) ?? { index: splitIndex }
      row.deletions = lineNumber
      rows.set(splitIndex, row)
    }
  }

  return [...rows.values()].sort((left, right) => left.index - right.index)
}

/** Build the currently navigable visual rows from a public diffs render instance. */
export function createDiffCursorRows(instance) {
  if (!instance) return []
  if (instance.type === 'file') return createFileRows(instance)
  if (instance.type === 'file-diff') return createDiffRows(instance)
  return []
}

function cursorForRow(row, preferredSide = DiffCursorSide.ADDITIONS) {
  if (!row) return null
  const side = row[preferredSide] !== undefined
    ? preferredSide
    : (preferredSide === DiffCursorSide.ADDITIONS
        ? DiffCursorSide.DELETIONS
        : DiffCursorSide.ADDITIONS)
  const lineNumber = row[side]
  return lineNumber === undefined ? null : { lineNumber, side }
}

function rowIndexForCursor(rows, cursor) {
  if (!cursor) return -1
  return rows.findIndex((row) => row[cursor.side] === cursor.lineNumber)
}

/** Preserve a cursor across rerenders, falling back to the nearest same-side line. */
export function reconcileDiffCursor(rows, cursor) {
  if (rows.length === 0) return null
  if (rowIndexForCursor(rows, cursor) !== -1) return cursor
  if (!cursor) return cursorForRow(rows[0])

  let nearest = null
  let nearestDistance = Infinity
  for (const row of rows) {
    const lineNumber = row[cursor.side]
    if (lineNumber === undefined) continue
    const distance = Math.abs(lineNumber - cursor.lineNumber)
    if (distance < nearestDistance) {
      nearest = { lineNumber, side: cursor.side }
      nearestDistance = distance
    }
  }
  return nearest ?? cursorForRow(rows[0])
}

export function moveDiffCursor(rows, cursor, offset, count = 1) {
  if (rows.length === 0) return null
  const currentIndex = rowIndexForCursor(rows, cursor)
  if (currentIndex === -1) return cursorForRow(rows[0], cursor?.side)
  const finalIndex = Math.max(
    0,
    Math.min(rows.length - 1, currentIndex + offset * normalizedCount(count)),
  )
  return cursorForRow(rows[finalIndex], cursor?.side)
}

export function scrollDiffCursorIntoView(instance, node, cursor) {
  const position = instance?.getLinePosition?.(cursor.lineNumber, cursor.side)
  const viewport = instance?.getEditorViewport?.()
  if (!position || position.height <= 0 || !viewport || !node) return false

  const nodeTop = node.getBoundingClientRect().top
  const isDocument = viewport.nodeType === 9
  const scrollTop = isDocument
    ? (viewport.defaultView?.scrollY ?? 0)
    : viewport.scrollTop
  const viewportTop = isDocument
    ? 0
    : viewport.getBoundingClientRect().top
  const viewportHeight = isDocument
    ? viewport.documentElement.clientHeight
    : viewport.clientHeight
  const rowTop = scrollTop + nodeTop - viewportTop + position.top
  const rowBottom = rowTop + position.height
  const viewportBottom = scrollTop + viewportHeight

  let nextScrollTop
  if (rowTop < scrollTop) nextScrollTop = rowTop
  else if (rowBottom > viewportBottom) nextScrollTop = rowBottom - viewportHeight
  else return true

  if (isDocument) viewport.defaultView?.scrollTo({ top: nextScrollTop })
  else viewport.scrollTo({ top: nextScrollTop })
  return true
}

/** Center the current diff cursor without changing its active row or selection. */
export function centerDiffCursor(instance, node, cursor) {
  if (!cursor) return false

  const position = instance?.getLinePosition?.(cursor.lineNumber, cursor.side)
  const viewport = instance?.getEditorViewport?.()
  if (!position || position.height <= 0 || !viewport || !node) return false

  const isDocument = viewport.nodeType === 9
  const viewportElement = isDocument ? viewport.documentElement : viewport
  const viewportHeight = viewportElement.clientHeight
  if (viewportHeight <= 0 || viewportElement.scrollHeight <= viewportHeight) return false

  const scrollTop = isDocument
    ? (viewport.defaultView?.scrollY ?? 0)
    : viewport.scrollTop
  const viewportTop = isDocument
    ? 0
    : viewport.getBoundingClientRect().top
  const nodeTop = node.getBoundingClientRect().top
  const rowCenter = scrollTop + nodeTop - viewportTop + position.top + position.height / 2
  const nextScrollTop = Math.max(0, rowCenter - viewportHeight / 2)

  if (isDocument) viewport.defaultView?.scrollTo({ top: nextScrollTop })
  else viewport.scrollTo({ top: nextScrollTop })
  return true
}

export function createDiffCursorActionAdapter({
  getRows,
  getCursor,
  activateCursor,
  centerCursor,
}) {
  const activate = (cursor) => cursor !== null && activateCursor(cursor) === true
  const move = (offset, count) => activate(moveDiffCursor(
    getRows(),
    getCursor(),
    offset,
    count,
  ))

  return Object.freeze({
    [ApplicationAction.CURSOR_UP]: (count) => move(-1, count),
    [ApplicationAction.CURSOR_DOWN]: (count) => move(1, count),
    [ApplicationAction.CURSOR_FIRST]: () => activate(cursorForRow(getRows()[0])),
    [ApplicationAction.CURSOR_LAST]: () => {
      const rows = getRows()
      return activate(cursorForRow(rows.at(-1)))
    },
    [ApplicationAction.CURSOR_CENTER]: () => {
      const cursor = getCursor()
      return cursor !== null && centerCursor(cursor) === true
    },
  })
}
