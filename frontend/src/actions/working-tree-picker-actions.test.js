import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerActionAdapter } from './review-source-picker-actions.js'
import { createReviewSourcePickerModeActionRegistry } from './review-source-picker-mode-actions.js'
import { createWorkingTreePickerActionAdapter, createWorkingTreePickerSubmit } from './working-tree-picker-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { createWorkingTreeChangesRequest } from '../review/working-tree-changes-request.js'
import { attachVimKeyboardCapture } from '../vim/keyboard.js'
import { VimController } from '../vim/machine.js'

function fixture(normal = {}) {
  const pending = []
  const request = createWorkingTreeChangesRequest({ listChanges: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  const choices = []
  const submit = createWorkingTreePickerSubmit({ getSnapshot: request.getSnapshot, onSelect: (source) => choices.push(source) })
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  const modes = createReviewSourcePickerModeActionRegistry((actions) => overlay.update(
    createReviewSourcePickerActionAdapter({ mode: 'working-tree', modeActions: actions, onChange: () => modes.clear() }),
  ))
  const treeActions = { [ApplicationAction.CURSOR_DOWN]: () => true }
  const actions = createWorkingTreePickerActionAdapter(submit, treeActions)
  modes.register(actions)
  const dispatch = createApplicationDispatcher({
    getOverlayActions: overlays.get,
    getActiveSurface: () => assert.fail('Reached workspace'),
    getSurfaceActions: () => assert.fail('Reached workspace'),
    globalActions: { [ApplicationAction.RELOAD_REVIEW]: () => assert.fail('Reloaded the active review') },
  })
  const configuration = resolveConfiguration({ configuration: { keybindings: { normal } } })
  assert.equal(configuration.diagnostic, null)
  const controller = new VimController({ bindings: configuration.bindings })
  controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
  const press = (keys) => keys.forEach((key) => controller.dispatch({ type: 'key', key }))
  return { request, pending, choices, submit, dispatch, modes, actions, controller, press }
}

test('pointer and overlay submission require a successful current load, including empty results', async () => {
  const { request, pending, choices, submit, dispatch, actions } = fixture()
  assert.equal(actions[ApplicationAction.OVERLAY_SUBMIT], submit)
  assert.equal(submit(), false)
  const first = request.load()
  assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  pending[0].reject(new Error('Repository unavailable'))
  await first
  assert.equal(submit(), false)
  assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  const retry = request.load()
  assert.equal(submit(), false)
  pending[1].resolve({ files: [] })
  await retry
  assert.equal(submit(), true)
  assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), true)
  assert.deepEqual(choices, [
    { kind: 'working-tree', base: 'HEAD' },
    { kind: 'working-tree', base: 'HEAD' },
  ])
  // A new request blocks an existing handler before React renders again.
  const refresh = request.load()
  assert.equal(submit(), false)
  pending[2].resolve({ files: [{ path: 'new.txt' }] })
  await refresh
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), true)
  assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), true)
  assert.deepEqual(choices[2], { kind: 'working-tree', base: 'HEAD' })
})

test('default, custom, and leader bindings submit only the active working-tree mode', async () => {
  for (const [normal, keys] of [
    [{}, ['<S-Enter>']],
    [{ [ApplicationAction.OVERLAY_SUBMIT]: [['<C-Enter>']] }, ['<C-Enter>']],
    [{ [ApplicationAction.OVERLAY_SUBMIT]: [['<leader>', 'x']] }, ['<Space>', 'x']],
  ]) {
    const { request, pending, choices, press, modes, dispatch } = fixture(normal)
    press(keys)
    assert.deepEqual(choices, [])
    const loading = request.load()
    pending[0].resolve({ files: [{ path: 'a.txt' }] })
    await loading
    press(keys)
    assert.deepEqual(choices, [{ kind: 'working-tree', base: 'HEAD' }])
    assert.equal(dispatch(ApplicationAction.RELOAD_REVIEW), false)
    assert.equal(dispatch(ApplicationAction.ADD_COMMENT), false)
    modes.clear()
    press(keys)
    assert.equal(choices.length, 1)
  }
})

test('Shift+Enter uses working-tree submission while focused button Enter remains native', async () => {
  const { request, pending, choices, controller } = fixture()
  const loading = request.load()
  pending[0].resolve({ files: [] })
  await loading
  let listener
  const dispose = attachVimKeyboardCapture({
    target: { addEventListener: (_type, handler) => { listener = handler }, removeEventListener: () => {} },
    dispatch: controller.dispatch,
  })
  const dialog = { tagName: 'DIALOG', hasAttribute: (name) => name === 'data-vim-capture' }
  const button = { tagName: 'BUTTON', parentElement: dialog, hasAttribute: (name) => name === 'data-vim-native-activation' }
  listener({ target: button, key: 'Enter', shiftKey: false,
    preventDefault: () => assert.fail('Prevented native Enter'), stopPropagation: () => assert.fail('Stopped native Enter') })
  assert.equal(choices.length, 0)
  let prevented = false
  listener({ target: button, key: 'Enter', shiftKey: true,
    preventDefault: () => { prevented = true }, stopPropagation: () => {} })
  assert.equal(prevented, true)
  assert.deepEqual(choices, [{ kind: 'working-tree', base: 'HEAD' }])
  dispose()
})
