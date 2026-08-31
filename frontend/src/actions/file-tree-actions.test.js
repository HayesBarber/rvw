import assert from 'node:assert/strict'
import test from 'node:test'

import { FileTree } from '@pierre/trees'
import { ApplicationAction } from './application-actions.js'
import {
  createFileTreeActionAdapter,
  fileTreeFocusCSS,
} from './file-tree-actions.js'

function createTree(paths = ['README.md', 'src/index.js', 'src/view.js']) {
  return new FileTree({ initialExpansion: 'open', paths })
}

test('file-tree cursor styling is gated by the host visibility state', () => {
  assert.equal(
    fileTreeFocusCSS.match(
      /:host\(\[data-cursor-visible='true'\]\)/g,
    )?.length,
    2,
  )
})

test('cursor actions move focus with counts and request nearest scrolling', (t) => {
  const model = createTree()
  t.after(() => model.cleanUp())
  const scrollRequests = []
  const scrollToPath = model.scrollToPath.bind(model)
  model.scrollToPath = (path, options) => {
    scrollRequests.push([path, options])
    scrollToPath(path, options)
  }
  const actions = createFileTreeActionAdapter(model, () => {})

  assert.equal(actions[ApplicationAction.CURSOR_DOWN](2), true)
  assert.equal(model.getFocusedPath(), 'src/view.js')
  assert.deepEqual(scrollRequests.at(-1), [
    'src/view.js',
    { focus: false, offset: 'nearest' },
  ])

  assert.equal(actions[ApplicationAction.CURSOR_UP](1), true)
  assert.equal(model.getFocusedPath(), 'src/index.js')
  actions[ApplicationAction.CURSOR_LAST]()
  assert.equal(model.getFocusedPath(), 'README.md')
  actions[ApplicationAction.CURSOR_FIRST]()
  assert.equal(model.getFocusedPath(), 'src/')
})

test('activation opens files without changing selection during focus movement', (t) => {
  const model = createTree()
  t.after(() => model.cleanUp())
  const opened = []
  const actions = createFileTreeActionAdapter(model, (path) => opened.push(path))

  assert.deepEqual(model.getSelectedPaths(), [])
  model.focusPath('src/view.js')
  assert.deepEqual(model.getSelectedPaths(), [])
  assert.deepEqual(opened, [])

  assert.equal(actions[ApplicationAction.FILE_TREE_ITEM_ACTIVATE](), true)
  assert.deepEqual(opened, ['src/view.js'])
  assert.deepEqual(model.getSelectedPaths(), [])
})

test('half-page actions use the live viewport, scale counts, clamp, and keep focus semantics', (t) => {
  const paths = Array.from({ length: 10 }, (_, index) => `${index}.txt`)
  const model = createTree(paths)
  t.after(() => model.cleanUp())
  const opened = []
  const scrollRequests = []
  model.getFileTreeContainer = () => ({ clientHeight: model.getItemHeight() * 4 })
  model.scrollToPath = (path, options) => scrollRequests.push([path, options])
  const actions = createFileTreeActionAdapter(model, (path) => opened.push(path))

  model.focusPath('2.txt')
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_DOWN](), true)
  assert.equal(model.getFocusedPath(), '4.txt')
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_DOWN](2), true)
  assert.equal(model.getFocusedPath(), '8.txt')
  assert.equal(actions[ApplicationAction.CURSOR_PAGE_UP](20), true)
  assert.equal(model.getFocusedPath(), '0.txt')
  assert.deepEqual(model.getSelectedPaths(), [])
  assert.deepEqual(opened, [])
  assert.deepEqual(scrollRequests.at(-1), [
    '0.txt',
    { focus: false, offset: 'nearest' },
  ])
})

test('half-page actions safely handle non-scrollable, unmounted, and empty trees', (t) => {
  const nonScrollable = createTree(['0.txt', '1.txt', '2.txt'])
  const unmounted = createTree()
  const empty = createTree([])
  t.after(() => {
    nonScrollable.cleanUp()
    unmounted.cleanUp()
    empty.cleanUp()
  })

  nonScrollable.getFileTreeContainer = () => ({ clientHeight: 300 })
  nonScrollable.scrollToPath = () => {}
  nonScrollable.focusFirstItem()
  assert.equal(createFileTreeActionAdapter(
    nonScrollable,
    () => {},
  )[ApplicationAction.CURSOR_PAGE_DOWN](), true)
  assert.equal(nonScrollable.getFocusedPath(), '2.txt')

  assert.equal(createFileTreeActionAdapter(
    unmounted,
    () => {},
  )[ApplicationAction.CURSOR_PAGE_DOWN](), false)

  empty.getFileTreeContainer = () => ({ clientHeight: 120 })
  assert.equal(createFileTreeActionAdapter(
    empty,
    () => {},
  )[ApplicationAction.CURSOR_PAGE_UP](), false)
})

test('centering scrolls the focused item without focusing, selecting, or opening', (t) => {
  const model = createTree()
  t.after(() => model.cleanUp())
  const opened = []
  const scrollRequests = []
  model.focusPath('src/view.js')
  model.scrollToPath = (path, options) => scrollRequests.push([path, options])
  const actions = createFileTreeActionAdapter(model, (path) => opened.push(path))

  assert.equal(actions[ApplicationAction.CURSOR_CENTER](), true)
  assert.equal(model.getFocusedPath(), 'src/view.js')
  assert.deepEqual(model.getSelectedPaths(), [])
  assert.deepEqual(opened, [])
  assert.deepEqual(scrollRequests, [[
    'src/view.js',
    { focus: false, offset: 'center' },
  ]])
})

test('centering an empty file tree is a safe no-op', (t) => {
  const model = createTree([])
  t.after(() => model.cleanUp())
  const actions = createFileTreeActionAdapter(model, () => {
    throw new Error('empty trees must not open a file')
  })

  assert.equal(actions[ApplicationAction.CURSOR_CENTER](), false)
})

test('directory actions toggle, collapse, expand, and move to the parent', (t) => {
  const model = createTree()
  t.after(() => model.cleanUp())
  const actions = createFileTreeActionAdapter(model, () => {})

  model.focusPath('src/')
  const directory = model.getFocusedItem()
  assert.equal(directory.isDirectory(), true)
  assert.equal(directory.isExpanded(), true)

  assert.equal(actions[ApplicationAction.FILE_TREE_ITEM_ACTIVATE](), true)
  assert.equal(directory.isExpanded(), false)
  assert.equal(actions[ApplicationAction.TREE_EXPAND](), true)
  assert.equal(directory.isExpanded(), true)
  assert.equal(actions[ApplicationAction.TREE_COLLAPSE_OR_PARENT](), true)
  assert.equal(directory.isExpanded(), false)

  directory.expand()
  model.focusPath('src/index.js')
  assert.equal(actions[ApplicationAction.TREE_COLLAPSE_OR_PARENT](), true)
  assert.equal(model.getFocusedPath(), 'src/')
  assert.equal(actions[ApplicationAction.TREE_EXPAND](), true)

  model.focusPath('README.md')
  assert.equal(actions[ApplicationAction.TREE_EXPAND](), false)
})
