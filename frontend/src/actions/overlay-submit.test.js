import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerActionAdapter } from './review-source-picker-actions.js'
import { createReviewSourcePickerModeActionRegistry } from './review-source-picker-mode-actions.js'
import { createKeymapReference } from './keymap-reference.js'
import { resolveConfiguration } from '../app/configuration.js'
import { attachVimKeyboardCapture } from '../vim/keyboard.js'
import { VimController } from '../vim/machine.js'

function fixture(normal = {}, globalActions = {}) {
  const configuration = resolveConfiguration({ configuration: { keybindings: { normal } } })
  assert.equal(configuration.diagnostic, null)
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  let mode = 'commits'
  const modes = createReviewSourcePickerModeActionRegistry((modeActions) => overlay.update(
    createReviewSourcePickerActionAdapter({ mode, modeActions, onChange: (next) => { mode = next } }),
  ))
  const dispatch = createApplicationDispatcher({
    getOverlayActions: overlays.get,
    getActiveSurface: () => 'file_tree',
    getSurfaceActions: () => globalActions,
    globalActions,
  })
  const controller = new VimController({ bindings: configuration.bindings })
  controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
  const press = (keys) => {
    for (const key of keys) controller.dispatch({ type: 'key', key })
  }
  return { configuration, dispatch, modes, overlay, controller, press }
}

test('default and custom submit bindings reach only the registered picker mode handler', () => {
  for (const [normal, keys] of [
    [{}, ['<S-Enter>']],
    [{ [ApplicationAction.OVERLAY_SUBMIT]: [['<leader>', 'x']] }, ['<Space>', 'x']],
    [{ [ApplicationAction.OVERLAY_SUBMIT]: [['<C-Enter>']] }, ['<C-Enter>']],
  ]) {
    const { modes, dispatch, press } = fixture(normal, {
      [ApplicationAction.OVERLAY_SUBMIT]: () => assert.fail('Reached workspace submit'),
    })
    assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
    const submitted = []
    for (const mode of ['commits', 'pull-requests', 'working-tree']) {
      const unregister = modes.register({
        [ApplicationAction.OVERLAY_SUBMIT]: () => { submitted.push(mode); return true },
        [ApplicationAction.ITEM_ACTIVATE]: () => assert.fail('Submission activated an item'),
      })
      press(keys)
      assert.equal(submitted.at(-1), mode)
      unregister()
      assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
    }
    assert.deepEqual(submitted, ['commits', 'pull-requests', 'working-tree'])
    modes.register({ [ApplicationAction.OVERLAY_SUBMIT]: () => false })
    assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
    modes.clear()
    assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  }
})

test('a submit binding shared with a workspace action respects the active overlay', () => {
  const calls = []
  const { modes, overlay, press } = fixture({
    [ApplicationAction.OVERLAY_SUBMIT]: [['<Right>']],
  }, {
    [ApplicationAction.TREE_EXPAND]: () => { calls.push('tree'); return true },
  })
  press(['<Right>'])
  assert.deepEqual(calls, [])
  const unregister = modes.register({
    [ApplicationAction.OVERLAY_SUBMIT]: () => { calls.push('submit'); return true },
  })
  press(['<Right>'])
  assert.deepEqual(calls, ['submit'])
  unregister()
  press(['<Right>'])
  assert.deepEqual(calls, ['submit'])
  overlay.unregister()
  press(['<Right>'])
  assert.deepEqual(calls, ['submit', 'tree'])
})

test('Shift+Enter submits from a native overlay button while Enter stays native', () => {
  const { modes, controller } = fixture()
  let submissions = 0
  modes.register({
    [ApplicationAction.OVERLAY_SUBMIT]: () => { submissions += 1; return true },
    [ApplicationAction.ITEM_ACTIVATE]: () => assert.fail('Activated the focused item'),
  })
  let listener
  const dispose = attachVimKeyboardCapture({
    target: { addEventListener: (_type, handler) => { listener = handler }, removeEventListener: () => {} },
    dispatch: controller.dispatch,
  })
  const dialog = { tagName: 'DIALOG', hasAttribute: (name) => name === 'data-vim-capture' }
  const button = { tagName: 'BUTTON', hasAttribute: (name) => name === 'data-vim-native-activation', parentElement: dialog }
  for (const target of [dialog, button, { tagName: 'SPAN', parentElement: button }]) {
    let prevented = false
    listener({
      target, key: 'Enter', shiftKey: true,
      preventDefault: () => { prevented = true }, stopPropagation: () => {},
    })
    assert.equal(prevented, true)
  }
  assert.equal(submissions, 3)
  listener({
    target: button, key: 'Enter', shiftKey: false,
    preventDefault: () => assert.fail('Prevented native Enter'),
    stopPropagation: () => assert.fail('Stopped native Enter'),
  })
  assert.equal(submissions, 3)
  modes.clear()
  let blocked = false
  listener({
    target: button, key: 'Enter', shiftKey: true,
    preventDefault: () => { blocked = true }, stopPropagation: () => {},
  })
  assert.equal(blocked, true)
  assert.equal(submissions, 3)
  dispose()
})

test('submission can be disabled and keyboard help shows effective submission bindings', () => {
  for (const keys of [[['<S-Enter>']], [['<leader>', 'x']], []]) {
    const { configuration } = fixture({ [ApplicationAction.OVERLAY_SUBMIT]: keys })
    const groups = createKeymapReference(configuration.keymap)
    const action = groups.find((group) => group.id === 'application').actions
      .find((action) => action.id === ApplicationAction.OVERLAY_SUBMIT)
    assert.deepEqual(action.sequences, keys.map((sequence) => sequence.map((key) => key === '<leader>' ? '<Space>' : key)))
    assert.equal(configuration.bindings.some(({ args }) => args.actions.includes(ApplicationAction.OVERLAY_SUBMIT)), keys.length > 0)
  }
})
