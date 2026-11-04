import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { ApplicationAction } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createReviewSourcePickerActionAdapter } from './review-source-picker-actions.js'
import { createPullRequestPickerActionAdapter, createPullRequestSubmitHandler } from './pull-request-picker-actions.js'
import { createComparisonSubmitHandler, comparisonEndpoints } from '../review/comparison-selection.js'
import { createReloadReviewRequest } from '../review/reload-request.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'

const commits = [{ sha: 'b'.repeat(40) }, { sha: 'a'.repeat(40) }]
const settle = () => setImmediate()

for (const kind of ['commit-range', 'working-tree', 'pull-request']) {
  for (const custom of [false, true]) {
    test(`${kind} pointer and ${custom ? 'configured' : 'default'} keyboard submission share one guarded replacement and retry`, async () => {
      let pending
      let navigations = 0
      let modeChanges = 0
      const sources = []
      const request = createReloadReviewRequest({
        replace: (source) => {
          sources.push(source)
          return new Promise((resolve, reject) => { pending = { resolve, reject } })
        },
        reloadDocument: () => { navigations++ },
      })
      const selected = kind === 'working-tree' ? comparisonEndpoints(commits).slice(0, 2)
        : comparisonEndpoints(commits).slice(1)
      const before = structuredClone(selected)
      const submit = kind === 'pull-request'
        ? createPullRequestSubmitHandler({
          getRequest: () => ({ status: 'success', data: [{ number: 123 }] }),
          onSelect: (number) => request.reload({ kind: 'pull-request', number }),
          isBlocked: request.isLocked,
        })
        : createComparisonSubmitHandler({
          getRequest: () => ({ status: 'success', data: commits }), getSelection: () => selected,
          onSelect: request.reload, isBlocked: request.isLocked,
        })
      const activate = () => submit(123)
      const actions = createReviewSourcePickerActionAdapter({
        mode: kind === 'pull-request' ? 'pull-requests' : 'commits',
        modeActions: kind === 'pull-request'
          ? createPullRequestPickerActionAdapter({
            getRequest: () => ({ status: 'success', data: [{ number: 123 }] }),
            getFocusedNumber: () => 123, focus: () => assert.fail('Moved focus during reset'), submit,
          })
          : { [ApplicationAction.OVERLAY_SUBMIT]: submit },
        onChange: () => { modeChanges++ }, isBlocked: request.isLocked,
      })
      const dispatch = createApplicationDispatcher({
        getOverlayActions: () => actions,
        getActiveSurface: () => assert.fail('Reached workspace'),
        getSurfaceActions: () => assert.fail('Reached workspace'),
      })
      const configuration = resolveConfiguration({ configuration: custom ? {
        keybindings: { normal: { [ApplicationAction.OVERLAY_SUBMIT]: [['<leader>', 'x']] } },
      } : {} })
      const controller = new VimController({ bindings: configuration.bindings })
      controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
      const pressSubmit = () => {
        for (const key of custom ? ['<Space>', 'x'] : ['<S-Enter>']) controller.dispatch({ type: 'key', key })
      }
      assert.equal(activate(), true)
      pressSubmit()
      assert.equal(activate(), false)
      assert.equal(dispatch(ApplicationAction.ITEM_NEXT), false)
      assert.equal(dispatch(ApplicationAction.ITEM_PREVIOUS), false)
      assert.equal(sources.length, 1)
      assert.equal(modeChanges, 0)
      assert.equal(request.isLocked(), true)
      const expected = kind === 'pull-request' ? { kind, number: 123 }
        : kind === 'working-tree' ? { kind, base: commits[0].sha }
          : { kind, base: commits[1].sha, head: commits[0].sha }
      assert.deepEqual(sources[0], expected)
      pending.reject(new Error('Unable to create selected review'))
      await settle()
      assert.equal(request.isLocked(), false)
      assert.equal(request.getSnapshot().status, 'error')
      assert.deepEqual(selected, before)
      pressSubmit()
      assert.deepEqual(sources, [expected, expected])
      pending.resolve({ sessionId: 2 })
      await settle()
      assert.equal(navigations, 1)
      assert.equal(request.isLocked(), true)
      pressSubmit()
      assert.equal(sources.length, 2)
    })
  }
}
