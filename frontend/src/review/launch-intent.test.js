import assert from 'node:assert/strict'
import test from 'node:test'
import { createLaunchIntent } from './launch-intent.js'
import { createStartupRequest } from './startup-request.js'
import { createReviewTransport } from './transport.js'

for (const native of [false, true]) {
  test(`${native ? 'native' : 'HTTP'} startup retains launch intent through retry and consumes it only after opening`, async () => {
    let pending = true
    let fail = true
    const requests = []
    const dispatch = async (request, sessionId) => {
      requests.push(request.type)
      if (request.type === 'get_review_session') return { id: 1 }
      assert.equal(sessionId, 1)
      if (fail) throw new Error('Startup unavailable')
      if (request.type === 'acknowledge_launch_intent') pending = false
      return { openReviewSourcePicker: pending }
    }
    const makeDocument = () => {
      const transport = createReviewTransport({
        getNative: () => native ? { postMessage: (request) => dispatch(request, request.sessionId) } : null,
        fetchRequest: async (url, options) => {
          const type = url.endsWith('/session') ? 'get_review_session'
            : url.endsWith('/acknowledge') ? JSON.parse(options.body).type : 'get_launch_intent'
          const result = await dispatch({ type }, Number(options.headers['X-Rvw-Session']))
          return { ok: true, json: async () => result }
        },
      })
      const intent = createLaunchIntent({
        read: () => transport.request('/api/review/launch-intent', { type: 'get_launch_intent' }),
        acknowledge: () => transport.request('/api/review/launch-intent/acknowledge', { type: 'acknowledge_launch_intent' }, {
          method: 'POST', body: JSON.stringify({ type: 'acknowledge_launch_intent' }),
        }),
      })
      return { intent, startup: createStartupRequest({ initialize: transport.initialize, readLaunchIntent: intent.read }) }
    }
    const { intent, startup } = makeDocument()
    await startup.load()
    assert.equal(startup.getSnapshot().status, 'error')
    assert.equal(pending, true)
    fail = false
    await startup.load()
    assert.equal(startup.getSnapshot().openReviewSourcePicker, true)
    // An overview failure after bootstrap must also leave the instruction pending.
    await startup.load()
    assert.equal(startup.getSnapshot().openReviewSourcePicker, true)
    const first = intent.acknowledge()
    assert.equal(intent.acknowledge(), first)
    await first
    await startup.load()
    assert.equal(startup.getSnapshot().openReviewSourcePicker, false)
    const nextDocument = makeDocument()
    await nextDocument.startup.load()
    assert.equal(nextDocument.startup.getSnapshot().openReviewSourcePicker, false)
    assert.equal(requests.filter((type) => type === 'acknowledge_launch_intent').length, 1)
  })
}

test('ordinary launch remains closed and invalid launch responses use the startup error path', async () => {
  for (const response of [{ openReviewSourcePicker: false }, undefined, {}, { openReviewSourcePicker: 'true' }]) {
    const intent = createLaunchIntent({ read: async () => response })
    const startup = createStartupRequest({ initialize: async () => {}, readLaunchIntent: intent.read })
    await startup.load()
    assert.equal(startup.getSnapshot().status, response?.openReviewSourcePicker === false ? 'success' : 'error')
    if (response?.openReviewSourcePicker === false) assert.equal(startup.getSnapshot().openReviewSourcePicker, false)
  }
})

test('a late read cannot reopen the picker after acknowledgement', async () => {
  let resolve
  const intent = createLaunchIntent({
    read: () => new Promise((done) => { resolve = done }), acknowledge: async () => {},
  })
  const reading = intent.read()
  await intent.acknowledge()
  resolve({ openReviewSourcePicker: true })
  assert.equal(await reading, false)
})

test('failed acknowledgement can retry without reopening the picker in the current document', async () => {
  let attempts = 0
  const intent = createLaunchIntent({ acknowledge: async () => {
    if (++attempts === 1) throw new Error('Service unavailable')
  } })
  await assert.rejects(intent.acknowledge(), /Service unavailable/)
  assert.equal(await intent.read(), false)
  await intent.acknowledge()
  assert.equal(attempts, 2)
})
