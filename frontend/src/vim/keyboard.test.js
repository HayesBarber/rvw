import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachVimKeyboardCapture,
  shouldCaptureKeyboardEvent,
} from './keyboard.js'

function element(tagName, {
  attributes = {},
  isContentEditable = false,
  parentElement = null,
} = {}) {
  return {
    tagName,
    isContentEditable,
    parentElement,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
  }
}

function keyboardEvent(target) {
  return {
    target,
    defaultPrevented: false,
    isComposing: false,
  }
}

test('native editing controls, dialogs, and ignored subtrees opt out', () => {
  const dialog = element('SECTION', { attributes: { role: 'dialog' } })
  const ignored = element('DIV', { attributes: { 'data-vim-ignore': '' } })

  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('INPUT'))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('TEXTAREA'))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('SELECT'))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('DIALOG'))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('DIV', {
    isContentEditable: true,
  }))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('BUTTON', {
    parentElement: dialog,
  }))), false)
  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(element('SPAN', {
    parentElement: ignored,
  }))), false)
})

test('data-vim-capture explicitly opts a descendant back in', () => {
  const dialog = element('SECTION', { attributes: { role: 'dialog' } })
  const target = element('INPUT', {
    attributes: { 'data-vim-capture': '' },
    parentElement: dialog,
  })

  assert.equal(shouldCaptureKeyboardEvent(keyboardEvent(target)), true)
})

test('keyboard capture prevents browser behavior only for handled input', () => {
  let listener = null
  let handled = false
  const target = {
    addEventListener: (_type, nextListener) => {
      listener = nextListener
    },
    removeEventListener: (_type, previousListener) => {
      if (listener === previousListener) listener = null
    },
  }
  const dispose = attachVimKeyboardCapture({
    target,
    dispatch: () => ({ handled }),
  })
  const event = {
    key: 'j',
    code: 'KeyJ',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: element('BODY'),
    preventDefaultCalls: 0,
    stopPropagationCalls: 0,
    preventDefault() {
      this.preventDefaultCalls += 1
    },
    stopPropagation() {
      this.stopPropagationCalls += 1
    },
  }

  listener(event)
  assert.equal(event.preventDefaultCalls, 0)
  assert.equal(event.stopPropagationCalls, 0)

  handled = true
  listener(event)
  assert.equal(event.preventDefaultCalls, 1)
  assert.equal(event.stopPropagationCalls, 1)

  dispose()
  assert.equal(listener, null)
})
