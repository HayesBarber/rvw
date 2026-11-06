import assert from 'node:assert/strict'
import test from 'node:test'
import { FileTree } from '@pierre/trees'
import { initialWorkspaceState, TreeMode, workspaceReducer } from '../app/workspace.js'
import { synchronizeFileTreeSelection } from '../components/file-tree-selection.js'
import { createFilesModeEntries, selectVisibleFiles } from '../review/review-session.js'
import { relativeFilePath } from './file-navigation-actions.js'
import { createViewedFileChange, setFileViewed } from './viewed-file-actions.js'
import { ActiveSurface } from '../app/workspace.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { resolveCommand } from './command-line.js'

function delayedViewedFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const change = createViewedFileChange()
  t.after(change.cancel)
  let state = { ...initialWorkspaceState, selectedPath: 'a.js' }
  const navigations = []
  const set = (viewed) => change.set({
    path: state.selectedPath,
    viewed,
    changedFiles: [{ path: 'a.js' }, { path: 'b.js' }],
    viewedPaths: state.viewedPaths,
    dispatchWorkspace: (action) => { state = workspaceReducer(state, action) },
    navigateFile: (direction, count, options) => {
      navigations.push(options.paths)
      const path = relativeFilePath(options.paths, state.selectedPath, direction, count, options)
      if (path) state = workspaceReducer(state, { type: 'file_selected', path })
    },
  })
  return { change, set, navigations, getState: () => state }
}

test('viewed status updates before automatic navigation and advances once after feedback', (t) => {
  const { set, getState, navigations } = delayedViewedFixture(t)
  assert.equal(set(true), true)
  assert.deepEqual(getState().viewedPaths, ['a.js'])
  assert.equal(getState().selectedPath, 'a.js')
  t.mock.timers.tick(149)
  assert.equal(getState().selectedPath, 'a.js')
  assert.deepEqual(navigations, [])
  t.mock.timers.tick(1)
  assert.equal(getState().selectedPath, 'b.js')
  assert.deepEqual(navigations, [['a.js', 'b.js']])
  t.mock.timers.tick(1000)
  assert.equal(navigations.length, 1)
})

test('clearing viewed status cancels the pending automatic navigation', (t) => {
  const { set, getState, navigations } = delayedViewedFixture(t)
  set(true)
  t.mock.timers.tick(50)
  set(false)
  t.mock.timers.tick(1000)
  assert.deepEqual(getState().viewedPaths, [])
  assert.equal(getState().selectedPath, 'a.js')
  assert.deepEqual(navigations, [])
})

test('leaving a file or disposing the review can cancel its pending navigation', (t) => {
  const { change, set, getState, navigations } = delayedViewedFixture(t)
  set(true)
  change.cancel()
  change.cancel()
  t.mock.timers.tick(1000)
  assert.deepEqual(getState().viewedPaths, ['a.js'])
  assert.equal(getState().selectedPath, 'a.js')
  assert.deepEqual(navigations, [])
})

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

for (const surface of [ActiveSurface.FILE_TREE, ActiveSurface.DIFF_PANE]) {
  for (const custom of [false, true]) {
    test(`${custom ? 'configured' : 'default r'} viewed action marks, advances, and clears from ${surface}`, () => {
      const action = ApplicationAction.TOGGLE_FILE_VIEWED
      const configuration = resolveConfiguration({ configuration: custom
        ? { keybindings: { normal: { [action]: [['x']] } } }
        : {} })
      assert.equal(configuration.diagnostic, null)
      let state = { ...initialWorkspaceState, selectedPath: 'a.js' }
      let overlay = null
      const dispatchWorkspace = (action) => { state = workspaceReducer(state, action) }
      const toggleViewed = () => setFileViewed({
        path: state.selectedPath,
        viewed: !state.viewedPaths.includes(state.selectedPath),
        changedFiles: [{ path: 'a.js' }, { path: 'b.js' }],
        viewedPaths: state.viewedPaths,
        dispatchWorkspace,
        navigateFile: (direction, count, options) => {
          const path = relativeFilePath(options.paths, state.selectedPath, direction, count, options)
          if (!path) return false
          dispatchWorkspace({ type: 'file_selected', path })
          return true
        },
      })
      const dispatch = createApplicationDispatcher({
        getActiveSurface: () => surface,
        getSurfaceActions: () => ({}),
        getOverlayActions: () => overlay,
        globalActions: { [action]: toggleViewed },
      })
      const controller = new VimController({ bindings: configuration.bindings })
      controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
      const press = (key) => controller.dispatch({ type: 'key', key })
      if (custom) assert.equal(press('r').handled, false)
      const key = custom ? 'x' : 'r'
      press(key)
      assert.deepEqual(state.viewedPaths, ['a.js'])
      assert.equal(state.selectedPath, 'b.js')
      press(key)
      assert.deepEqual(state.viewedPaths, ['a.js', 'b.js'])
      assert.equal(state.selectedPath, 'b.js')
      press(key)
      assert.deepEqual(state.viewedPaths, ['a.js'])
      assert.equal(state.selectedPath, 'b.js')

      overlay = {}
      const before = state
      press(key)
      assert.equal(state, before)
      overlay = null
      dispatchWorkspace({ type: 'file_selected', path: 'unchanged.js' })
      press(key)
      assert.deepEqual(state.viewedPaths, ['a.js'])
      assert.equal(state.selectedPath, 'unchanged.js')
      assert.deepEqual(resolveCommand('file.viewed.toggle'), { kind: 'action', action })
    })
  }
}
