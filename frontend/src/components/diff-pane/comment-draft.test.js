import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let CommentComposer
let CommentEditor
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  CommentComposer = (await server.ssrLoadModule('/src/components/diff-pane/CommentComposer.jsx')).default
  CommentEditor = (await server.ssrLoadModule('/src/components/diff-pane/CommentEditor.jsx')).default
})
after(async () => { await server?.close() })

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, {
    commentTypes: ['ISSUE', 'QUESTION'],
    onCancel: () => {},
    ...props,
  }))
}

test('a new comment without external draft state keeps its default type and empty text', () => {
  const html = render(CommentComposer, {
    target: { kind: 'file', path: 'a.zig' },
    defaultCommentType: 'ISSUE',
  })
  assert.match(html, /<textarea[^>]*><\/textarea>/)
  assert.match(html, /value="ISSUE" selected=""/)
  assert.match(html, /type="submit" disabled=""/)
})

test('an edit without external draft state starts with the saved text and type', () => {
  const html = render(CommentEditor, {
    comment: { id: 'saved', body: 'Saved text', commentType: 'QUESTION' },
  })
  assert.match(html, /<textarea[^>]*>Saved text<\/textarea>/)
  assert.match(html, /value="QUESTION" selected=""/)
})

test('new and edit forms start with retained draft text and an explicitly unset type', () => {
  const draft = { body: '  Unfinished <text>\nNext line  ', commentType: null }
  for (const [Component, props] of [
    [CommentComposer, { target: { kind: 'file', path: 'a.zig' }, defaultCommentType: 'ISSUE' }],
    [CommentEditor, { comment: { id: 'saved', body: 'Saved text', commentType: 'ISSUE' } }],
  ]) {
    const html = render(Component, { ...props, draft })
    assert.match(html, /<textarea[^>]*> {2}Unfinished &lt;text&gt;\nNext line {2}<\/textarea>/)
    assert.match(html, /value="" selected=""/)
    assert.doesNotMatch(html, /value="ISSUE" selected=""/)
    assert.deepEqual(draft, { body: '  Unfinished <text>\nNext line  ', commentType: null })
  }
})

test('an empty edit draft stays empty instead of restoring the saved text', () => {
  const html = render(CommentEditor, {
    comment: { id: 'saved', body: 'Saved text', commentType: 'ISSUE' },
    draft: { body: '', commentType: 'QUESTION' },
  })
  assert.match(html, /<textarea[^>]*><\/textarea>/)
  assert.match(html, /value="QUESTION" selected=""/)
  assert.match(html, /type="submit" disabled=""/)
})
