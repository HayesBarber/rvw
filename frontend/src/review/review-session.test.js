import assert from 'node:assert/strict'
import test from 'node:test'

import { TreeMode } from '../app/workspace.js'
import { selectActivePath } from '../app/file-selection.js'
import {
  createFilesModeEntries,
  includeSelectedFile,
  selectEmptyReviewTreeMode,
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

test('explicit selections stay visible before the repository list loads', () => {
  const entries = [changedFile]

  assert.deepEqual(includeSelectedFile(entries, 'src/picked.js'), [
    changedFile,
    {
      path: 'src/picked.js',
      previousPath: null,
      status: 'unchanged',
      additions: null,
      deletions: null,
    },
  ])
  assert.equal(includeSelectedFile(entries, changedFile.path), entries)
  assert.equal(includeSelectedFile(entries, null), entries)
  assert.equal(includeSelectedFile(entries, ''), entries)
  assert.equal(includeSelectedFile([], 'src/picked.js')?.[0]?.path, 'src/picked.js')
})

test('empty reviews return FILES mode', () => {
  for (const mode of [TreeMode.CHANGES, TreeMode.FILES]) {
    assert.equal(
      selectEmptyReviewTreeMode({ files: [] }, mode),
      TreeMode.FILES,
    )
  }
})

test('reviews with changes never alter the tree mode', () => {
  assert.equal(
    selectEmptyReviewTreeMode(overview, TreeMode.CHANGES),
    TreeMode.CHANGES,
  )
  assert.equal(
    selectEmptyReviewTreeMode(overview, TreeMode.FILES),
    TreeMode.FILES,
  )
})

test('missing reviews leave the tree mode untouched', () => {
  for (const missing of [null, undefined]) {
    assert.equal(
      selectEmptyReviewTreeMode(missing, TreeMode.CHANGES),
      TreeMode.CHANGES,
    )
    assert.equal(
      selectEmptyReviewTreeMode(missing, TreeMode.FILES),
      TreeMode.FILES,
    )
  }
})

test('active paths retain valid selection and fall back deterministically', () => {
  const visibleFiles = [{ path: 'a.js' }, { path: 'b.js' }]

  assert.equal(selectActivePath(visibleFiles, 'b.js', 'a.js'), 'b.js')
  assert.equal(selectActivePath(visibleFiles, 'missing.js', 'a.js'), 'a.js')
  assert.equal(selectActivePath(visibleFiles, 'missing.js', 'missing-too.js'), 'a.js')
  assert.equal(selectActivePath([], 'a.js', 'a.js'), null)
})


test('history selections remain active while a missing file reports its error', () => {
  const files = [{ path: 'A' }, { path: 'C' }]
  assert.equal(selectActivePath(files, 'B', 'A', true), 'B')
  assert.equal(selectActivePath(files, null, 'A', true), 'A')
})

test('empty reviews prefer the first sorted root file without changing file order', () => {
  const entries = createFilesModeEntries({ files: [] }, [
    'z.txt', 'assets/a.txt', 'README.md', 'build.zig',
  ])
  const paths = entries.map((file) => file.path)
  assert.equal(paths[0], 'assets/a.txt')
  assert.equal(selectActivePath(entries, null, null, false, true), 'build.zig')
  assert.deepEqual(entries.map((file) => file.path), paths)
  assert.equal(selectActivePath(entries, null, null), 'assets/a.txt')
})

test('empty reviews keep hidden and ignored root files eligible', () => {
  for (const rootPath of ['.hidden', 'ignored.cache']) {
    const entries = createFilesModeEntries({ files: [] }, ['a/nested.txt', rootPath])
    assert.equal(selectActivePath(entries, null, null, false, true), rootPath)
  }
})

test('empty reviews fall back to the first nested file or no file', () => {
  const entries = createFilesModeEntries({ files: [] }, ['z/file.txt', 'a/file.txt'])
  assert.equal(selectActivePath(entries, null, null, false, true), 'a/file.txt')
  assert.equal(selectActivePath([], null, null, false, true), null)
})

test('root preference preserves selected, initial, and history paths', () => {
  const entries = createFilesModeEntries({ files: [] }, ['a/file.txt', 'root.txt'])
  assert.equal(selectActivePath(entries, 'a/file.txt', null, false, true), 'a/file.txt')
  assert.equal(selectActivePath(entries, null, 'a/file.txt', false, true), 'a/file.txt')
  assert.equal(selectActivePath(entries, 'missing.txt', null, true, true), 'missing.txt')
  assert.equal(selectActivePath(entries, 'missing.txt', null, false, true), 'root.txt')
})
