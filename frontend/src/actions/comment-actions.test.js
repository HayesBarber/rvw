import assert from 'node:assert/strict'
import test from 'node:test'

import { ApplicationAction } from './application-actions.js'
import {
  commentAtCursor,
  commentTargetAtCursor,
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

test('line comment targets preserve the current path, side, and cursor line', () => {
  const rows = [{ additions: 8, deletions: 7 }]

  assert.deepEqual(commentTargetAtCursor('src/main.zig', {
    side: 'additions',
    lineNumber: 8,
  }, rows), {
    kind: 'line',
    path: 'src/main.zig',
    side: 'new',
    startLine: 8,
    endLine: 8,
  })
  assert.deepEqual(commentTargetAtCursor('src/main.zig', {
    side: 'deletions',
    lineNumber: 7,
  }, rows), {
    kind: 'line',
    path: 'src/main.zig',
    side: 'old',
    startLine: 7,
    endLine: 7,
  })
})

test('line comment targets reject unavailable and stale cursor contexts', () => {
  const cursor = { side: 'additions', lineNumber: 4 }

  assert.equal(commentTargetAtCursor(null, cursor, [{ additions: 4 }]), null)
  assert.equal(commentTargetAtCursor('src/main.zig', null, [{ additions: 4 }]), null)
  assert.equal(commentTargetAtCursor('src/main.zig', cursor, []), null)
  assert.equal(commentTargetAtCursor('src/main.zig', cursor, [{ additions: 5 }]), null)
  assert.equal(commentTargetAtCursor('src/main.zig', {
    side: 'unknown',
    lineNumber: 4,
  }, [{ additions: 4 }]), null)
})

test('semantic actions operate only when a comment context is active', () => {
  let current = comments[0]
  let addTarget = {
    kind: 'line',
    path: 'src/main.zig',
    side: 'new',
    startLine: 5,
    endLine: 5,
  }
  const calls = []
  const adapter = createCommentActionAdapter({
    getAddTarget: () => addTarget,
    beginAdd: (target) => calls.push(['add', target]),
    getComment: () => current,
    beginEdit: (comment) => calls.push(['edit', comment.id]),
    beginDelete: (comment) => calls.push(['delete', comment.id]),
  })

  assert.equal(adapter[ApplicationAction.ADD_COMMENT](), true)
  assert.equal(adapter[ApplicationAction.EDIT_COMMENT](), true)
  assert.equal(adapter[ApplicationAction.DELETE_COMMENT](), true)
  addTarget = null
  current = null
  assert.equal(adapter[ApplicationAction.ADD_COMMENT](), false)
  assert.equal(adapter[ApplicationAction.EDIT_COMMENT](), false)
  assert.deepEqual(calls, [
    ['add', {
      kind: 'line',
      path: 'src/main.zig',
      side: 'new',
      startLine: 5,
      endLine: 5,
    }],
    ['edit', 'comment-1'],
    ['delete', 'comment-1'],
  ])
})
