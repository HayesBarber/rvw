import assert from 'node:assert/strict'
import test from 'node:test'

import { createAndActivateComment } from './create-and-activate-comment.js'

test('multiple review comments are saved and selected without a file or line target', async () => {
  const saved = []
  let selected = null
  for (const body of ['Summary', 'Design question']) {
    await createAndActivateComment({
      activate: (id) => { selected = id },
      body,
      commentType: 'QUESTION',
      target: { kind: 'review' },
      create: async (body, commentType, target) => {
        const comment = { id: `review-${saved.length}`, body, commentType, target }
        saved.push(comment)
        return comment
      },
    })
  }
  assert.deepEqual(saved, [
    { id: 'review-0', body: 'Summary', commentType: 'QUESTION', target: { kind: 'review' } },
    { id: 'review-1', body: 'Design question', commentType: 'QUESTION', target: { kind: 'review' } },
  ])
  assert.equal(selected, 'review-1')
})

test('a newly created comment becomes the active keyboard context', async () => {
  const target = { kind: 'line', path: 'src/main.zig', side: 'new', startLine: 8, endLine: 8 }
  const calls = []
  const beforeCommit = () => {}
  const comment = { id: 'comment-1', body: 'Check this', target }

  const result = await createAndActivateComment({
    activate: (commentId) => calls.push(['activate', commentId]),
    beforeCommit,
    body: 'Check this',
    commentType: 'ISSUE',
    create: async (...args) => {
      calls.push(['create', ...args])
      return comment
    },
    target,
  })

  assert.equal(result, comment)
  assert.deepEqual(calls, [
    ['create', 'Check this', 'ISSUE', target, beforeCommit],
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
