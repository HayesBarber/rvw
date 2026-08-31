import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommentKeyboardAction,
  commentKeyboardAction,
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
