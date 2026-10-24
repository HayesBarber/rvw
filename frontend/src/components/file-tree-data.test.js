import assert from 'node:assert/strict'
import test from 'node:test'
import { FileTree } from '@pierre/trees'
import { updateFileTreeData } from './file-tree-data.js'

test('reload removes committed files from the existing Changes tree', (t) => {
  const paths = ['a.js', 'b.js', 'c.js', 'd.js', 'src/committed.js']
  const model = new FileTree({ paths, initialExpansion: 'open' })
  t.after(() => model.cleanUp())
  model.getItem('a.js').select()
  model.focusPath('a.js')

  const remaining = paths.slice(0, 4)
  updateFileTreeData(model, remaining, remaining.map((path) => ({
    path, status: 'modified',
  })))

  assert.equal(model.getItem('src/committed.js'), null)
  assert.equal(model.getItem('src/'), null)
  assert.deepEqual(model.getVisibleRows(0, 10).map((row) => row.path), remaining)
  assert.deepEqual(model.getSelectedPaths(), ['a.js'])
  assert.equal(model.getFocusedPath(), 'a.js')
})

test('reload replaces status indicators even when paths do not change', (t) => {
  const paths = ['a.js', 'b.js']
  const model = new FileTree({
    paths,
    gitStatus: paths.map((path) => ({ path, status: 'modified' })),
  })
  t.after(() => model.cleanUp())
  const setGitStatus = t.mock.method(model, 'setGitStatus')

  updateFileTreeData(model, paths, [{ path: 'b.js', status: 'added' }])
  assert.deepEqual(setGitStatus.mock.calls.at(-1).arguments, [
    [{ path: 'b.js', status: 'added' }],
  ])

  updateFileTreeData(model, paths, [])
  assert.deepEqual(setGitStatus.mock.calls.at(-1).arguments, [[]])
})

test('reload can clear the tree and then add new changed files', (t) => {
  const model = new FileTree({ paths: ['committed.js'] })
  t.after(() => model.cleanUp())
  model.getItem('committed.js').select()

  updateFileTreeData(model, [], [])
  assert.equal(model.getVisibleCount(), 0)
  assert.deepEqual(model.getSelectedPaths(), [])

  updateFileTreeData(model, ['new.js'], [{ path: 'new.js', status: 'added' }])
  assert.ok(model.getItem('new.js'))
  assert.equal(model.getItem('committed.js'), null)
})
