import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitialFilePosition } from './initial-file-position.js'

function setup() {
  const frames = new Map()
  let nextId = 0
  const observers = new Map()
  const position = createInitialFilePosition({
    requestFrame(callback) {
      frames.set(++nextId, callback)
      return nextId
    },
    cancelFrame: (id) => frames.delete(id),
    observeResize(node, callback) {
      observers.set(node, callback)
      return () => observers.delete(node)
    },
  })
  function flush() {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback())
  }
  function file() {
    const container = {
      clientHeight: 640,
      scrollTop: 0,
      scrollLeft: 0,
      scrollTo({ top, left }) {
        this.scrollTop = top
        this.scrollLeft = left
      },
    }
    const node = {
      isConnected: true,
      shadowRoot: { querySelector: () => ({}) },
      closest: () => container,
    }
    return { node, container, instance: {} }
  }
  return { position, frames, observers, flush, file }
}

test('initial positioning runs after render-pass scroll corrections, only once', () => {
  const { position, flush, file, observers } = setup()
  const { node, container, instance } = file()
  position.rendered(node, instance)
  // The virtualizer can correct the viewport after onPostRender returns.
  container.scrollTop = 39432
  container.scrollLeft = 150
  flush()
  assert.equal(container.scrollTop, 0)
  assert.equal(container.scrollLeft, 0)
  assert.equal(observers.size, 0)

  container.scrollTop = 1500
  position.rendered(node, instance) // annotation, wrapping or focus update
  flush()
  assert.equal(container.scrollTop, 1500)
})

test('waits for rendered content and a visible viewport', () => {
  const { position, flush, file, observers } = setup()
  const { node, container, instance } = file()
  node.shadowRoot.querySelector = () => null
  container.scrollTop = 900
  position.rendered(node, instance)
  flush()
  assert.equal(container.scrollTop, 900)
  node.shadowRoot.querySelector = () => ({})
  container.clientHeight = 0
  position.rendered(node, instance)
  flush()
  assert.equal(container.scrollTop, 900)
  container.clientHeight = 640
  observers.get(container)()
  flush()
  assert.equal(container.scrollTop, 0)
})

test('A → B → A ignores stale frames and stale unmount notifications', () => {
  const { position, flush, file, frames } = setup()
  const a = file()
  const b = file()
  const reopenedA = file()
  assert.equal(position.rendered(a.node, a.instance), true)
  const staleA = [...frames.values()][0]
  position.unmounted(a.instance)
  a.node.isConnected = false
  position.rendered(b.node, b.instance)
  const staleB = [...frames.values()][0]
  position.unmounted(b.instance)
  b.node.isConnected = false
  position.rendered(reopenedA.node, reopenedA.instance)
  a.container.scrollTop = 100
  b.container.scrollTop = 200
  reopenedA.container.scrollTop = 300
  staleA()
  staleB()
  assert.equal(position.rendered(a.node, a.instance), false)
  position.unmounted(a.instance)
  flush()
  assert.equal(a.container.scrollTop, 100)
  assert.equal(b.container.scrollTop, 200)
  assert.equal(reopenedA.container.scrollTop, 0)
})

test('unmount cancels pending positioning and resize observation', () => {
  const { position, flush, file, frames, observers } = setup()
  const { node, container, instance } = file()
  position.rendered(node, instance)
  container.scrollTop = 800
  position.unmounted(instance)
  assert.equal(frames.size, 0)
  assert.equal(observers.size, 0)
  flush()
  assert.equal(container.scrollTop, 800)
})

test('empty and short files settle without needing a navigable line', () => {
  const { position, flush, file, frames, observers } = setup()
  const { node, container, instance } = file()
  position.rendered(node, instance)
  flush()
  assert.equal(container.scrollTop, 0)
  assert.equal(frames.size, 0)
  assert.equal(observers.size, 0)
})

test('virtualizer placeholder unmounts do not reset an already positioned file', () => {
  const { position, flush, file } = setup()
  const { node, container, instance } = file()
  position.rendered(node, instance)
  flush()
  container.scrollTop = 1800
  // diffs emits unmount when replacing code with an offscreen placeholder,
  // even though it will reuse this same instance when the file is visible.
  position.unmounted(instance)
  position.rendered(node, instance)
  flush()
  assert.equal(container.scrollTop, 1800)
})

test('search reveals collapsed context before positioning the new-side match', () => {
  const { position, flush, file } = setup()
  const { node, instance, container } = file()
  const target = { path: 'example.txt', lineNumber: 180 }
  const revealed = []
  instance.revealLine = (line) => {
    revealed.push(line)
    return revealed.length === 1
  }
  const navigated = []
  const navigate = (match) => { navigated.push(match); container.scrollTop = 3500 }
  position.rendered(node, instance, target, navigate)
  flush()
  assert.deepEqual(navigated, [])
  position.rendered(node, instance, target, navigate)
  flush()
  assert.deepEqual(revealed, [180, 180])
  assert.deepEqual(navigated, [target])
  assert.equal(container.scrollTop, 3500)
  position.rendered(node, instance, target, navigate)
  flush()
  assert.equal(navigated.length, 1)
})

test('new search requests reposition an already-open file, including the same line', () => {
  const { position, flush, file } = setup()
  const { node, instance } = file()
  position.rendered(node, instance)
  flush()
  const navigated = []
  const navigate = (target) => navigated.push(target.lineNumber)
  for (const lineNumber of [42, 95, 95]) {
    position.rendered(node, instance, { lineNumber }, navigate)
    flush()
  }
  assert.deepEqual(navigated, [42, 95, 95])
})

test('a newer result cancels an earlier pending line target', () => {
  const { position, flush, file, frames } = setup()
  const { node, instance } = file()
  const navigated = []
  const navigate = (target) => navigated.push(target.lineNumber)
  position.rendered(node, instance, { lineNumber: 10 }, navigate)
  const stale = [...frames.values()][0]
  position.rendered(node, instance, { lineNumber: 20 }, navigate)
  stale()
  flush()
  assert.deepEqual(navigated, [20])
})
