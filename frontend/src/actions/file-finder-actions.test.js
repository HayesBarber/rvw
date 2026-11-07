import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import { createFileFinderActionAdapter } from './file-finder-actions.js'

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

  assert.equal(adapter[ApplicationAction.CURSOR_UP](), true)
  assert.equal(activeIndex, 0)
  assert.equal(adapter[ApplicationAction.CURSOR_DOWN](4), true)
  assert.equal(activeIndex, 2)
  assert.equal(adapter[ApplicationAction.CURSOR_DOWN](), true)
  assert.equal(activeIndex, 2)
  assert.equal(adapter[ApplicationAction.CURSOR_UP](4), true)
  assert.equal(activeIndex, 0)
  assert.equal(adapter[ApplicationAction.CURSOR_LAST](), true)
  assert.equal(activeIndex, 2)
  assert.equal(adapter[ApplicationAction.CURSOR_FIRST](), true)
  assert.equal(activeIndex, 0)
  assert.deepEqual(opened, [])

  results = ['src/main.zig']
  assert.equal(adapter[ApplicationAction.ITEM_ACTIVATE](), true)
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
    ApplicationAction.ITEM_ACTIVATE,
  ]) {
    assert.equal(adapter[action](3), false)
  }
})
