import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SearchMatch from './SearchMatch.js'

test('renders paths, one-based lines, UTF-16 spans, and escaped source text', () => {
  const html = renderToStaticMarkup(createElement(SearchMatch, { match: {
    path: 'src/雪.txt', lineNumber: 12, lineText: 'a😀é <script>é',
    spans: [{ start: 1, end: 3 }, { start: 13, end: 14 }],
  } }))
  assert.match(html, /src\/雪.txt:12/)
  assert.match(html, /a<mark>😀<\/mark>é &lt;script&gt;<mark>é<\/mark>/)
  assert(!html.includes('<script>'))
})
