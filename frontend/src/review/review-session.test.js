import assert from 'node:assert/strict'
import test from 'node:test'

import { TreeMode } from '../app/workspace.js'
import {
  createFilesModeEntries,
  selectActivePath,
  selectVisibleFiles,
} from './review-session.js'

const changedFile = {
  path: 'src/changed.js',
  previousPath: null,
  status: 'modified',
  additions: 3,
  deletions: 1,
}
const overview = {
  initialPath: changedFile.path,
  files: [changedFile],
}

test('files mode merges changed and repository files without losing metadata', () => {
  const entries = createFilesModeEntries(overview, [
    'src/unchanged.js',
    changedFile.path,
  ])

  assert.deepEqual(entries, [
    changedFile,
    {
      path: 'src/unchanged.js',
      previousPath: null,
      status: 'unchanged',
      additions: null,
      deletions: null,
    },
  ])
  assert.equal(entries[0], changedFile)
})

test('tree mode authoritatively selects changed or repository-wide entries', () => {
  const filesModeEntries = createFilesModeEntries(overview, ['README.md'])

  assert.equal(
    selectVisibleFiles(overview, filesModeEntries, TreeMode.CHANGES),
    overview.files,
  )
  assert.equal(
    selectVisibleFiles(overview, filesModeEntries, TreeMode.FILES),
    filesModeEntries,
  )
})

test('active paths retain valid selection and fall back deterministically', () => {
  const visibleFiles = [{ path: 'a.js' }, { path: 'b.js' }]

  assert.equal(selectActivePath(visibleFiles, 'b.js', 'a.js'), 'b.js')
  assert.equal(selectActivePath(visibleFiles, 'missing.js', 'a.js'), 'a.js')
  assert.equal(selectActivePath(visibleFiles, 'missing.js', 'missing-too.js'), 'a.js')
  assert.equal(selectActivePath([], 'a.js', 'a.js'), null)
})
