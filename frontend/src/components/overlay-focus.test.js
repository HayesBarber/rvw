import assert from 'node:assert/strict'
import test from 'node:test'
import { trapOverlayFocus } from './overlay-focus.js'

test('Tab stays in the overlay and enters its controls from the results list', () => {
  const focused = []
  const input = { focus: () => focused.push('input') }
  const middle = { focus: () => focused.push('middle') }
  const button = { focus: () => focused.push('button') }
  const list = {}
  const dialog = {
    ownerDocument: { activeElement: null },
    querySelectorAll: () => [input, middle, button],
  }
  for (const [activeElement, shiftKey, expected] of [
    [input, true, 'button'],
    [button, false, 'input'],
    [dialog, false, 'input'],
    [dialog, true, 'button'],
    [list, false, 'input'],
    [list, true, 'button'],
  ]) {
    dialog.ownerDocument.activeElement = activeElement
    let prevented = false
    trapOverlayFocus({
      key: 'Tab', shiftKey, preventDefault: () => { prevented = true },
    }, dialog, list)
    assert.equal(prevented, true)
    assert.equal(focused.at(-1), expected)
  }
})

test('Tab between controls stays native and other keys do not move focus', () => {
  const input = { focus: () => assert.fail('Focus must not move') }
  const button = { focus: () => assert.fail('Focus must not move') }
  const dialog = {
    ownerDocument: { activeElement: input },
    querySelectorAll: () => [input, button],
  }
  const preventDefault = () => assert.fail('Key must remain native')
  trapOverlayFocus({ key: 'Tab', shiftKey: false, preventDefault }, dialog)
  dialog.ownerDocument.activeElement = button
  trapOverlayFocus({ key: 'Tab', shiftKey: true, preventDefault }, dialog)
  trapOverlayFocus({ key: 'j', preventDefault }, dialog)
  dialog.querySelectorAll = () => []
  trapOverlayFocus({ key: 'Tab', preventDefault }, dialog)
})

test('an empty comments panel keeps both Tab directions on its Close button', () => {
  let focused = 0
  const close = { focus: () => { focused += 1 } }
  const list = {}
  const dialog = {
    ownerDocument: { activeElement: list },
    querySelectorAll: () => [close],
  }
  for (const activeElement of [list, close]) {
    dialog.ownerDocument.activeElement = activeElement
    for (const shiftKey of [false, true]) {
      let prevented = false
      trapOverlayFocus({
        key: 'Tab', shiftKey, preventDefault: () => { prevented = true },
      }, dialog, list)
      assert.equal(prevented, true)
    }
  }
  assert.equal(focused, 4)
})
