import assert from 'node:assert/strict'
import test from 'node:test'

import { ApplicationAction } from './application-actions.js'
import {
  RenderableFileKind,
  createDiffViewActionAdapter,
} from './diff-view-actions.js'

function adapter(contentKind) {
  const calls = []
  let expanded = false
  let wrapped = true
  const actions = createDiffViewActionAdapter({
    contentKind,
    prepareLayoutChange: () => calls.push('prepare'),
    toggleExpandUnchanged: () => {
      expanded = !expanded
      calls.push(['expanded', expanded])
    },
    toggleWrapLines: () => {
      wrapped = !wrapped
      calls.push(['wrapped', wrapped])
    },
  })
  return { actions, calls }
}

test('diff display actions toggle expansion and wrapping in both directions', () => {
  const { actions, calls } = adapter(RenderableFileKind.DIFF)

  assert.equal(actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), true)
  assert.equal(actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), true)
  assert.equal(actions[ApplicationAction.DIFF_WRAP_TOGGLE](), true)
  assert.equal(actions[ApplicationAction.DIFF_WRAP_TOGGLE](), true)
  assert.deepEqual(calls, [
    'prepare', ['expanded', true],
    'prepare', ['expanded', false],
    'prepare', ['wrapped', false],
    'prepare', ['wrapped', true],
  ])
})

test('full files support wrapping while unavailable views ignore display actions', () => {
  const fullFile = adapter(RenderableFileKind.FILE)
  assert.equal(fullFile.actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), false)
  assert.equal(fullFile.actions[ApplicationAction.DIFF_WRAP_TOGGLE](), true)
  assert.deepEqual(fullFile.calls, ['prepare', ['wrapped', false]])

  const unavailable = adapter('unavailable')
  assert.equal(unavailable.actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), false)
  assert.equal(unavailable.actions[ApplicationAction.DIFF_WRAP_TOGGLE](), false)
  assert.deepEqual(unavailable.calls, [])
})
