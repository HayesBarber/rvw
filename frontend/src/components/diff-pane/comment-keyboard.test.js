import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommentKeyboardAction,
  commentKeyboardAction,
  cycleCommentType,
} from './comment-keyboard.js'

function keyboardEvent(overrides = {}) {
  return {
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
  }
}

test('unmodified Enter submits a comment when no save is in flight', () => {
  assert.equal(
    commentKeyboardAction(keyboardEvent(), false),
    CommentKeyboardAction.SUBMIT,
  )
})

test('modified Enter and composition preserve native textarea behavior', () => {
  for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(commentKeyboardAction(keyboardEvent({ [modifier]: true }), false), null)
  }

  assert.equal(commentKeyboardAction(keyboardEvent({ isComposing: true }), false), null)
})

test('saving blocks keyboard submission and cancellation', () => {
  assert.equal(commentKeyboardAction(keyboardEvent(), true), null)
  assert.equal(commentKeyboardAction(keyboardEvent({ key: 'Escape' }), true), null)
})

test('Escape cancels when no save is in flight', () => {
  assert.equal(
    commentKeyboardAction(keyboardEvent({ key: 'Escape' }), false),
    CommentKeyboardAction.CANCEL,
  )
})

test('Tab cycles configured types in both directions with wrapping', () => {
  const types = ['ISSUE', 'QUESTION', 'NITPICK']
  assert.equal(cycleCommentType(null, types, 1), 'ISSUE')
  assert.equal(cycleCommentType('NITPICK', types, 1), null)
  assert.equal(cycleCommentType(null, types, -1), 'NITPICK')
  assert.equal(cycleCommentType('ISSUE', types, -1), null)
  assert.equal(
    commentKeyboardAction(keyboardEvent({ key: 'Tab' }), false, true),
    CommentKeyboardAction.CYCLE_NEXT_TYPE,
  )
  assert.equal(
    commentKeyboardAction(keyboardEvent({ key: 'Tab', shiftKey: true }), false, true),
    CommentKeyboardAction.CYCLE_PREVIOUS_TYPE,
  )
})

test('disabled types retain native Tab behavior', () => {
  assert.equal(commentKeyboardAction(keyboardEvent({ key: 'Tab' }), false, false), null)
})
