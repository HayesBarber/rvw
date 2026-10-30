import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { createReviewSourcePickerActionRouter } from './review-source-picker-routing.js'

function fixture() {
  const router = createReviewSourcePickerActionRouter()
  const overlays = createOverlayActionRegistry()
  const overlay = overlays.register(OverlayKind.REVIEW_SOURCE_PICKER)
  overlay.update(router.actions)
  const dispatch = createApplicationDispatcher({
    getOverlayActions: overlays.get,
    getActiveSurface: () => assert.fail('Reached workspace'),
    getSurfaceActions: () => assert.fail('Reached workspace'),
  })
  return { router, dispatch }
}

test('cursor actions reach only the active picker mode and preserve counts', () => {
  const { router, dispatch } = fixture()
  const calls = []
  for (const mode of ['commits', 'pull-requests', 'working-tree']) {
    const unregister = router.register({
      [ApplicationAction.CURSOR_DOWN]: (count) => { calls.push([mode, count]); return true },
    })
    assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 3), true)
    unregister()
  }
  assert.deepEqual(calls, [['commits', 3], ['pull-requests', 3], ['working-tree', 3]])
})

test('a mode change blocks actions until the new mode registers', () => {
  const { router, dispatch } = fixture()
  const cleanupOld = router.register({
    [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Called the old mode'),
  })
  router.clear()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  const cleanupNew = router.register({ [ApplicationAction.CURSOR_DOWN]: () => true })
  cleanupOld()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), true)
  cleanupNew()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
})

test('unhandled actions remain blocked before, during, and after mode registration', () => {
  const { router, dispatch } = fixture()
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
  const unregister = router.register({ [ApplicationAction.CURSOR_DOWN]: () => false })
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
  unregister()
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
})

test('repeated registration and cleanup preserve the newest handlers', () => {
  const { router, dispatch } = fixture()
  const first = router.register({ [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Stale handler') })
  first()
  const second = router.register({ [ApplicationAction.CURSOR_DOWN]: () => true })
  first()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), true)
  second()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
})
