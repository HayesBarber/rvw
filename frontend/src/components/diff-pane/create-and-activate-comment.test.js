import assert from 'node:assert/strict'
import test from 'node:test'

import { createAndActivateComment } from './create-and-activate-comment.js'

test('a newly created comment becomes the active keyboard context', async () => {
  const target = { kind: 'line', path: 'src/main.zig', side: 'new', startLine: 8, endLine: 8 }
  const calls = []
  const beforeCommit = () => {}
  const comment = { id: 'comment-1', body: 'Check this', target }

  const result = await createAndActivateComment({
    activate: (commentId) => calls.push(['activate', commentId]),
    beforeCommit,
    body: 'Check this',
    create: async (...args) => {
      calls.push(['create', ...args])
      return comment
    },
    target,
  })

  assert.equal(result, comment)
  assert.deepEqual(calls, [
    ['create', 'Check this', target, beforeCommit],
    ['activate', 'comment-1'],
  ])
})

test('a failed create does not change the active keyboard context', async () => {
  const error = new Error('Unable to save')
  let activated = false

  await assert.rejects(createAndActivateComment({
    activate: () => { activated = true },
    beforeCommit: () => {},
    body: 'Check this',
    create: async () => { throw error },
    target: { kind: 'file', path: 'src/main.zig' },
  }), error)
  assert.equal(activated, false)
})
