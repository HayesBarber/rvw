import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualSelection } from './visual-selection.js'
import { createDiffCursorActionAdapter } from './diff-cursor-actions.js'
import { ApplicationAction, defaultApplicationBindings } from './application-actions.js'
import { VimController, VimMode } from '../vim/machine.js'
import { normalizeCommentRange } from '../components/diff-pane/comment-annotations.js'

for (const side of ['additions', 'deletions']) {
  test(`visual movement stays on ${side}, reverses and includes hidden source lines`, () => {
    const opposite = side === 'additions' ? 'deletions' : 'additions'
    const rows = [{ index: -1, [side]: 0 }, { index: 0, [side]: 1 },
      { index: 1, [opposite]: 2 }, { index: 2, [side]: 3 }, { index: 8, [side]: 20 }]
    let cursor = { lineNumber: 3, side }
    const selection = createVisualSelection()
    let range = selection.begin(rows, cursor)
    const adapter = createDiffCursorActionAdapter({
      getRows: () => selection.rows(rows), getCursor: () => cursor,
      getPreferredSide: () => selection.side,
      activateCursor: (next) => { cursor = next; range = selection.extend(next); return true },
    })
    const controller = new VimController({ bindings: defaultApplicationBindings, initialMode: VimMode.VISUAL })
    controller.subscribeCommands((command) => adapter[command.args.actions[0]]?.(command.count))
    controller.subscribe(() => { if (controller.getSnapshot().mode === VimMode.NORMAL) selection.clear() })
    controller.dispatch({ type: 'key', key: '9' })
    controller.dispatch({ type: 'key', key: 'j' })
    assert.deepEqual(range, { start: 3, end: 20, side, endSide: side })
    controller.dispatch({ type: 'key', key: '9' })
    controller.dispatch({ type: 'key', key: 'k' })
    assert.deepEqual(range, { start: 1, end: 3, side, endSide: side })
    assert.equal(cursor.lineNumber, 1)
    assert.deepEqual(normalizeCommentRange('file', range, true).target, {
      kind: 'line', path: 'file', side: side === 'deletions' ? 'old' : 'new', startLine: 1, endLine: 3,
    })
    controller.dispatch({ type: 'key', key: 'G' })
    assert.equal(cursor.side, side)
    assert.equal(cursor.lineNumber, 20)
    controller.dispatch({ type: 'key', key: 'g' })
    controller.dispatch({ type: 'key', key: 'g' })
    assert.equal(cursor.lineNumber, 1)
    controller.dispatch({ type: 'key', key: '3' })
    controller.dispatch({ type: 'key', key: 'g' })
    controller.dispatch({ type: 'key', key: '<Esc>' })
    assert.deepEqual(controller.getSnapshot(), { mode: 'normal', count: '', pendingKeys: [] })
    assert.equal(selection.side, undefined)
    assert.equal(selection.extend(cursor), null)
  })
}

test('visual entry rejects empty and annotation-only rows and accepts one line', () => {
  const selection = createVisualSelection()
  assert.equal(selection.begin([], null), null)
  assert.equal(selection.begin([{ additions: 0 }], { side: 'additions', lineNumber: 0 }), null)
  assert.equal(selection.begin([], { side: 'additions', lineNumber: 1 }), null)
  assert.deepEqual(selection.begin([{ additions: 1 }], { side: 'additions', lineNumber: 1 }), {
    start: 1, end: 1, side: 'additions', endSide: 'additions',
  })
  assert.equal(selection.extend({ side: 'deletions', lineNumber: 1 }), null)
})

test('visual c emits only the range comment action', () => {
  const controller = new VimController({ bindings: defaultApplicationBindings, initialMode: VimMode.VISUAL })
  const result = controller.dispatch({ type: 'key', key: 'c' })
  assert.deepEqual(result.command.args.actions, [ApplicationAction.ADD_COMMENT])
})

test('visual page movement uses wrapped row heights and clamps on the anchored side', () => {
  const rows = [{ index: 0, deletions: 1 }, { index: 1, additions: 1 },
    { index: 2, deletions: 2 }, { index: 3, deletions: 30 }]
  let cursor = { lineNumber: 1, side: 'deletions' }
  const selection = createVisualSelection()
  selection.begin(rows, cursor)
  const adapter = createDiffCursorActionAdapter({
    getRows: () => selection.rows(rows), getCursor: () => cursor,
    getPreferredSide: () => selection.side,
    getInstance: () => ({
      getEditorViewport: () => ({ clientHeight: 200 }),
      getLinePosition: (line, side) => {
        assert.equal(side, 'deletions')
        return { top: { 1: 0, 2: 100, 30: 300 }[line], height: line === 2 ? 120 : 20 }
      },
    }),
    activateCursor: (next) => { cursor = next; return true },
  })
  adapter[ApplicationAction.CURSOR_PAGE_DOWN](1)
  assert.equal(cursor.lineNumber, 2)
  adapter[ApplicationAction.CURSOR_PAGE_DOWN](99)
  assert.equal(cursor.lineNumber, 30)
  assert.equal(selection.extend(cursor).end, 30)
  adapter[ApplicationAction.CURSOR_PAGE_UP](99)
  assert.equal(cursor.lineNumber, 1)
})
