import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let CommentsOverlay
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  CommentsOverlay = (await server.ssrLoadModule('/src/components/CommentsOverlay.jsx')).default
})
after(async () => { await server?.close() })

function render(comments = [], extra = {}) {
  return renderToStaticMarkup(createElement(CommentsOverlay, {
    comments,
    status: 'success',
    onClose: () => {},
    registerActionAdapter: () => {},
    ...extra,
  }))
}

test('empty comments remain a non-modal panel with a keyboard-accessible close control', () => {
  const html = render()
  assert.match(html, /role="dialog" aria-labelledby="comments-title"/)
  assert.doesNotMatch(html, /aria-modal|file-finder-backdrop/)
  assert.match(html, /class="comments-positioner"/)
  assert.match(html, /aria-label="Close comments"/)
  assert.match(html, /role="listbox" aria-label="Saved comments" tabindex="-1"/)
  assert.match(html, /No saved comments in this review/)
  assert.doesNotMatch(html, /role="option"|aria-activedescendant/)
  assert.doesNotMatch(render([{ id: 'review', body: 'Summary', target: { kind: 'review' } }]), /<a /)
})

test('all saved comments appear with groups, target labels, types, and one initial selection', () => {
  const html = render([
    { id: 'line', body: 'Old text', commentType: 'ISSUE', target: {
      kind: 'line', path: 'z.zig', side: 'old', startLine: 3, endLine: 5,
    } },
    { id: 'file', body: 'File text', target: { kind: 'file', path: 'a.zig' } },
    { id: 'review', body: '<Summary>\nNext line', target: { kind: 'review' } },
    { id: 'new', body: 'New text', target: {
      kind: 'line', path: 'z.zig', side: 'new', startLine: 7, endLine: 7,
    } },
  ])
  assert.match(html, /Comments \(4\)/)
  assert(html.indexOf('Review comments') < html.indexOf('a.zig'))
  assert(html.indexOf('a.zig') < html.indexOf('z.zig'))
  assert.match(html, /&lt;Summary&gt;\nNext line/)
  assert.match(html, /File comment/)
  assert.match(html, /Old lines 3–5/)
  assert.match(html, /New line 7/)
  assert.match(html, /comment-type-badge">ISSUE/)
  assert.equal((html.match(/role="option"/g) ?? []).length, 4)
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1)
  assert.match(html, /aria-activedescendant="saved-comment-review"/)
  assert.doesNotMatch(html, /Edit|Delete/)
  assert.equal((html.match(/class="comment-location-link"/g) ?? []).length, 3)
  assert.match(html, /aria-label="Open old lines 3–5 on z.zig"/)
})

test('loading and errors do not report an empty review', () => {
  const loading = render([], { status: 'loading' })
  assert.match(loading, /Loading comments/)
  assert.doesNotMatch(loading, /No saved comments/)
  const error = render([], { status: 'error', error: 'Request failed' })
  assert.match(error, /role="alert">Unable to load comments: Request failed/)
  assert.doesNotMatch(error, /No saved comments/)
})
