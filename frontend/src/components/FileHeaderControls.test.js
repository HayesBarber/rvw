import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let FileHeaderActions
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
  FileHeaderActions = (await server.ssrLoadModule('/src/components/FileHeaderControls.jsx')).FileHeaderActions
})
after(async () => { await server?.close() })

test('changed files expose a labeled checkbox that marks and clears viewed status', () => {
  const changes = []
  for (const viewed of [false, true]) {
    const props = { changed: true, viewed, onChangeViewed: (next) => changes.push(next) }
    const html = renderToStaticMarkup(createElement(FileHeaderActions, props))
    assert.match(html, /<label class="file-viewed-control"><input type="checkbox"/)
    assert.match(html, /Viewed<\/label>/)
    assert.equal(html.includes('checked=""'), viewed)
    const label = FileHeaderActions(props).props.children[0]
    label.props.children[0].props.onChange({ target: { checked: !viewed } })
  }
  assert.deepEqual(changes, [true, false])
})

test('unchanged files have no viewed control', () => {
  const html = renderToStaticMarkup(createElement(FileHeaderActions, { changed: false }))
  assert.doesNotMatch(html, /checkbox|Viewed/)
})

test('viewed control remains available when file comments are unavailable', () => {
  const html = renderToStaticMarkup(createElement(FileHeaderActions, {
    changed: true, viewed: false, canCommentOnFile: false,
  }))
  assert.match(html, /<input type="checkbox"\/>/)
  assert.match(html, /class="file-comment-button" type="button" disabled=""/)
})
