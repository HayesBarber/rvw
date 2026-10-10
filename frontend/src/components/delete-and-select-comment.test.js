import assert from 'node:assert/strict'
import test from 'node:test'
import { commentSelectionAfterDeletion, deleteAndSelectComment } from './delete-and-select-comment.js'

const comments = [
  { id: 'review', target: { kind: 'review' } },
  { id: 'file', target: { kind: 'file', path: 'a.txt' } },
  { id: 'line', target: { kind: 'line', path: 'a.txt', side: 'new', startLine: 2, endLine: 2 } },
]

test('deleting first, middle, last, and only comments leaves a valid selection', () => {
  for (const [deleted, next] of [['review', 'file'], ['file', 'line'], ['line', 'file']]) {
    assert.equal(commentSelectionAfterDeletion(comments, deleted, deleted), next)
  }
  assert.equal(commentSelectionAfterDeletion([comments[0]], 'review', 'review'), null)
  assert.equal(commentSelectionAfterDeletion([], 'missing', null), null)
  assert.equal(commentSelectionAfterDeletion(comments, 'missing', 'missing'), 'review')
  assert.equal(comments.length, 3)
})

test('deleting another comment keeps the selected comment', () => {
  assert.equal(commentSelectionAfterDeletion(comments, 'review', 'line'), 'line')
  assert.equal(commentSelectionAfterDeletion(comments, 'line', 'review'), 'review')
})

test('selection and edit drafts change only after successful deletion, including a retry', async () => {
  let current = [...comments]
  let selectedId = 'file'
  const drafts = new Map([['file', 'Unfinished edit'], ['review', 'Review draft']])
  let rejectDelete
  const failedDelete = new Promise((_, reject) => { rejectDelete = reject })
  const options = {
    commentId: 'file',
    getComments: () => current,
    getSelectedId: () => selectedId,
    discardDraft: (id) => drafts.delete(id),
    selectComment: (id) => { selectedId = id },
  }
  const failed = deleteAndSelectComment({ ...options, remove: () => failedDelete })
  assert.equal(selectedId, 'file')
  assert.equal(drafts.get('file'), 'Unfinished edit')
  rejectDelete(new Error('Delete failed'))
  await assert.rejects(failed, /Delete failed/)
  assert.equal(selectedId, 'file')
  assert.equal(drafts.get('file'), 'Unfinished edit')

  await deleteAndSelectComment({ ...options, remove: async (id) => {
    assert.equal(id, 'file')
    current = current.filter((comment) => comment.id !== id)
  } })
  assert.equal(selectedId, 'line')
  assert.equal(drafts.has('file'), false)
  assert.equal(drafts.get('review'), 'Review draft')
  assert.deepEqual(current, [comments[0], comments[2]])
})
