import assert from 'node:assert/strict'
import test from 'node:test'
import { preloadFileTree } from '@pierre/trees'
import { fileViewedDecoration } from './file-viewed-decoration.js'

test('tree indicators reflect marking and clearing while retaining Git status', () => {
  const viewedPaths = new Set()
  const render = () => preloadFileTree({
    paths: ['src/changed.js', 'src/unchanged.js'],
    initialExpansion: 'open',
    gitStatus: [{ path: 'src/changed.js', status: 'modified' }],
    renderRowDecoration: ({ item }) => fileViewedDecoration(item, viewedPaths),
  }).shadowHtml

  assert.doesNotMatch(render(), /title="Viewed"/)
  viewedPaths.add('src/changed.js')
  const marked = render()
  assert.match(marked, /title="Viewed"[^>]*>✓/)
  assert.match(marked, /data-item-git-status="modified"/)
  assert.equal((marked.match(/title="Viewed"/g) ?? []).length, 1)
  viewedPaths.delete('src/changed.js')
  assert.doesNotMatch(render(), /title="Viewed"/)
})

test('directory rows have no viewed indicator', () => {
  assert.equal(fileViewedDecoration({ kind: 'directory', path: 'src/' }, new Set(['src/'])), null)
})
