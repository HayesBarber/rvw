import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerModeActionRegistry } from './review-source-picker-mode-actions.js'

function fixture() {
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  const registry = createReviewSourcePickerModeActionRegistry(overlay.update)
  const dispatch = createApplicationDispatcher({
    getOverlayActions: overlays.get,
    getActiveSurface: () => assert.fail('Reached workspace'),
    getSurfaceActions: () => assert.fail('Reached workspace'),
  })
  return { registry, dispatch, overlays }
}

test('the overlay receives the mode adapter directly, without catalog-wide handlers', () => {
  const { registry, overlays } = fixture()
  const actions = { [ApplicationAction.CURSOR_DOWN]: () => true }
  registry.register(actions)
  assert.equal(overlays.get(), actions)
  assert.deepEqual(Object.keys(overlays.get()), [ApplicationAction.CURSOR_DOWN])
  registry.clear()
  assert.deepEqual(Object.keys(overlays.get()), [])
})

test('cursor actions reach only the active picker mode and preserve counts', () => {
  const { registry, dispatch } = fixture()
  const calls = []
  for (const mode of ['commits', 'pull-requests', 'working-tree']) {
    const unregister = registry.register({
      [ApplicationAction.CURSOR_DOWN]: (count) => { calls.push([mode, count]); return true },
    })
    assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 3), true)
    unregister()
  }
  assert.deepEqual(calls, [['commits', 3], ['pull-requests', 3], ['working-tree', 3]])
})

test('a mode change blocks actions until the new mode registers', () => {
  const { registry, dispatch } = fixture()
  const cleanupOld = registry.register({
    [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Called the old mode'),
  })
  registry.clear()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  const cleanupNew = registry.register({ [ApplicationAction.CURSOR_DOWN]: () => true })
  cleanupOld()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), true)
  cleanupNew()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
})

test('unhandled actions remain blocked before, during, and after mode registration', () => {
  const { registry, dispatch } = fixture()
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
  const unregister = registry.register({ [ApplicationAction.CURSOR_DOWN]: () => false })
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
  unregister()
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
})

test('repeated registration and cleanup preserve the newest handlers', () => {
  const { registry, dispatch } = fixture()
  const first = registry.register({ [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Stale handler') })
  first()
  const second = registry.register({ [ApplicationAction.CURSOR_DOWN]: () => true })
  first()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), true)
  second()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
})
