import assert from 'node:assert/strict'
import test from 'node:test'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'

test('open state follows every registered overlay kind', () => {
  const registry = createOverlayActionRegistry()
  const states = []
  const unsubscribe = registry.subscribe(() => states.push(registry.isOpen()))
  assert.equal(registry.isOpen(), false)
  for (const kind of Object.values(OverlayKind)) {
    const overlay = registry.register(kind)
    assert.equal(registry.isOpen(), true)
    overlay.update({})
    overlay.unregister()
    assert.equal(registry.isOpen(), false)
    overlay.unregister()
  }
  assert.deepEqual(states, Object.values(OverlayKind).flatMap(() => [true, false]))
  unsubscribe()
  registry.register(OverlayKind.REVIEW_SOURCE_PICKER).unregister()
  assert.equal(states.length, Object.values(OverlayKind).length * 2)
})

test('closing a covered overlay keeps the remaining overlay open', () => {
  const registry = createOverlayActionRegistry()
  const first = registry.register(OverlayKind.FILE_FINDER)
  const second = registry.register(OverlayKind.REVIEW_SOURCE_PICKER)
  first.unregister()
  assert.equal(registry.isOpen(), true)
  assert.notEqual(registry.get(), null)
  second.unregister()
  assert.equal(registry.isOpen(), false)
  assert.equal(registry.get(), null)
})
