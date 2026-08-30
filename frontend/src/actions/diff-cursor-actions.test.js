import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDiffFromFile } from '@pierre/diffs'
import { ApplicationAction } from './application-actions.js'
import {
  DiffCursorSide,
  centerDiffCursor,
  createDiffCursorActionAdapter,
  createDiffCursorRows,
  moveDiffCursor,
  reconcileDiffCursor,
  scrollDiffCursorIntoView,
} from './diff-cursor-actions.js'

function diffInstance(oldContents, newContents, renderable = () => true) {
  const fileDiff = parseDiffFromFile(
    oldContents === null ? null : { name: 'example.txt', contents: oldContents },
    newContents === null ? null : { name: 'example.txt', contents: newContents },
  )

  return {
    type: 'file-diff',
    fileDiff,
    getLineIndex(lineNumber, side = DiffCursorSide.ADDITIONS) {
      const lastHunk = fileDiff.hunks.at(-1)
      for (const hunk of fileDiff.hunks) {
        const additionStart = hunk.additionStart - (hunk.additionCount === 0 ? 0 : 1) + 1
        const deletionStart = hunk.deletionStart - (hunk.deletionCount === 0 ? 0 : 1) + 1
        const sideStart = side === DiffCursorSide.ADDITIONS ? additionStart : deletionStart
        const sideCount = side === DiffCursorSide.ADDITIONS
          ? hunk.additionCount
          : hunk.deletionCount
        if (lineNumber < sideStart) {
          const difference = sideStart - lineNumber
          return [
            Math.max(hunk.unifiedLineStart - difference, 0),
            Math.max(hunk.splitLineStart - difference, 0),
          ]
        }
        if (lineNumber >= sideStart + sideCount) {
          if (hunk === lastHunk) {
            const difference = lineNumber - (sideStart + sideCount)
            return [
              hunk.unifiedLineStart + hunk.unifiedLineCount + difference,
              hunk.splitLineStart + hunk.splitLineCount + difference,
            ]
          }
          continue
        }

        let additionLine = additionStart
        let deletionLine = deletionStart
        let splitIndex = hunk.splitLineStart
        let unifiedIndex = hunk.unifiedLineStart
        for (const content of hunk.hunkContent) {
          if (content.type === 'context') {
            const start = side === DiffCursorSide.ADDITIONS ? additionLine : deletionLine
            if (lineNumber >= start && lineNumber < start + content.lines) {
              const difference = lineNumber - start
              return [unifiedIndex + difference, splitIndex + difference]
            }
            additionLine += content.lines
            deletionLine += content.lines
            splitIndex += content.lines
            unifiedIndex += content.lines
          } else {
            const count = side === DiffCursorSide.ADDITIONS
              ? content.additions
              : content.deletions
            const start = side === DiffCursorSide.ADDITIONS ? additionLine : deletionLine
            if (lineNumber >= start && lineNumber < start + count) {
              const difference = lineNumber - start
              return [
                unifiedIndex + (side === DiffCursorSide.ADDITIONS ? content.deletions : 0) + difference,
                splitIndex + difference,
              ]
            }
            additionLine += content.additions
            deletionLine += content.deletions
            splitIndex += Math.max(content.additions, content.deletions)
            unifiedIndex += content.additions + content.deletions
          }
        }
      }
      return undefined
    },
    isLineRenderable: renderable,
  }
}

test('diff rows preserve sides across paired and one-sided visual rows', () => {
  const instance = diffInstance(
    'context\nold one\nold two\ntail\n',
    'context\nnew one\ntail\ninserted\n',
  )

  assert.deepEqual(createDiffCursorRows(instance), [
    { index: 0, additions: 1, deletions: 1 },
    { index: 1, additions: 2, deletions: 2 },
    { index: 2, deletions: 3 },
    { index: 3, additions: 3, deletions: 4 },
    { index: 4, additions: 4 },
  ])
})

test('unchanged files expose every line and empty files stay unhandled', () => {
  assert.deepEqual(createDiffCursorRows({
    type: 'file',
    file: { contents: 'first\nsecond\nthird' },
  }), [
    { index: 0, additions: 1 },
    { index: 1, additions: 2 },
    { index: 2, additions: 3 },
  ])
  assert.deepEqual(createDiffCursorRows({
    type: 'file',
    file: { contents: '' },
  }), [])
  assert.deepEqual(createDiffCursorRows({ type: 'unresolved-file' }), [])
})

test('diff rows skip collapsed context and include it after expansion', () => {
  const oldContents = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`).join('\n')
  const newContents = oldContents.replace('line 8', 'changed 8')
  const collapsed = new Set([1, 2, 3, 4, 12, 13, 14])
  const instance = diffInstance(
    oldContents,
    newContents,
    (lineNumber) => !collapsed.has(lineNumber),
  )

  const collapsedRows = createDiffCursorRows(instance)
  assert.equal(collapsedRows.some((row) => row.additions === 1), false)
  assert.equal(collapsedRows.some((row) => row.additions === 8), true)

  instance.isLineRenderable = () => true
  const expandedRows = createDiffCursorRows(instance)
  assert.equal(expandedRows.length, 14)
  assert.deepEqual(expandedRows[0], { index: 0, additions: 1, deletions: 1 })
  assert.deepEqual(expandedRows.at(-1), { index: 13, additions: 14, deletions: 14 })
})

test('cursor movement follows visual rows, preserves sides, and applies counts', () => {
  const rows = [
    { index: 0, additions: 10, deletions: 9 },
    { index: 1, deletions: 10 },
    { index: 2, additions: 11 },
    { index: 3, additions: 12, deletions: 11 },
  ]

  assert.deepEqual(moveDiffCursor(rows, null, 1), {
    lineNumber: 10,
    side: DiffCursorSide.ADDITIONS,
  })
  assert.deepEqual(moveDiffCursor(
    rows,
    { lineNumber: 10, side: DiffCursorSide.ADDITIONS },
    1,
  ), { lineNumber: 10, side: DiffCursorSide.DELETIONS })
  assert.deepEqual(moveDiffCursor(
    rows,
    { lineNumber: 9, side: DiffCursorSide.DELETIONS },
    1,
    3,
  ), { lineNumber: 11, side: DiffCursorSide.DELETIONS })
})

test('cursor reconciliation preserves identity and chooses the nearest same-side line', () => {
  const rows = [
    { index: 0, additions: 3, deletions: 4 },
    { index: 1, additions: 8, deletions: 9 },
  ]
  const existing = { lineNumber: 8, side: DiffCursorSide.ADDITIONS }

  assert.equal(reconcileDiffCursor(rows, existing), existing)
  assert.deepEqual(reconcileDiffCursor(rows, {
    lineNumber: 7,
    side: DiffCursorSide.DELETIONS,
  }), { lineNumber: 9, side: DiffCursorSide.DELETIONS })
  assert.deepEqual(reconcileDiffCursor(rows, null), {
    lineNumber: 3,
    side: DiffCursorSide.ADDITIONS,
  })
  assert.equal(reconcileDiffCursor([], existing), null)
})

test('the action adapter handles first, last, centered, repeated movement, and empty content', () => {
  let rows = [
    { index: 0, additions: 1 },
    { index: 1, additions: 2 },
    { index: 2, additions: 3 },
  ]
  let cursor = { lineNumber: 1, side: DiffCursorSide.ADDITIONS }
  const activated = []
  const centered = []
  const actions = createDiffCursorActionAdapter({
    getRows: () => rows,
    getCursor: () => cursor,
    activateCursor(nextCursor) {
      cursor = nextCursor
      activated.push(nextCursor)
      return true
    },
    centerCursor(nextCursor) {
      centered.push(nextCursor)
      return true
    },
  })

  assert.equal(actions[ApplicationAction.CURSOR_DOWN](2), true)
  assert.deepEqual(cursor, { lineNumber: 3, side: DiffCursorSide.ADDITIONS })
  assert.equal(actions[ApplicationAction.CURSOR_FIRST](), true)
  assert.deepEqual(cursor, { lineNumber: 1, side: DiffCursorSide.ADDITIONS })
  assert.equal(actions[ApplicationAction.CURSOR_LAST](), true)
  assert.deepEqual(cursor, { lineNumber: 3, side: DiffCursorSide.ADDITIONS })
  assert.equal(actions[ApplicationAction.CURSOR_UP](20), true)
  assert.deepEqual(cursor, { lineNumber: 1, side: DiffCursorSide.ADDITIONS })
  assert.equal(activated.length, 4)
  assert.equal(actions[ApplicationAction.CURSOR_CENTER](), true)
  assert.deepEqual(centered, [{
    lineNumber: 1,
    side: DiffCursorSide.ADDITIONS,
  }])
  assert.equal(activated.length, 4)

  rows = []
  cursor = null
  assert.equal(actions[ApplicationAction.CURSOR_DOWN](1), false)
  assert.equal(actions[ApplicationAction.CURSOR_FIRST](), false)
  assert.equal(actions[ApplicationAction.CURSOR_CENTER](), false)
})

test('centering scrolls the side-aware diff row to the viewport midpoint', () => {
  const scrolls = []
  const lineRequests = []
  const viewport = {
    nodeType: 1,
    scrollTop: 40,
    scrollHeight: 600,
    clientHeight: 100,
    getBoundingClientRect: () => ({ top: 20 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = { getBoundingClientRect: () => ({ top: -30 }) }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition(lineNumber, side) {
      lineRequests.push([lineNumber, side])
      return { top: 180, height: 20 }
    },
  }
  const cursor = { lineNumber: 12, side: DiffCursorSide.DELETIONS }

  assert.equal(centerDiffCursor(instance, node, cursor), true)
  assert.deepEqual(lineRequests, [[12, DiffCursorSide.DELETIONS]])
  assert.deepEqual(scrolls, [{ top: 130 }])
  assert.deepEqual(cursor, { lineNumber: 12, side: DiffCursorSide.DELETIONS })
})

test('centering is a no-op without a cursor or a scrollable viewport', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollTop: 0,
    scrollHeight: 80,
    clientHeight: 80,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = { getBoundingClientRect: () => ({ top: 0 }) }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 20, height: 20 }),
  }

  assert.equal(centerDiffCursor(instance, node, null), false)
  assert.equal(centerDiffCursor(instance, node, {
    lineNumber: 2,
    side: DiffCursorSide.ADDITIONS,
  }), false)
  assert.deepEqual(scrolls, [])
})

test('scrolling uses public line positions and keeps visible rows stationary', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollTop: 100,
    clientHeight: 80,
    getBoundingClientRect: () => ({ top: 20 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = { getBoundingClientRect: () => ({ top: -30 }) }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 180, height: 20 }),
  }

  assert.equal(scrollDiffCursorIntoView(instance, node, {
    lineNumber: 12,
    side: DiffCursorSide.ADDITIONS,
  }), true)
  assert.deepEqual(scrolls, [{ top: 170 }])

  instance.getLinePosition = () => ({ top: 80, height: 20 })
  assert.equal(scrollDiffCursorIntoView(instance, node, {
    lineNumber: 6,
    side: DiffCursorSide.ADDITIONS,
  }), true)
  assert.deepEqual(scrolls, [{ top: 170 }])
})
