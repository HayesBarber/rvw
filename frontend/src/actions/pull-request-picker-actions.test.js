import assert from 'node:assert/strict'
import test from 'node:test'
import { centerPullRequestTile, createPullRequestPickerActionAdapter, createPullRequestSubmitHandler, focusPullRequestTile } from './pull-request-picker-actions.js'
import { createPullRequestsRequest } from '../review/pull-requests-request.js'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerModeActionRegistry } from './review-source-picker-mode-actions.js'
import { createReviewSourcePickerActionAdapter } from './review-source-picker-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'

function fixture(normal = {}) {
  let state = { status: 'success', data: [{ number: 42 }, { number: 7 }, { number: 18 }] }
  let focused = 42
  const selected = []
  const centered = []
  const getRequest = () => state
  const submit = createPullRequestSubmitHandler({ getRequest, onSelect: (number) => selected.push(number) })
  const actions = createPullRequestPickerActionAdapter({
    getRequest, getFocusedNumber: () => focused,
    focus: (number) => { focused = number; return true }, submit,
    center: (number) => { centered.push(number); return true },
  })
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  const modes = createReviewSourcePickerModeActionRegistry((modeActions) => overlay.update(
    createReviewSourcePickerActionAdapter({ mode: 'pull-requests', modeActions, onChange: () => modes.clear() }),
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
    actions, dispatch, modes, selected, centered,
    getFocus: () => focused,
    setFocus: (number) => { focused = number },
    setState: (next) => { state = next },
    press: (keys) => { for (const key of keys) controller.dispatch({ type: 'key', key }) },
  }
}

test('cursor bindings move focus, preserve counts and API order, and never submit', () => {
  const { press, getFocus, selected } = fixture()
  for (const [keys, expected] of [
    [['j'], 7], [['j'], 18], [['j'], 42], [['k'], 18],
    [['2', 'j'], 7], [['g', 'g'], 42], [['G'], 18], [['<Up>'], 7], [['<Down>'], 18],
  ]) {
    press(keys)
    assert.equal(getFocus(), expected)
    assert.deepEqual(selected, [])
  }
})

test('Enter and Shift+Enter use the focused PR and the same guarded submit handler', () => {
  const { press, selected, actions } = fixture()
  assert.equal(actions[ApplicationAction.ITEM_ACTIVATE], actions[ApplicationAction.OVERLAY_SUBMIT])
  press(['j', '<Enter>', '<S-Enter>'])
  assert.deepEqual(selected, [7, 7])
})

test('default and custom center bindings center the focused PR without moving focus or submitting', () => {
  for (const [normal, keys] of [
    [{}, ['z', 'z']],
    [{ [ApplicationAction.CURSOR_CENTER]: [['<leader>', 'z']] }, ['<Space>', 'z']],
  ]) {
    const { press, getFocus, selected, centered } = fixture(normal)
    press(['j', ...keys])
    assert.equal(getFocus(), 7)
    assert.deepEqual(centered, [7])
    assert.deepEqual(selected, [])
  }
})

test('custom cursor, activation, and submission bindings reach the PR mode', () => {
  const { press, getFocus, selected } = fixture({
    [ApplicationAction.CURSOR_DOWN]: [['<leader>', 'j']],
    [ApplicationAction.ITEM_ACTIVATE]: [['<leader>', 'a']],
    [ApplicationAction.OVERLAY_SUBMIT]: [['<C-Enter>']],
  })
  press(['<Space>', 'j'])
  assert.equal(getFocus(), 7)
  assert.deepEqual(selected, [])
  press(['<Space>', 'a', '<C-Enter>'])
  assert.deepEqual(selected, [7, 7])
})

test('PR actions reject unavailable data and missing focus without reaching workspace actions', () => {
  const { dispatch, setState, setFocus, selected, centered } = fixture()
  for (const state of [
    { status: 'idle', data: [{ number: 42 }] },
    { status: 'loading', data: [{ number: 42 }] },
    { status: 'error', data: [{ number: 42 }] },
    { status: 'success', data: [] },
  ]) {
    setState(state)
    for (const action of Object.values(ApplicationAction)) {
      if (action === ApplicationAction.ITEM_NEXT || action === ApplicationAction.ITEM_PREVIOUS) continue
      assert.equal(dispatch(action), false)
    }
  }
  setState({ status: 'success', data: [{ number: 42 }] })
  for (const number of [null, 7]) {
    setFocus(number)
    assert.equal(dispatch(ApplicationAction.ITEM_ACTIVATE), false)
    assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
    assert.equal(dispatch(ApplicationAction.CURSOR_CENTER), false)
  }
  assert.equal(dispatch(ApplicationAction.RELOAD_REVIEW), false)
  assert.equal(dispatch(ApplicationAction.ADD_COMMENT), false)
  assert.deepEqual(selected, [])
  assert.deepEqual(centered, [])
})

test('leaving the PR mode removes its submission handlers', () => {
  const { modes, dispatch, selected } = fixture()
  modes.clear()
  assert.equal(dispatch(ApplicationAction.ITEM_ACTIVATE), false)
  assert.equal(dispatch(ApplicationAction.OVERLAY_SUBMIT), false)
  assert.deepEqual(selected, [])
})

test('tile focus prevents automatic page scrolling and reveals the focused tile', () => {
  const calls = []
  const tile = {
    focus: (options) => calls.push(['focus', options]),
    scrollIntoView: (options) => calls.push(['scroll', options]),
  }
  const list = { querySelector: (selector) => {
    assert.equal(selector, '[data-pull-request-number="42"]')
    return tile
  } }
  assert.equal(focusPullRequestTile(list, 42), true)
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { block: 'nearest' }]])
  assert.equal(focusPullRequestTile(null, 42), false)
  assert.equal(focusPullRequestTile({ querySelector: () => null }, 42), false)
})

test('centering scrolls to the tile center without moving DOM focus', () => {
  const calls = []
  const list = { querySelector: (selector) => {
    assert.equal(selector, '[data-pull-request-number="42"]')
    return {
      focus: () => assert.fail('Centering moved focus'),
      scrollIntoView: (options) => calls.push(options),
    }
  } }
  assert.equal(centerPullRequestTile(list, 42), true)
  assert.deepEqual(calls, [{ block: 'center' }])
  assert.equal(centerPullRequestTile(null, 42), false)
  assert.equal(centerPullRequestTile({ querySelector: () => null }, 42), false)
})

test('submission reports only the PR number', () => {
  const calls = []
  const submit = createPullRequestSubmitHandler({
    getRequest: () => ({ status: 'success', data: [{ number: 42 }, { number: 7 }] }),
    onSelect: (...args) => calls.push(args),
  })
  assert.equal(submit(7), true)
  assert.equal(submit(42), true)
  assert.deepEqual(calls, [[7], [42]])
})

test('submission requires loaded data, an available PR, and a callback', () => {
  for (const state of [
    { status: 'idle', data: [{ number: 42 }] },
    { status: 'loading', data: [{ number: 42 }] },
    { status: 'error', data: [{ number: 42 }], error: 'Failed' },
    { status: 'success', data: [] },
    { status: 'success', data: [{ number: 7 }] },
  ]) {
    const submit = createPullRequestSubmitHandler({
      getRequest: () => state,
      onSelect: () => assert.fail('Submitted an unavailable PR'),
    })
    assert.equal(submit(42), false)
  }
  const submit = createPullRequestSubmitHandler({
    getRequest: () => ({ status: 'success', data: [{ number: 42 }] }),
  })
  assert.equal(submit(42), false)
})

test('an old tile handler checks current data during retry and after replacement', async () => {
  let calls = 0
  let complete
  const request = createPullRequestsRequest({ list: () => {
    if (++calls === 1) return Promise.resolve({ pullRequests: [{ number: 42 }] })
    return new Promise((resolve) => { complete = resolve })
  } })
  const selected = []
  const submit = createPullRequestSubmitHandler({
    getRequest: request.getSnapshot, onSelect: (number) => selected.push(number),
  })
  await request.load()
  const oldTileClick = () => submit(42)
  assert.equal(oldTileClick(), true)
  const retry = request.load()
  assert.equal(oldTileClick(), false)
  complete({ pullRequests: [{ number: 7 }] })
  await retry
  assert.equal(oldTileClick(), false)
  assert.equal(submit(7), true)
  assert.deepEqual(selected, [42, 7])
})
