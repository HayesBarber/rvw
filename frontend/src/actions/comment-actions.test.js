import assert from 'node:assert/strict'
import test from 'node:test'

import { ApplicationAction } from './application-actions.js'
import {
  commentAtCursor,
  createCommentActionAdapter,
} from './comment-actions.js'

const comments = [{
  id: 'comment-1',
  body: 'one',
  target: {
    kind: 'line',
    path: 'src/main.zig',
    side: 'new',
    startLine: 4,
    endLine: 5,
  },
}, {
  id: 'comment-2',
  body: 'two',
  target: { kind: 'file', path: 'README.md' },
}]

test('active cursor resolution respects path, side, and target line', () => {
  assert.equal(commentAtCursor(comments, 'src/main.zig', {
    side: 'additions',
    lineNumber: 5,
  }), comments[0])
  assert.equal(commentAtCursor(comments, 'src/main.zig', {
    side: 'deletions',
    lineNumber: 5,
  }), null)
  assert.equal(commentAtCursor(comments, 'README.md', {
    side: 'additions',
    lineNumber: 1,
  }), null)
})

test('semantic actions operate only when a comment context is active', () => {
  let current = comments[0]
  const calls = []
  const adapter = createCommentActionAdapter({
    getComment: () => current,
    beginEdit: (comment) => calls.push(['edit', comment.id]),
    beginDelete: (comment) => calls.push(['delete', comment.id]),
  })

  assert.equal(adapter[ApplicationAction.EDIT_COMMENT](), true)
  assert.equal(adapter[ApplicationAction.DELETE_COMMENT](), true)
  current = null
  assert.equal(adapter[ApplicationAction.EDIT_COMMENT](), false)
  assert.deepEqual(calls, [['edit', 'comment-1'], ['delete', 'comment-1']])
})
