import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import {
  createFileFinderActionAdapter,
  moveFileFinderSelection,
} from './file-finder-actions.js'

test('result movement wraps and applies Vim counts', () => {
  assert.equal(moveFileFinderSelection(5, 0, 1), 1)
  assert.equal(moveFileFinderSelection(5, 0, -1), 4)
  assert.equal(moveFileFinderSelection(5, 1, 1, 8), 4)
  assert.equal(moveFileFinderSelection(5, 3, -1, 9), 4)
  assert.equal(moveFileFinderSelection(0, -1, 1, 2), 0)
})

test('finder actions navigate and activate the current filtered result', () => {
  let results = ['README.md', 'src/main.zig', 'src/rvw.zig']
  let activeIndex = 0
  const opened = []
  const adapter = createFileFinderActionAdapter({
    getResults: () => results,
    getActiveIndex: () => activeIndex,
    setActiveIndex: (index) => {
      activeIndex = index
    },
    onOpen: (path) => opened.push(path),
  })

  assert.equal(adapter[ApplicationAction.CURSOR_DOWN](2), true)
  assert.equal(activeIndex, 2)
  assert.equal(adapter[ApplicationAction.CURSOR_UP](4), true)
  assert.equal(activeIndex, 1)
  assert.equal(adapter[ApplicationAction.CURSOR_LAST](), true)
  assert.equal(activeIndex, 2)
  assert.equal(adapter[ApplicationAction.CURSOR_FIRST](), true)
  assert.equal(activeIndex, 0)

  results = ['src/main.zig']
  assert.equal(adapter[ApplicationAction.FILE_TREE_ITEM_ACTIVATE](), true)
  assert.deepEqual(opened, ['src/main.zig'])
})

test('finder actions are unhandled when there are no results', () => {
  const adapter = createFileFinderActionAdapter({
    getResults: () => [],
    getActiveIndex: () => -1,
    setActiveIndex: () => assert.fail('selection should not move'),
    onOpen: () => assert.fail('a result should not open'),
  })

  for (const action of [
    ApplicationAction.CURSOR_UP,
    ApplicationAction.CURSOR_DOWN,
    ApplicationAction.CURSOR_FIRST,
    ApplicationAction.CURSOR_LAST,
    ApplicationAction.FILE_TREE_ITEM_ACTIVATE,
  ]) {
    assert.equal(adapter[action](3), false)
  }
})
