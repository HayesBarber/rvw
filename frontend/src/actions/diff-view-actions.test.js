import assert from 'node:assert/strict'
import test from 'node:test'

import { ApplicationAction } from './application-actions.js'
import {
  RenderableFileKind,
  createDiffFilePathActionAdapter,
  createDiffViewActionAdapter,
} from './diff-view-actions.js'

function adapter(contentKind) {
  const calls = []
  let expanded = false
  let relative = false
  let wrapped = true
  const actions = createDiffViewActionAdapter({
    contentKind,
    prepareLayoutChange: () => calls.push('prepare'),
    toggleExpandUnchanged: () => {
      expanded = !expanded
      calls.push(['expanded', expanded])
    },
    toggleRelativeLineNumbers: () => {
      relative = !relative
      calls.push(['relative', relative])
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
  assert.equal(actions[ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE](), true)
  assert.equal(actions[ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE](), true)
  assert.deepEqual(calls, [
    'prepare', ['expanded', true],
    'prepare', ['expanded', false],
    'prepare', ['wrapped', false],
    'prepare', ['wrapped', true],
    ['relative', true],
    ['relative', false],
  ])
})

test('diff path actions always copy the open file in the requested format', () => {
  const copies = []
  const actions = createDiffFilePathActionAdapter({
    filePath: 'open/renamed ü.txt',
    copyFilePath: (...args) => (copies.push(args), true),
  })

  assert.equal(actions[ApplicationAction.COPY_FILE_PATH_RELATIVE](), true)
  assert.equal(actions[ApplicationAction.COPY_FILE_PATH_ABSOLUTE](), true)
  assert.deepEqual(copies, [
    ['open/renamed ü.txt', 'relative'],
    ['open/renamed ü.txt', 'absolute'],
  ])
})

test('diff path actions are unavailable without an open file', () => {
  const actions = createDiffFilePathActionAdapter({
    filePath: null,
    copyFilePath: () => assert.fail('copy should not be attempted'),
  })

  assert.equal(actions[ApplicationAction.COPY_FILE_PATH_RELATIVE](), false)
  assert.equal(actions[ApplicationAction.COPY_FILE_PATH_ABSOLUTE](), false)
})

test('full files support wrapping while unavailable views ignore display actions', () => {
  const fullFile = adapter(RenderableFileKind.FILE)
  assert.equal(fullFile.actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), false)
  assert.equal(fullFile.actions[ApplicationAction.DIFF_WRAP_TOGGLE](), true)
  assert.equal(fullFile.actions[ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE](), true)
  assert.deepEqual(fullFile.calls, [
    'prepare', ['wrapped', false], ['relative', true],
  ])

  const unavailable = adapter('unavailable')
  assert.equal(unavailable.actions[ApplicationAction.DIFF_EXPAND_TOGGLE](), false)
  assert.equal(unavailable.actions[ApplicationAction.DIFF_WRAP_TOGGLE](), false)
  assert.equal(unavailable.actions[ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE](), false)
  assert.deepEqual(unavailable.calls, [])
})
