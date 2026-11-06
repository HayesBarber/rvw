import assert from 'node:assert/strict'
import test from 'node:test'
import { FileTree } from '@pierre/trees'
import { initialWorkspaceState, TreeMode, workspaceReducer } from '../app/workspace.js'
import { synchronizeFileTreeSelection } from '../components/file-tree-selection.js'
import { createFilesModeEntries, selectVisibleFiles } from '../review/review-session.js'
import { relativeFilePath } from './file-navigation-actions.js'
import { setFileViewed } from './viewed-file-actions.js'

for (const mode of [TreeMode.CHANGES, TreeMode.FILES]) {
  test(`marking files in ${mode} skips viewed and unchanged files, reveals parents, and wraps`, (t) => {
    const changedFiles = ['root.js', 'beta/deep/b.js', 'alpha/a.js', 'alpha/viewed.js']
      .map((path) => ({ path, status: 'modified' }))
    const entries = createFilesModeEntries({ files: changedFiles }, [
      'alpha/unchanged.js', 'beta/deep/unchanged.js', 'unchanged.js',
    ])
    const files = selectVisibleFiles({ files: changedFiles }, entries, mode)
    const paths = new Set(files.map((file) => file.path))
    const model = new FileTree({ paths: [...paths], initialExpansion: 'closed' })
    t.after(() => model.cleanUp())
    let state = {
      ...initialWorkspaceState,
      treeMode: mode,
      selectedPath: 'alpha/a.js',
      viewedPaths: ['alpha/viewed.js'],
    }
    const dispatchWorkspace = (action) => {
      state = workspaceReducer(state, action)
      synchronizeFileTreeSelection(model, paths, state.selectedPath)
    }
    const navigations = []
    const navigateFile = (direction, count, options) => {
      navigations.push(options.paths)
      const path = relativeFilePath(options.paths, state.selectedPath, direction, count, options)
      if (!path) return false
      dispatchWorkspace({ type: 'file_selected', path })
      return true
    }
    const setViewed = (viewed, path = state.selectedPath) => setFileViewed({
      path, viewed, changedFiles, viewedPaths: state.viewedPaths, dispatchWorkspace, navigateFile,
    })

    assert.equal(setViewed(true), true)
    assert.deepEqual(navigations[0], ['alpha/a.js', 'beta/deep/b.js', 'root.js'])
    assert.equal(state.selectedPath, 'beta/deep/b.js')
    assert.equal(model.getFocusedPath(), state.selectedPath)
    assert.deepEqual(model.getSelectedPaths(), [state.selectedPath])
    assert.equal(model.getItem('beta/').isExpanded(), true)
    assert.equal(model.getItem('beta/deep/').isExpanded(), true)

    // Make an earlier file eligible without changing the current selection.
    assert.equal(setViewed(false, 'alpha/a.js'), true)
    assert.equal(state.selectedPath, 'beta/deep/b.js')
    assert.equal(navigations.length, 1)
    assert.equal(setViewed(true), true)
    assert.equal(state.selectedPath, 'root.js')
    assert.equal(setViewed(true), true)
    assert.equal(state.selectedPath, 'alpha/a.js')
    assert.equal(model.getItem('alpha/').isExpanded(), true)

    assert.equal(setViewed(true), true)
    assert.equal(state.viewedPaths.length, changedFiles.length)
    assert.equal(state.selectedPath, 'alpha/a.js')
    const completed = state
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(setViewed(true), false)
      assert.equal(navigateFile(1, 1, { paths: [state.selectedPath], wrap: true }), false)
      assert.equal(state, completed)
      assert.deepEqual(model.getSelectedPaths(), ['alpha/a.js'])
    }
    assert.equal(setViewed(false), true)
    assert.equal(state.selectedPath, 'alpha/a.js')
    assert.equal(state.viewedPaths.includes('alpha/a.js'), false)
  })
}

test('unchanged files and invalid viewed values cannot set status or navigate', () => {
  const options = {
    changedFiles: [{ path: 'changed.js' }],
    viewedPaths: [],
    dispatchWorkspace: () => assert.fail('Changed workspace state'),
    navigateFile: () => assert.fail('Changed selection'),
  }
  for (const path of [null, 'unchanged.js']) {
    assert.equal(setFileViewed({ ...options, path, viewed: true }), false)
  }
  for (const viewed of [undefined, null, 'true']) {
    assert.equal(setFileViewed({ ...options, path: 'changed.js', viewed }), false)
  }
})
