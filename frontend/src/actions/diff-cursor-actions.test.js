import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDiffFromFile } from '@pierre/diffs'
import { commentAtCursor, commentTargetAtCursor } from './comment-actions.js'
import { ApplicationAction } from './application-actions.js'
import {
  DiffCursorSide,
  centerDiffCursor,
  captureDiffLayoutAnchor,
  createDiffCursorActionAdapter,
  createDiffCursorRows,
  moveDiffCursor,
  moveDiffCursorByPage,
  reconcileDiffCursor,
  restoreDiffLayoutAnchor,
  scrollDiffCursorIntoView,
  switchDiffCursorSide,
  syncDiffCursorPresentation,
  syncRelativeLineNumbers,
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

test('file comment rows are prepended when requested and left out otherwise', () => {
  const diffRows = [
    { index: -1, additions: 0, fileCommentRow: true },
    { index: 0, additions: 1, deletions: 1 },
  ]

  assert.deepEqual(createDiffCursorRows(diffInstance('old\n', 'new\n'), {
    includeFileComment: true,
  }), diffRows)
  assert.deepEqual(createDiffCursorRows({
    type: 'file',
    file: { contents: 'first\n' },
  }, { includeFileComment: true }), [
    { index: -1, additions: 0, fileCommentRow: true },
    { index: 0, additions: 1 },
  ])
  assert.deepEqual(createDiffCursorRows(diffInstance('old\n', 'new\n'), {}), [
    { index: 0, additions: 1, deletions: 1 },
  ])
  assert.equal(createDiffCursorRows(diffInstance('old\n', 'new\n'), {
    includeFileComment: false,
  })[0].fileCommentRow, undefined)
  assert.deepEqual(createDiffCursorRows(null, { includeFileComment: true }), [])
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

test('half-page movement uses rendered positions, preserves sides, scales counts, and clamps', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    index,
    additions: index + 20,
    ...(index === 6 ? {} : { deletions: index + 10 }),
  }))
  const viewport = { nodeType: 1, clientHeight: 100 }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition(lineNumber, side) {
      const rowIndex = side === DiffCursorSide.DELETIONS
        ? lineNumber - 10
        : lineNumber - 20
      return { top: rowIndex * 20, height: 20 }
    },
  }

  assert.deepEqual(moveDiffCursorByPage(
    instance,
    rows,
    { lineNumber: 12, side: DiffCursorSide.DELETIONS },
    1,
  ), { lineNumber: 15, side: DiffCursorSide.DELETIONS })
  assert.deepEqual(moveDiffCursorByPage(
    instance,
    rows,
    { lineNumber: 12, side: DiffCursorSide.DELETIONS },
    1,
    2,
  ), { lineNumber: 17, side: DiffCursorSide.DELETIONS })
  assert.deepEqual(moveDiffCursorByPage(
    instance,
    rows,
    { lineNumber: 17, side: DiffCursorSide.DELETIONS },
    -1,
    20,
  ), { lineNumber: 10, side: DiffCursorSide.DELETIONS })
  viewport.clientHeight = 40
  assert.deepEqual(moveDiffCursorByPage(
    instance,
    rows,
    { lineNumber: 15, side: DiffCursorSide.DELETIONS },
    1,
  ), { lineNumber: 26, side: DiffCursorSide.ADDITIONS })
})

test('half-page movement safely handles non-scrollable and unavailable surfaces', () => {
  const rows = [{ index: 0, additions: 1 }, { index: 1, additions: 2 }]
  const cursor = { lineNumber: 1, side: DiffCursorSide.ADDITIONS }

  assert.deepEqual(moveDiffCursorByPage({
    getEditorViewport: () => ({ nodeType: 1, clientHeight: 200 }),
    getLinePosition: (lineNumber) => ({ top: (lineNumber - 1) * 20, height: 20 }),
  }, rows, cursor, 1), { lineNumber: 2, side: DiffCursorSide.ADDITIONS })
  assert.equal(moveDiffCursorByPage(null, rows, cursor, 1), null)
  assert.equal(moveDiffCursorByPage({
    getEditorViewport: () => ({ nodeType: 1, clientHeight: 0 }),
    getLinePosition: () => ({ top: 0, height: 20 }),
  }, rows, cursor, 1), null)
  assert.equal(moveDiffCursorByPage({}, [], cursor, 1), null)
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

test('diff cursor presentation follows visibility without changing its location', () => {
  const writes = []
  const instance = {
    setEditorActiveLine: (...args) => writes.push(args),
  }
  const cursor = { lineNumber: 8, side: DiffCursorSide.DELETIONS }

  assert.equal(syncDiffCursorPresentation(instance, cursor, true), true)
  assert.equal(syncDiffCursorPresentation(instance, cursor, false), false)
  assert.equal(syncDiffCursorPresentation(instance, null, true), false)
  assert.equal(syncDiffCursorPresentation(null, cursor, true), false)
  assert.deepEqual(writes, [
    [8, { side: DiffCursorSide.DELETIONS }],
    [null],
    [null],
  ])
  assert.deepEqual(cursor, { lineNumber: 8, side: DiffCursorSide.DELETIONS })
})

function gutter(lineNumber, side, text = `${lineNumber}`) {
  const content = { textContent: text }
  return {
    content,
    closest: (selector) => (
      selector === '[data-deletions]' && side === DiffCursorSide.DELETIONS
        ? {}
        : null
    ),
    getAttribute: (name) => (
      name === 'data-column-number' ? `${lineNumber}` : null
    ),
    querySelector: (selector) => (
      selector === '[data-line-number-content]' ? content : null
    ),
  }
}

test('relative gutter numbers use navigable visual-row distance without changing source data', () => {
  const rows = [
    { index: 4, additions: 10, deletions: 8 },
    { index: 5, deletions: 9 },
    { index: 6, additions: 11 },
    { index: 7, additions: 12, deletions: 10 },
  ]
  const gutters = [
    gutter(8, DiffCursorSide.DELETIONS),
    gutter(10, DiffCursorSide.ADDITIONS),
    gutter(9, DiffCursorSide.DELETIONS),
    gutter(11, DiffCursorSide.ADDITIONS),
    gutter(10, DiffCursorSide.DELETIONS),
    gutter(12, DiffCursorSide.ADDITIONS),
  ]
  const node = { shadowRoot: { querySelectorAll: () => gutters } }
  const cursor = { lineNumber: 11, side: DiffCursorSide.ADDITIONS }

  assert.equal(syncRelativeLineNumbers(node, rows, cursor, true), true)
  assert.deepEqual(gutters.map((item) => item.content.textContent), [
    '2', '2', '1', '11', '1', '1',
  ])
  assert.deepEqual(gutters.map((item) => item.getAttribute('data-column-number')), [
    '8', '10', '9', '11', '10', '12',
  ])

  assert.equal(syncRelativeLineNumbers(node, rows, cursor, false), true)
  assert.deepEqual(gutters.map((item) => item.content.textContent), [
    '8', '10', '9', '11', '10', '12',
  ])
})

test('relative gutters remain absolute until a code cursor exists and for unknown rows', () => {
  const known = gutter(20, DiffCursorSide.ADDITIONS, '1')
  const annotation = gutter(99, DiffCursorSide.ADDITIONS, '7')
  const node = { shadowRoot: { querySelectorAll: () => [known, annotation] } }
  const rows = [{ index: 0, additions: 20 }]

  syncRelativeLineNumbers(node, rows, null, true)
  assert.equal(known.content.textContent, '20')
  assert.equal(annotation.content.textContent, '99')

  syncRelativeLineNumbers(node, rows, {
    lineNumber: 0,
    side: DiffCursorSide.ADDITIONS,
  }, true)
  assert.equal(known.content.textContent, '20')
  assert.equal(annotation.content.textContent, '99')
  assert.equal(syncRelativeLineNumbers(null, rows, null, true), false)
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
    getInstance: () => ({
      getEditorViewport: () => ({ nodeType: 1, clientHeight: 80 }),
      getLinePosition: (lineNumber) => ({ top: (lineNumber - 1) * 20, height: 20 }),
    }),
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
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_DOWN](), true)
  assert.deepEqual(cursor, { lineNumber: 3, side: DiffCursorSide.ADDITIONS })
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_UP](), true)
  assert.deepEqual(cursor, { lineNumber: 1, side: DiffCursorSide.ADDITIONS })
  assert.equal(actions[ApplicationAction.CURSOR_CENTER](), true)
  assert.deepEqual(centered, [{
    lineNumber: 1,
    side: DiffCursorSide.ADDITIONS,
  }])
  assert.equal(activated.length, 6)

  rows = []
  cursor = null
  assert.equal(actions[ApplicationAction.CURSOR_DOWN](1), false)
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_DOWN](1), false)
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

test('scrolling keeps the cursor below a sticky file header', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollTop: 600,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = {
    getBoundingClientRect: () => ({ top: -600 }),
    shadowRoot: {
      querySelector: (selector) => (
        selector === '[data-diffs-header][data-sticky]'
          ? { getBoundingClientRect: () => ({ height: 52 }) }
          : null
      ),
    },
  }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 52, height: 20 }),
  }

  assert.equal(scrollDiffCursorIntoView(instance, node, {
    lineNumber: 1,
    side: DiffCursorSide.ADDITIONS,
  }), true)
  assert.deepEqual(scrolls, [{ top: 0 }])
})

test('scrolling uses rendered cursor bounds for wrapped rows', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollTop: 38,
    clientHeight: 614,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = {
    getBoundingClientRect: () => ({ top: -38 }),
    shadowRoot: {
      querySelector: () => ({ getBoundingClientRect: () => ({ height: 52 }) }),
      querySelectorAll: () => [
        { getBoundingClientRect: () => ({ top: 834, bottom: 894 }) },
        { getBoundingClientRect: () => ({ top: 834, bottom: 894 }) },
      ],
    },
  }
  const instance = {
    getEditorViewport: () => viewport,
    // The estimate still looks visible before Pierre measures the wrapped row.
    getLinePosition: () => ({ top: 400, height: 20 }),
  }

  assert.equal(scrollDiffCursorIntoView(instance, node, {
    lineNumber: 392,
    side: DiffCursorSide.ADDITIONS,
  }), true)
  assert.deepEqual(scrolls, [{ top: 318 }])
})

test('layout anchors preserve a logical row position and reconcile hidden rows', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollLeft: 25,
    scrollTop: 100,
    clientHeight: 80,
    getBoundingClientRect: () => ({ top: 20 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const node = { getBoundingClientRect: () => ({ top: -30 }) }
  const before = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 180, height: 20 }),
  }
  const cursor = { lineNumber: 12, side: DiffCursorSide.ADDITIONS }
  const anchor = captureDiffLayoutAnchor(before, node, cursor)

  assert.deepEqual(anchor, { left: 25, rowOffset: 130, top: 100 })

  const after = {
    getEditorViewport: () => viewport,
    getLinePosition: (lineNumber) => ({
      top: lineNumber === 12 ? 300 : 260,
      height: 20,
    }),
  }
  assert.equal(restoreDiffLayoutAnchor(anchor, after, node, cursor), true)
  assert.deepEqual(scrolls.pop(), { left: 25, top: 220 })

  const nearest = { lineNumber: 11, side: DiffCursorSide.ADDITIONS }
  assert.equal(restoreDiffLayoutAnchor(anchor, after, node, nearest), true)
  assert.deepEqual(scrolls.pop(), { left: 25, top: 180 })
})

test('layout anchors fall back to exact scroll offsets without a positioned cursor', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1,
    scrollLeft: 12,
    scrollTop: 90,
    clientHeight: 80,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const instance = { getEditorViewport: () => viewport }
  const node = { getBoundingClientRect: () => ({ top: 0 }) }
  const anchor = captureDiffLayoutAnchor(instance, node, null)

  assert.equal(restoreDiffLayoutAnchor(anchor, instance, node, null), true)
  assert.deepEqual(scrolls, [{ left: 12, top: 90 }])
  assert.equal(captureDiffLayoutAnchor(null, node, null), null)
  assert.equal(restoreDiffLayoutAnchor(null, instance, node, null), false)
})

test('cursor movement moves to, between, and from the file comment row', () => {
  const rows = [
    { index: -1, additions: 0, fileCommentRow: true },
    { index: 0, additions: 1, deletions: 1 },
    { index: 1, additions: 2, deletions: 2 },
  ]

  assert.deepEqual(moveDiffCursor(rows, null, 1), {
    lineNumber: 0,
    side: DiffCursorSide.ADDITIONS,
  })
  assert.deepEqual(moveDiffCursor(rows, {
    lineNumber: 0,
    side: DiffCursorSide.ADDITIONS,
  }, 1), { lineNumber: 1, side: DiffCursorSide.ADDITIONS })
  assert.deepEqual(moveDiffCursor(rows, {
    lineNumber: 1,
    side: DiffCursorSide.ADDITIONS,
  }, 1), { lineNumber: 2, side: DiffCursorSide.ADDITIONS })
  assert.deepEqual(moveDiffCursor(rows, {
    lineNumber: 2,
    side: DiffCursorSide.ADDITIONS,
  }, -2), { lineNumber: 0, side: DiffCursorSide.ADDITIONS })
})

test('half-page movement from the file comment row synthesizes a content-top center', () => {
  const rows = [
    { index: -1, additions: 0, fileCommentRow: true },
    { index: 0, additions: 1 },
    { index: 1, additions: 2 },
    { index: 2, additions: 3 },
  ]
  const cursor = { lineNumber: 0, side: DiffCursorSide.ADDITIONS }
  const instance = {
    getEditorViewport: () => ({ nodeType: 1, clientHeight: 100 }),
    getLinePosition(lineNumber) {
      if (lineNumber === 0) return undefined
      return { top: (lineNumber - 1) * 20, height: 20 }
    },
  }

  assert.deepEqual(moveDiffCursorByPage(instance, rows, cursor, 1), {
    lineNumber: 3,
    side: DiffCursorSide.ADDITIONS,
  })
  assert.equal(moveDiffCursorByPage(instance, rows, cursor, -1), cursor)
  assert.deepEqual(moveDiffCursorByPage({
    getEditorViewport: () => ({ nodeType: 1, clientHeight: 100 }),
    getLinePosition: (lineNumber) => ({ top: (lineNumber - 1) * 20, height: 20 }),
  }, rows, { lineNumber: 1, side: DiffCursorSide.ADDITIONS }, -1), {
    lineNumber: 1,
    side: DiffCursorSide.ADDITIONS,
  })
})

test('scrolling the file comment row reveals the file comment card', () => {
  const scrolls = []
  const container = {
    scrollTop: 100,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
  }
  const element = { getBoundingClientRect: () => ({ top: 500, height: 120 }) }
  container.querySelector = (selector) => (
    selector === '.saved-comment[data-comment-kind="file"]' ? element : null
  )
  const node = { closest: (selector) => (
    selector === '.diff-scroll' ? container : null
  ) }
  const cursor = { lineNumber: 0, side: DiffCursorSide.ADDITIONS }

  assert.equal(scrollDiffCursorIntoView(null, node, cursor), true)
  assert.deepEqual(scrolls, [{ top: 444 }])

  container.querySelector = () => null
  assert.equal(scrollDiffCursorIntoView(null, node, cursor), true)
  assert.deepEqual(scrolls, [{ top: 444 }, { top: 0 }])

  node.closest = () => null
  assert.equal(scrollDiffCursorIntoView(null, node, cursor), false)
})

test('centering the file comment row delegates to the scroll-into-view path', () => {
  const scrolls = []
  const container = {
    scrollTop: 100,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => scrolls.push(options),
    querySelector: () => ({ getBoundingClientRect: () => ({ top: 500, height: 120 }) }),
  }
  const node = { closest: () => container }
  const cursor = { lineNumber: 0, side: DiffCursorSide.ADDITIONS }

  assert.equal(centerDiffCursor(null, node, cursor), true)
  assert.deepEqual(scrolls, [{ top: 444 }])
})

test('line-zero cursor presentation clears the editor line while staying handled', () => {
  const writes = []
  const instance = {
    setEditorActiveLine: (...args) => writes.push(args),
  }
  const cursor = { lineNumber: 0, side: DiffCursorSide.ADDITIONS }

  assert.equal(syncDiffCursorPresentation(instance, cursor, true), true)
  assert.equal(syncDiffCursorPresentation(instance, cursor, false), false)
  assert.deepEqual(writes, [[null], [null]])
})

test('cursor reconciliation preserves the file comment row cursor', () => {
  const rows = [
    { index: -1, additions: 0, fileCommentRow: true },
    { index: 0, additions: 3, deletions: 4 },
  ]
  const existing = { lineNumber: 0, side: DiffCursorSide.ADDITIONS }

  assert.equal(reconcileDiffCursor(rows, existing), existing)
  assert.deepEqual(reconcileDiffCursor(rows, null), existing)
})


test('switching sides maps paired visual rows in both directions and preserves subsequent movement', () => {
  const rows = createDiffCursorRows(diffInstance(
    'context\nold one\nold two\ntail\nnext\n',
    'context\nnew one\ntail\nnext\n',
  ))
  const original = { lineNumber: 3, side: DiffCursorSide.ADDITIONS }
  const switched = switchDiffCursorSide(rows, original)
  assert.deepEqual(switched, { lineNumber: 4, side: DiffCursorSide.DELETIONS })
  assert.deepEqual(switchDiffCursorSide(rows, switched), original)
  assert.deepEqual(moveDiffCursor(rows, switched, 1), {
    lineNumber: 5, side: DiffCursorSide.DELETIONS,
  })
  assert.deepEqual(switchDiffCursorSide(rows, { lineNumber: 1, side: 'additions' }), {
    lineNumber: 1, side: 'deletions',
  })
})

test('side switching does nothing for one-sided, file-comment, missing, and stale cursors', () => {
  for (const [rows, cursor] of [
    [[{ additions: 2 }], { lineNumber: 2, side: 'additions' }],
    [[{ deletions: 2 }], { lineNumber: 2, side: 'deletions' }],
    [[{ additions: 0, fileCommentRow: true }], { lineNumber: 0, side: 'additions' }],
    [[{ additions: 2, deletions: 3 }], { lineNumber: 1, side: 'additions' }],
    [[], null],
  ]) {
    let activations = 0
    const actions = createDiffCursorActionAdapter({
      getRows: () => rows, getCursor: () => cursor,
      activateCursor: () => { activations++; return true },
    })
    assert.equal(switchDiffCursorSide(rows, cursor), null)
    assert.equal(actions[ApplicationAction.DIFF_SWITCH_SIDE](), false)
    assert.equal(activations, 0)
  }
})

test('switch action activates the mapped cursor for comment creation and existing comments', () => {
  const rows = [{ additions: 8, deletions: 7 }]
  let cursor = { lineNumber: 8, side: 'additions' }
  const comments = ['old', 'new'].map((side) => ({
    id: side, target: { kind: 'line', path: 'example.txt', side,
      startLine: side === 'old' ? 7 : 8, endLine: side === 'old' ? 7 : 8 },
  }))
  const actions = createDiffCursorActionAdapter({
    getRows: () => rows, getCursor: () => cursor,
    activateCursor: (next) => { cursor = next; return true },
  })
  for (const side of ['old', 'new']) {
    assert.equal(actions[ApplicationAction.DIFF_SWITCH_SIDE](), true)
    assert.equal(commentTargetAtCursor('example.txt', cursor, rows).side, side)
    assert.equal(commentAtCursor(comments, 'example.txt', cursor).id, side)
  }
})

test('cursor scrolling ignores a stale active marker and the opposite diff side', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1, scrollTop: 2000, clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: options => scrolls.push(options),
  }
  const node = {
    getBoundingClientRect: () => ({ top: -2000 }),
    shadowRoot: {
      querySelectorAll(selector) {
        if (selector === '[data-editor-active-line]') {
          return [{ getBoundingClientRect: () => ({ top: -2000, bottom: -1980 }) }]
        }
        assert.equal(selector, '[data-line="801"]')
        return [{
          closest: () => ({ hasAttribute: name => name === 'data-deletions' }),
          getBoundingClientRect: () => ({ top: -2000, bottom: -1980 }),
        }]
      },
    },
  }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 2400, height: 20 }),
  }
  scrollDiffCursorIntoView(instance, node, { lineNumber: 801, side: 'additions' })
  assert.deepEqual(scrolls, [])
})

test('an unrendered row with a tall comment does not scroll its code above the viewport', () => {
  const scrolls = []
  const viewport = {
    nodeType: 1, scrollTop: 1000, clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: options => scrolls.push(options),
  }
  const instance = {
    getEditorViewport: () => viewport,
    getLinePosition: () => ({ top: 2000, height: 1200 }),
  }
  scrollDiffCursorIntoView(instance, {
    getBoundingClientRect: () => ({ top: -1000 }),
  }, { lineNumber: 801, side: 'additions' })
  assert.deepEqual(scrolls, [{ top: 2000 }])
})
