import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction, applicationActionCatalog } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { openReviewSourcePicker } from './review-source-picker-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { ActiveSurface, initialWorkspaceState, workspaceReducer } from '../app/workspace.js'
import { VimController } from '../vim/machine.js'

const picker = ApplicationAction.OPEN_REVIEW_SOURCE_PICKER

test('default and configured bindings open the picker from either workspace surface', () => {
  assert.equal(picker, 'review_source_picker.open')
  assert.equal(Object.hasOwn(applicationActionCatalog[picker], 'scope'), false)
  for (const [configuration, keys] of [
    [{}, ['<Space>', 'i']],
    [{ keybindings: { leader: ',', normal: { [picker]: [['<leader>', 'g']] } } }, [',', 'g']],
  ]) {
    const result = resolveConfiguration({ configuration })
    assert.equal(result.diagnostic, null)
    for (const activeSurface of Object.values(ActiveSurface)) {
      const state = { ...initialWorkspaceState, selectedPath: 'keep.zig', activeSurface }
      let workspace = state
      const dispatchWorkspace = (action) => { workspace = workspaceReducer(workspace, action) }
      const dispatch = createApplicationDispatcher({
        getActiveSurface: () => workspace.activeSurface,
        getSurfaceActions: () => null,
        globalActions: { [picker]: () => openReviewSourcePicker(dispatchWorkspace, true) },
      })
      const controller = new VimController({ bindings: result.bindings })
      assert.equal(controller.dispatch({ type: 'key', key: keys[0] }).command, null)
      const { command } = controller.dispatch({ type: 'key', key: keys[1] })
      assert.deepEqual(command.args.actions, [picker])
      assert.equal(dispatch(command.args.actions, command.count), true)
      assert.deepEqual(workspace, { ...state, reviewSourcePickerOpen: true })
    }
  }
})

test('the picker binding can be disabled', () => {
  const result = resolveConfiguration({ configuration: {
    keybindings: { normal: { [picker]: [] } },
  } })
  assert.equal(result.diagnostic, null)
  assert(!result.bindings.some(({ args }) => args.actions.includes(picker)))
})

test('the picker does not open without an available review', () => {
  assert.equal(openReviewSourcePicker(() => assert.fail('Changed workspace without a review'), false), false)
})

test('an active overlay blocks the picker action', () => {
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => assert.fail('Reached workspace'),
    getSurfaceActions: () => assert.fail('Reached workspace'),
    getOverlayActions: () => ({}),
    globalActions: { [picker]: () => openReviewSourcePicker(() => assert.fail('Opened picker'), true) },
  })
  assert.equal(dispatch(picker), false)
})
