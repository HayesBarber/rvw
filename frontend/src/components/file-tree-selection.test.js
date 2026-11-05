import assert from 'node:assert/strict'
import test from 'node:test'
import { FileTree } from '@pierre/trees'
import { includeSelectedFile } from '../review/review-session.js'
import { synchronizeFileTreeSelection } from './file-tree-selection.js'

test('file selection preserves expanded folders and reveals closed ancestors', (t) => {
  const paths = ['alpha/a.js', 'alpha/other.js', 'beta/b.js', 'gamma/c.js', 'delta/d.js']
  const model = new FileTree({ paths, initialExpansion: 'closed' })
  t.after(() => model.cleanUp())
  for (const directory of ['alpha/', 'beta/', 'gamma/']) model.getItem(directory).expand()

  for (const path of ['alpha/a.js', 'beta/b.js', 'alpha/other.js', 'alpha/a.js', 'delta/d.js']) {
    // Files mode supplies a new path set on each selection.
    synchronizeFileTreeSelection(model, new Set(paths), path)
    assert.deepEqual(model.getSelectedPaths(), [path])
    assert.equal(model.getFocusedPath(), path)
    for (const directory of ['alpha/', 'beta/', 'gamma/']) {
      assert.equal(model.getItem(directory).isExpanded(), true, directory)
    }
  }
  assert.equal(model.getItem('delta/').isExpanded(), true)
})

test('selected paths remain visible when the repository list is unavailable', (t) => {
  const entries = [{ path: 'alpha/a.js', status: 'modified' }]
  const model = new FileTree({ paths: entries.map((file) => file.path), initialExpansion: 'closed' })
  t.after(() => model.cleanUp())
  model.getItem('alpha/').expand()

  for (const path of ['beta/b.js', 'gamma/c.js', 'beta/b.js']) {
    const files = includeSelectedFile(entries, path)
    synchronizeFileTreeSelection(model, new Set(files.map((file) => file.path)), path)
    assert.deepEqual(model.getSelectedPaths(), [path])
    assert.equal(model.getFocusedPath(), path)
    assert.equal(model.getItem(path.slice(0, path.indexOf('/') + 1)).isExpanded(), true)
    assert.equal(model.getItem('alpha/').isExpanded(), true)
  }
})

test('clearing selection preserves expanded folders and does not add unknown files', (t) => {
  const model = new FileTree({ paths: ['alpha/a.js'], initialExpansion: 'open' })
  t.after(() => model.cleanUp())
  const paths = new Set(['alpha/a.js'])
  synchronizeFileTreeSelection(model, paths, 'alpha/a.js')
  synchronizeFileTreeSelection(model, paths, null)
  assert.deepEqual(model.getSelectedPaths(), [])
  assert.equal(model.getItem('alpha/').isExpanded(), true)
  synchronizeFileTreeSelection(model, paths, 'missing.js')
  assert.equal(model.getItem('missing.js'), null)
})
