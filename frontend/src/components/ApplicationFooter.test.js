import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { clearAllComments, removeDeletedComment, replaceEditedComment } from '../review/comments-request.js'

let server
let ApplicationFooter
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  ApplicationFooter = (await server.ssrLoadModule('/src/components/ApplicationFooter.jsx')).default
})
after(async () => { await server?.close() })

function render(comments = [], extra = {}) {
  return renderToStaticMarkup(createElement(ApplicationFooter, {
    repositoryName: 'review',
    overview: { files: [] },
    commentsCount: comments.length,
    onToggleComments: () => {},
    vimState: { mode: 'normal', pendingKeys: [] },
    ...extra,
  }))
}

function assertCount(comments, count) {
  const html = render(comments)
  assert.match(html, new RegExp(`Comments \\(${count}\\)`))
  assert.match(html, /<button class="comments-button" type="button" aria-haspopup="dialog" aria-expanded="false">/)
  assert.doesNotMatch(html, /Copy as Markdown|copy-markdown-button/)
}

test('footer counts saved review, file, and line comments after mutations', () => {
  let comments = []
  assertCount(comments, 0)
  for (const target of [
    { kind: 'review' },
    { kind: 'file', path: 'a.js' },
    { kind: 'line', path: 'a.js', side: 'new', startLine: 1, endLine: 1 },
  ]) {
    comments = [...comments, { id: String(comments.length), body: 'Saved', target }]
    assertCount(comments, comments.length)
  }
  comments = replaceEditedComment(comments, { ...comments[0], body: 'Edited' })
  assertCount(comments, 3)
  comments = removeDeletedComment(comments, '1')
  assertCount(comments, 2)
  comments = clearAllComments(comments)
  assertCount(comments, 0)
})

test('an empty review keeps the comments button enabled during copy requests', () => {
  for (const status of ['idle', 'loading', 'success', 'error']) {
    const html = render([], { copyRequest: { status } })
    assert.match(html, /<button class="comments-button" type="button" aria-haspopup="dialog" aria-expanded="false">/)
    assert.match(html, /Comments \(0\)/)
  }
})

test('loading and failed review shells have no comments button', () => {
  assert.doesNotMatch(render([], { repositoryName: undefined, overview: undefined }), /comments-button/)
})

test('workspace copy errors remain visible next to the comments button', () => {
  const html = render([], {
    copyRequest: { status: 'error' },
    copyMessage: 'Unable to copy: Clipboard unavailable',
  })
  assert.match(html, /role="alert"[^>]*>Unable to copy: Clipboard unavailable/)
})


test('comments button exposes panel state and a directional chevron', () => {
  const closed = render()
  const open = render([], { commentsOpen: true })
  assert.match(closed, /aria-expanded="false"/)
  assert.match(closed, /<path d="M4 10l4-4 4 4"/)
  assert.match(open, /aria-expanded="true"/)
  assert.match(open, /<path d="M4 6l4 4 4-4"/)
  assert.match(open, /<svg class="comments-chevron"[^>]*aria-hidden="true"/)
})
