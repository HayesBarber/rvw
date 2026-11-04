import assert from 'node:assert/strict'
import test from 'node:test'
import { createReviewTransport } from './transport.js'

for (const native of [false, true]) {
  test(`${native ? 'native' : 'HTTP'} requests retain the document session ID after backend replacement`, async () => {
    const calls = []
    let activeId = 1
    const dispatch = async (request, sessionId) => {
      calls.push({ type: request.type, sessionId })
      if (request.type === 'get_review_session') return { id: activeId }
      if (sessionId !== activeId) throw new Error('This review session has ended')
      if (request.type === 'reload_review') return { sessionId: ++activeId }
      return []
    }
    const makeDocument = () => createReviewTransport({
      getNative: () => native ? { postMessage: (request) => dispatch(request, request.sessionId) } : null,
      fetchRequest: async (url, options) => {
        const request = url.endsWith('/session') ? { type: 'get_review_session' }
          : url.endsWith('/reload') ? { type: 'reload_review' } : { type: 'get_comments' }
        const value = options.headers['X-Rvw-Session']
        const sessionId = value === undefined ? undefined : Number(value)
        const body = await dispatch(request, sessionId)
        return { ok: true, json: async () => body }
      },
    })
    const oldDocument = makeDocument()
    await Promise.all([oldDocument.initialize(), oldDocument.initialize()])
    assert.deepEqual(calls, [{ type: 'get_review_session', sessionId: undefined }])
    await oldDocument.request('/api/review/reload', { type: 'reload_review' })
    await assert.rejects(oldDocument.request('/api/comments', { type: 'get_comments' }), /session has ended/)
    assert.deepEqual(await oldDocument.initialize(), { id: 1 })
    const nextDocument = makeDocument()
    await nextDocument.initialize()
    await nextDocument.request('/api/comments', { type: 'get_comments' })
    assert.deepEqual(calls.at(-1), { type: 'get_comments', sessionId: 2 })
    assert.equal(calls.filter((call) => call.type === 'reload_review').length, 1)
    assert.equal(calls.filter((call) => call.type === 'get_review_session').length, 2)
  })
}

test('failed bootstrap can retry and invalid session IDs never bind the document', async () => {
  let calls = 0
  const transport = createReviewTransport({ getNative: () => ({ postMessage: async () => {
    if (++calls === 1) throw new Error('Service unavailable')
    if (calls === 2) return { id: 0 }
    return { id: 3 }
  } }) })
  await assert.rejects(transport.initialize(), /Service unavailable/)
  await assert.rejects(transport.initialize(), /invalid review session/)
  assert.deepEqual(await transport.initialize(), { id: 3 })
  assert.deepEqual(await transport.initialize(), { id: 3 })
  assert.equal(calls, 3)
})
