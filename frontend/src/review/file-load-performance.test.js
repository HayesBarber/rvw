import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachFileLoad, beginFileLoad, cancelFileLoad, configureFileLoadPerformance,
  fileRendered, markFileSelection,
} from './file-load-performance.js'

test('timing is opt in, private, and cancelled renders never report visibility', () => {
  configureFileLoadPerformance(false)
  assert.equal(beginFileLoad('key', 'secret.js'), null)
  const events = []
  globalThis.window = { webkit: { messageHandlers: { native: {
    postMessage: (event) => { events.push(event); return Promise.resolve({}) },
  } } } }
  try {
    configureFileLoadPerformance(true)
    markFileSelection('secret.js')
    const trace = beginFileLoad('private-key', 'secret.js')
    assert.match(trace.id, /^[a-f0-9-]+$/)
    const file = attachFileLoad({}, trace)
    cancelFileLoad(trace)
    fileRendered(file, {}, 'mount')
    assert.deepEqual(events.map((event) => event.context.stage), ['cancelled'])
    assert(!JSON.stringify(events).includes('secret'))
    assert(!JSON.stringify(events).includes('private-key'))
  } finally {
    configureFileLoadPerformance(false)
    delete globalThis.window
  }
})
