import assert from 'node:assert/strict'
import test from 'node:test'
import { centerComparisonEndpoint, createComparisonPickerActionAdapter, focusComparisonEndpoint } from './comparison-picker-actions.js'
import { comparisonEndpoints, createComparisonSubmitHandler, toggleComparisonEndpoint } from '../review/comparison-selection.js'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerModeActionRegistry } from './review-source-picker-mode-actions.js'
import { createReviewSourcePickerActionAdapter } from './review-source-picker-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { attachVimKeyboardCapture } from '../vim/keyboard.js'
import { VimController } from '../vim/machine.js'

const commits = ['b', 'a', 'c'].map((letter) => ({ sha: letter.repeat(40) }))
const endpoints = comparisonEndpoints(commits)

function fixture(normal = {}) {
  let state = { status: 'success', data: commits }
  let focused = endpoints[0]
  let checked = []
  let mode = 'commits'
  const submissions = []
  const centered = []
  const getRequest = () => state
  const toggle = (endpoint) => {
    checked = toggleComparisonEndpoint(comparisonEndpoints(state.data), checked, endpoint)
    return true
  }
  const submit = createComparisonSubmitHandler({
    getRequest, getSelection: () => checked, onSelect: (source) => submissions.push(source),
  })
  const actions = createComparisonPickerActionAdapter({
    getRequest, getFocusedEndpoint: () => focused,
    focus: (endpoint) => { focused = endpoint; return true },
    center: (endpoint) => { centered.push(endpoint); return true }, toggle, submit,
  })
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  const modes = createReviewSourcePickerModeActionRegistry((modeActions) => overlay.update(
    createReviewSourcePickerActionAdapter({ mode, modeActions, onChange: (next) => { mode = next; modes.clear() } }),
  ))
  modes.register(actions)
  const dispatch = createApplicationDispatcher({
    getOverlayActions: overlays.get,
    getActiveSurface: () => assert.fail('Reached the workspace'),
    getSurfaceActions: () => assert.fail('Reached the workspace'),
  })
  const configuration = resolveConfiguration({ configuration: { keybindings: { normal } } })
  assert.equal(configuration.diagnostic, null)
  const controller = new VimController({ bindings: configuration.bindings })
  controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
  return {
    actions, modes, controller, dispatch, submissions, centered,
    getChecked: () => checked, getFocus: () => focused, getMode: () => mode,
    setFocus: (endpoint) => { focused = endpoint }, setState: (next) => { state = next },
    press: (keys) => { for (const key of keys) controller.dispatch({ type: 'key', key }) },
  }
}

test('cursor actions follow API order and stop at the ends without checking endpoints', () => {
  const f = fixture()
  for (const [keys, index] of [
    [['k'], 0], [['j'], 1], [['j'], 2], [['j'], 3], [['j'], 3],
    [['k'], 2], [['5', 'k'], 0], [['5', 'j'], 3],
    [['g', 'g'], 0], [['G'], 3], [['<Up>'], 2], [['<Down>'], 3],
  ]) {
    f.press(keys)
    assert.deepEqual(f.getFocus(), endpoints[index])
    assert.deepEqual(f.getChecked(), [])
    assert.deepEqual(f.submissions, [])
  }
})

test('activation toggles endpoints and replaces the nearest endpoint without submitting', () => {
  const f = fixture()
  f.press(['<Enter>', '2', 'j', '<Enter>'])
  assert.deepEqual(f.getChecked(), [endpoints[0], endpoints[2]])
  f.press(['k', '<Enter>'])
  assert.deepEqual(f.getChecked(), [endpoints[0], endpoints[1]])
  f.press(['<Enter>'])
  assert.deepEqual(f.getChecked(), [endpoints[0]])
  assert.deepEqual(f.submissions, [])
})

for (const [keys, expected] of [
  [['<Enter>', 'j', '<Enter>'], { kind: 'working-tree', base: commits[0].sha }],
  [['j', '<Enter>', 'j', '<Enter>'], { kind: 'commit-range', base: commits[1].sha, head: commits[0].sha }],
]) {
  test(`Shift+Enter submits one ${expected.kind} callback without toggling focus`, () => {
    const f = fixture()
    f.press(keys)
    const before = f.getChecked()
    f.press(['<S-Enter>'])
    assert.deepEqual(f.submissions, [expected])
    assert.equal(f.getChecked(), before)
    assert.notEqual(f.actions[ApplicationAction.ITEM_ACTIVATE], f.actions[ApplicationAction.OVERLAY_SUBMIT])
  })
}

test('custom cursor, activation, and submission bindings preserve leader sequences', () => {
  const f = fixture({
    [ApplicationAction.CURSOR_DOWN]: [['<leader>', 'j']],
    [ApplicationAction.ITEM_ACTIVATE]: [['<leader>', 'a']],
    [ApplicationAction.OVERLAY_SUBMIT]: [['<leader>', 'x']],
    [ApplicationAction.CURSOR_CENTER]: [['<leader>', 'z']],
  })
  let listener
  const dispose = attachVimKeyboardCapture({
    target: { addEventListener: (_, handler) => { listener = handler }, removeEventListener: () => {} },
    dispatch: f.controller.dispatch,
  })
  // Timeline nodes capture keys, including a Space leader, through the shared boundary.
  const node = { tagName: 'BUTTON', hasAttribute: (name) => name === 'data-vim-capture' }
  for (const key of [' ', 'a', ' ', 'j', ' ', 'a', ' ', 'z', ' ', 'x']) {
    let prevented = false
    listener({ target: node, key, preventDefault: () => { prevented = true }, stopPropagation: () => {} })
    assert.equal(prevented, true)
  }
  assert.deepEqual(f.getFocus(), endpoints[1])
  assert.deepEqual(f.getChecked(), [endpoints[0], endpoints[1]])
  assert.deepEqual(f.centered, [endpoints[1]])
  assert.deepEqual(f.submissions, [{ kind: 'working-tree', base: commits[0].sha }])
  dispose()
})

test('native control Enter stays native and Shift+Enter submits exactly once without toggling a node', () => {
  const f = fixture()
  f.press(['<Enter>', 'j', '<Enter>'])
  const checked = f.getChecked()
  let listener
  const dispose = attachVimKeyboardCapture({
    target: { addEventListener: (_, handler) => { listener = handler }, removeEventListener: () => {} },
    dispatch: f.controller.dispatch,
  })
  const dialog = { tagName: 'DIALOG', hasAttribute: (name) => name === 'data-vim-capture' }
  const button = { tagName: 'BUTTON', hasAttribute: (name) => name === 'data-vim-native-activation', parentElement: dialog }
  listener({ target: button, key: 'Enter', preventDefault: () => assert.fail('Blocked native activation') })
  assert.deepEqual(f.submissions, [])
  for (const target of [button, { tagName: 'SPAN', parentElement: button }, dialog]) {
    let prevented = false
    listener({ target, key: 'Enter', shiftKey: true, preventDefault: () => { prevented = true }, stopPropagation: () => {} })
    assert.equal(prevented, true)
  }
  assert.equal(f.submissions.length, 3)
  assert.equal(f.getChecked(), checked)
  f.setState({ status: 'loading', data: commits })
  let prevented = false
  listener({ target: button, key: 'Enter', shiftKey: true, preventDefault: () => { prevented = true }, stopPropagation: () => {} })
  assert.equal(prevented, true)
  assert.equal(f.submissions.length, 3)
  dispose()
})

test('loading and errors block actions; incomplete and stale pairs cannot submit', () => {
  const f = fixture()
  for (const status of ['idle', 'loading', 'error']) {
    f.setState({ status, data: commits })
    for (const action of Object.values(ApplicationAction)) {
      if ([ApplicationAction.ITEM_NEXT, ApplicationAction.ITEM_PREVIOUS].includes(action)) continue
      assert.equal(f.dispatch(action), false)
    }
  }
  f.setState({ status: 'success', data: commits })
  assert.equal(f.dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  f.press(['<Enter>'])
  assert.equal(f.dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  f.press(['j', '<Enter>'])
  f.setState({ status: 'success', data: [] })
  assert.equal(f.dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  for (const endpoint of [null, { kind: 'commit', sha: 'd'.repeat(40) }]) {
    f.setFocus(endpoint)
    assert.equal(f.dispatch(ApplicationAction.ITEM_ACTIVATE), false)
    assert.equal(f.dispatch(ApplicationAction.CURSOR_CENTER), false)
  }
  assert.deepEqual(f.submissions, [])
})

test('a clean working tree remains navigable with empty history but cannot form a pair', () => {
  const f = fixture()
  f.setState({ status: 'success', data: [] })
  f.press(['G', '<Enter>', 'j', 'z', 'z', '<S-Enter>'])
  assert.deepEqual(f.getFocus(), { kind: 'working-tree' })
  assert.deepEqual(f.getChecked(), [{ kind: 'working-tree' }])
  assert.deepEqual(f.centered, [{ kind: 'working-tree' }])
  assert.deepEqual(f.submissions, [])
})

test('only two modes cycle and leaving the comparison mode clears its handlers', () => {
  for (const normal of [{}, {
    [ApplicationAction.ITEM_NEXT]: [['<leader>', 'j']],
    [ApplicationAction.ITEM_PREVIOUS]: [['<leader>', 'k']],
  }]) {
    const f = fixture(normal)
    const next = Object.keys(normal).length ? ['<Space>', 'j'] : [']', 'b']
    const previous = Object.keys(normal).length ? ['<Space>', 'k'] : ['[', 'b']
    f.press(['<Enter>', 'j', '<Enter>', ...next])
    assert.equal(f.getMode(), 'pull-requests')
    assert.equal(f.dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
    assert.equal(f.dispatch(ApplicationAction.ITEM_ACTIVATE), false)
    f.press(previous)
    assert.equal(f.getMode(), 'commits')
    f.modes.register(f.actions)
    f.press(['<S-Enter>'])
    assert.equal(f.submissions.length, 1)
    assert.equal(f.dispatch(ApplicationAction.ADD_COMMENT), false)
    assert.equal(f.dispatch(ApplicationAction.RELOAD_REVIEW), false)
  }
})

for (const endpoint of [endpoints[0], endpoints[1]]) {
  test(`focus and center reveal the ${endpoint.kind} node without changing selection`, () => {
    const calls = []
    const node = {
      dataset: { endpoint: endpoint.kind === 'working-tree' ? 'working-tree' : endpoint.sha },
      focus: (options) => calls.push(['focus', options]),
      scrollIntoView: (options) => calls.push(['scroll', options]),
    }
    const list = { querySelectorAll: () => [node] }
    assert.equal(focusComparisonEndpoint(list, endpoint), true)
    assert.equal(centerComparisonEndpoint(list, endpoint), true)
    assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { block: 'nearest' }], ['scroll', { block: 'center' }]])
    assert.equal(focusComparisonEndpoint(null, endpoint), false)
    assert.equal(centerComparisonEndpoint(list, null), false)
    assert.equal(focusComparisonEndpoint({ querySelectorAll: () => [] }, endpoint), false)
  })
}
