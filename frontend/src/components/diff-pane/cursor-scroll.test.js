import assert from 'node:assert/strict'
import test from 'node:test'
import { createCursorScroll } from './cursor-scroll.js'

function fixture() {
  const frames = new Map()
  let id = 0
  const events = []
  const listeners = new Map()
  const viewport = {
    nodeType: 1, scrollTop: 1000, clientHeight: 500,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo({ top }) { events.push(['scroll', top]); this.scrollTop = top },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  }
  let rowTop = 1500
  let cardMeasured = false
  const node = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: -viewport.scrollTop }),
  }
  const instance = {
    getEditorViewport: () => viewport,
    reconcileHeights() { events.push(['measure']); cardMeasured = true },
    getLinePosition() {
      events.push(['position'])
      return { top: rowTop + (cardMeasured ? 300 : 0), height: 20 }
    },
  }
  const scroll = createCursorScroll({
    requestFrame(callback) { frames.set(++id, callback); return id },
    cancelFrame: (frame) => frames.delete(frame),
  })
  return {
    scroll, instance, node, viewport, events, listeners, frames,
    setRowTop(value) { rowTop = value },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()) },
  }
}
const cursor = { lineNumber: 801, side: 'additions' }

test('cursor scroll waits for commit and measures cards before its first adjustment', () => {
  const f = fixture()
  f.scroll.request(f.instance, f.node, cursor)
  assert.deepEqual(f.events, [])
  f.frame()
  assert.deepEqual(f.events, [['measure'], ['position'], ['scroll', 1320]])
  f.frame()
  f.frame()
  assert.equal(f.events.filter(([event]) => event === 'scroll').length, 1)
  assert.equal(f.frames.size, 0)
  assert.equal(f.listeners.size, 0)
})

test('virtual render correction keeps the row visible after a new height delta', () => {
  const f = fixture()
  f.scroll.request(f.instance, f.node, cursor)
  f.frame()
  f.setRowTop(1800)
  f.scroll.rendered(f.instance)
  assert.equal(f.frames.size, 1)
  f.frame()
  assert.equal(f.viewport.scrollTop, 1620)
  f.frame()
  assert.equal(f.frames.size, 0)
})

test('a newer move replaces the pending row and explicit centering cancels it', () => {
  const f = fixture()
  f.scroll.request(f.instance, f.node, cursor)
  f.scroll.request(f.instance, f.node, { ...cursor, lineNumber: 900 })
  assert.equal(f.frames.size, 1)
  f.scroll.cancel()
  f.frame()
  assert.deepEqual(f.events, [])
})

for (const event of ['wheel', 'touchstart', 'pointerdown']) {
  test(`${event} cancels correction so user scrolling wins`, () => {
    const f = fixture()
    f.scroll.request(f.instance, f.node, cursor)
    f.frame()
    f.listeners.get(event)()
    f.setRowTop(3000)
    f.frame()
    assert.equal(f.viewport.scrollTop, 1320)
    assert.equal(f.listeners.size, 0)
  })
}

test('unmount and detached nodes discard pending scrolls', () => {
  const f = fixture()
  f.scroll.request(f.instance, f.node, cursor)
  f.scroll.unmounted({})
  assert.equal(f.frames.size, 1)
  f.scroll.unmounted(f.instance)
  f.frame()
  assert.deepEqual(f.events, [])
  f.scroll.request(f.instance, f.node, cursor)
  f.node.isConnected = false
  f.frame()
  assert.deepEqual(f.events, [])
})
