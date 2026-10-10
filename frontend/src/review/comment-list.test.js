import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommentGroups } from './comment-list.js'

function comment(id, target) {
  return { id, body: id, commentType: null, target }
}

test('review comments precede file groups and retain saved order', () => {
  const file = comment('file', { kind: 'file', path: 'README.md' })
  const first = comment('review-2', { kind: 'review' })
  const second = comment('review-1', { kind: 'review' })

  assert.deepEqual(createCommentGroups([file, first, second]), [
    { kind: 'review', comments: [first, second] },
    { kind: 'file', path: 'README.md', comments: [file] },
  ])
})

test('file and line comments share path groups across the full session', () => {
  const line = comment('line', {
    kind: 'line', path: 'src/main.zig', side: 'old', startLine: 7, endLine: 9,
  })
  const readme = comment('readme', { kind: 'file', path: 'README.md' })
  const file = comment('file', { kind: 'file', path: 'src/main.zig' })
  const newLine = comment('new-line', {
    kind: 'line', path: 'src/main.zig', side: 'new', startLine: 2, endLine: 2,
  })

  assert.deepEqual(createCommentGroups([line, readme, file, newLine]), [
    { kind: 'file', path: 'README.md', comments: [readme] },
    { kind: 'file', path: 'src/main.zig', comments: [line, file, newLine] },
  ])
})

test('file group order is independent of input order and locale', () => {
  const paths = ['z.txt', 'a.txt', 'Z.txt', 'A.txt']
  const comments = paths.map((path) => comment(path, { kind: 'file', path }))
  const groupPaths = (input) => createCommentGroups(input).map((group) => group.path)

  assert.deepEqual(groupPaths(comments), ['A.txt', 'Z.txt', 'a.txt', 'z.txt'])
  assert.deepEqual(groupPaths(comments.toReversed()), groupPaths(comments))
})

test('empty sessions have no groups and review-only sessions need no file', () => {
  assert.deepEqual(createCommentGroups([]), [])
  const review = comment('review', { kind: 'review' })
  assert.deepEqual(createCommentGroups([review]), [
    { kind: 'review', comments: [review] },
  ])
})

test('grouping preserves saved data and does not change the source array', () => {
  const target = Object.freeze({ kind: 'file', path: 'src/main.zig' })
  const saved = Object.freeze({
    id: 'saved', body: 'Keep this text.\nAnd this line.', commentType: 'ISSUE', target,
  })
  const review = Object.freeze(comment('review', Object.freeze({ kind: 'review' })))
  const comments = Object.freeze([saved, review])
  const groups = createCommentGroups(comments)

  assert.equal(groups[0].comments[0], review)
  assert.equal(groups[1].comments[0], saved)
  groups[1].comments.pop()
  assert.deepEqual(comments, [saved, review])
  assert.equal(createCommentGroups(comments)[1].comments[0], saved)
})
