import assert from 'node:assert/strict'
import test from 'node:test'

import {
  commentAnnotation,
  commentTargetLabel,
  createCommentAnnotations,
  normalizeCommentRange,
} from './comment-annotations.js'

test('diff ranges normalize direction and map renderer sides to review targets', () => {
  assert.deepEqual(normalizeCommentRange('src/main.zig', {
    start: 12,
    end: 8,
    side: 'deletions',
  }, true), {
    annotationSide: 'deletions',
    selection: {
      start: 8,
      end: 12,
      side: 'deletions',
      endSide: 'deletions',
    },
    target: {
      kind: 'line',
      path: 'src/main.zig',
      side: 'old',
      startLine: 8,
      endLine: 12,
    },
  })
})

test('cross-side selections collapse to their ending line and side', () => {
  assert.deepEqual(normalizeCommentRange('src/main.zig', {
    start: 7,
    end: 9,
    side: 'deletions',
    endSide: 'additions',
  }, true), {
    annotationSide: 'additions',
    selection: {
      start: 9,
      end: 9,
      side: 'additions',
      endSide: 'additions',
    },
    target: {
      kind: 'line',
      path: 'src/main.zig',
      side: 'new',
      startLine: 9,
      endLine: 9,
    },
  })
})

test('file ranges omit diff-side selection metadata', () => {
  assert.deepEqual(normalizeCommentRange('README.md', {
    start: 6,
    end: 3,
  }, false), {
    annotationSide: 'additions',
    selection: { start: 3, end: 6 },
    target: {
      kind: 'line',
      path: 'README.md',
      side: 'new',
      startLine: 3,
      endLine: 6,
    },
  })
})

test('target labels distinguish files, sides, and line ranges', () => {
  assert.equal(commentTargetLabel({ kind: 'file', path: 'README.md' }), (
    'File comment on README.md'
  ))
  assert.equal(commentTargetLabel({
    kind: 'line',
    path: 'src/main.zig',
    side: 'old',
    startLine: 4,
    endLine: 4,
  }), 'Comment on old line 4')
  assert.equal(commentTargetLabel({
    kind: 'line',
    path: 'src/main.zig',
    side: 'new',
    startLine: 4,
    endLine: 8,
  }), 'Comment on new lines 4–8')
})

test('comment annotations use line zero and a file-appropriate fallback side', () => {
  const fileComment = {
    id: 'file-comment',
    body: 'File note',
    target: { kind: 'file', path: 'removed.txt' },
  }

  assert.deepEqual(commentAnnotation(fileComment, true, 'deletions'), {
    lineNumber: 0,
    side: 'deletions',
    metadata: { kind: 'comment', comment: fileComment },
  })
  assert.deepEqual(commentAnnotation(fileComment, false, 'additions'), {
    lineNumber: 0,
    metadata: { kind: 'comment', comment: fileComment },
  })
})

test('annotation mapping filters paths and appends drafts on the correct side', () => {
  const included = {
    id: 'included',
    body: 'Old line',
    target: {
      kind: 'line',
      path: 'removed.txt',
      side: 'old',
      startLine: 2,
      endLine: 3,
    },
  }
  const ignored = {
    id: 'ignored',
    body: 'Other file',
    target: { kind: 'file', path: 'other.txt' },
  }
  const draft = {
    target: { kind: 'file', path: 'removed.txt' },
  }
  const fileDiff = {
    path: 'removed.txt',
    content: { kind: 'diff', oldFile: {}, newFile: null },
  }

  assert.deepEqual(createCommentAnnotations(fileDiff, [included, ignored], draft), [{
    lineNumber: 3,
    side: 'deletions',
    metadata: { kind: 'comment', comment: included },
  }, {
    lineNumber: 0,
    side: 'deletions',
    metadata: { kind: 'draft', draft },
  }])
})
