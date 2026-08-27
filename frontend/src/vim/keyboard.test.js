import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachVimKeyboardCapture,
  keyboardEventToKey,
  shouldCaptureKeyboardEvent,
} from './keyboard.js'

function keyboardEvent(key, overrides = {}) {
  return {
    key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: null,
    ...overrides,
  }
}

test('normalizes printable, named, and modified keys', () => {
  assert.equal(keyboardEventToKey(keyboardEvent('j')), 'j')
  assert.equal(keyboardEventToKey(keyboardEvent('J', { shiftKey: true })), 'J')
  assert.equal(keyboardEventToKey(keyboardEvent(' ')), '<Space>')
  assert.equal(keyboardEventToKey(keyboardEvent('Escape')), '<Esc>')
  assert.equal(
    keyboardEventToKey(keyboardEvent('r', { ctrlKey: true })),
    '<C-r>',
  )
})

test('ignores editable targets unless they explicitly opt in', () => {
  const input = {
    tagName: 'INPUT',
    hasAttribute: () => false,
    parentElement: null,
  }
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent('j', { target: input })), false)

  const capturedInput = {
    ...input,
    hasAttribute: (name) => name === 'data-vim-capture',
  }
  assert.equal(
    shouldCaptureKeyboardEvent(keyboardEvent('j', { target: capturedInput })),
    true,
  )
})

test('capture prevents and stops only handled keyboard events', () => {
  let listener
  const target = {
    addEventListener: (_type, nextListener) => { listener = nextListener },
    removeEventListener: () => { listener = null },
  }
  const received = []
  const dispose = attachVimKeyboardCapture({
    target,
    dispatch: (input) => {
      received.push(input)
      return { handled: input.key === 'j' }
    },
  })
  const handled = keyboardEvent('j', {
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
  })
  const unhandled = keyboardEvent('x', {
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
  })

  listener(handled)
  listener(unhandled)

  assert.deepEqual(received, [
    { type: 'key', key: 'j' },
    { type: 'key', key: 'x' },
  ])
  assert.equal(handled.prevented, true)
  assert.equal(handled.stopped, true)
  assert.equal(unhandled.prevented, undefined)
  assert.equal(unhandled.stopped, undefined)

  dispose()
  assert.equal(listener, null)
})
