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

test('workspace copy progress and success remain visible with the comments button', () => {
  for (const [status, message] of [['loading', 'Copying…'], ['success', 'Copied 3 comments']]) {
    const html = render([], { copyRequest: { status }, copyMessage: message })
    assert.match(html, new RegExp(`role="status"[^>]*>${message}`))
    assert.match(html, /Comments \(0\)/)
  }
})

test('footer shows clear progress, success, and errors beside copy and Comments', () => {
  for (const [status, message, role] of [
    ['loading', 'Clearing…', 'status'],
    ['success', 'Cleared 3 comments', 'status'],
    ['error', 'Clear failed', 'alert'],
  ]) {
    const html = render([], {
      clearStatus: status, clearMessage: message,
      copyRequest: { status: 'success' }, copyMessage: 'Copied 3 comments',
    })
    const left = html.slice(html.indexOf('class="footer-left"'), html.indexOf('class="repository-context"'))
    const comments = html.slice(html.indexOf('class="footer-comments-action"'))
    assert.doesNotMatch(left, /clear-status|copy-status/)
    assert.match(comments, new RegExp(`class="clear-status ${status}" role="${role}"[^>]*>${message}`))
    assert.match(comments, /class="copy-status success"/)
    assert.match(comments, /class="comments-button"/)
  }
})
