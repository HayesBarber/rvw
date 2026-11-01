import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { preloadFileTree } from '@pierre/trees/ssr'
import { FileTree } from '@pierre/trees'
import { ApplicationAction } from '../../actions/application-actions.js'
import { createFileTreeActionAdapter } from '../../actions/file-tree-actions.js'
import { workingTreePickerTreeOptions } from './working-tree-picker-tree.js'

let server
let View
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
  View = (await server.ssrLoadModule('/src/components/review-source-picker/WorkingTreePicker.jsx')).WorkingTreePickerView
})
after(async () => { await server?.close() })

const render = (props) => renderToStaticMarkup(createElement(View, { files: [], ...props }))

test('loading and idle states announce progress without displaying old files', () => {
  for (const status of ['idle', 'loading']) {
    const html = render({ status, files: [{ path: 'stale.txt' }] })
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /role="status">Loading working tree changes…/)
    assert.doesNotMatch(html, /stale.txt|<table/)
  }
})

test('a clean working tree displays the empty message', () => {
  const html = render({ status: 'success' })
  assert.match(html, /No working tree changes\./)
  assert.match(html, /aria-busy="false"/)
  assert.doesNotMatch(html, /<table|Retry/)
})

test('errors display a native Retry button connected to the retry handler', () => {
  let calls = 0
  const props = { status: 'error', files: [], error: 'Repository unavailable', onRetry: () => { calls += 1 } }
  const html = render(props)
  assert.match(html, /role="alert"/)
  assert.match(html, /Unable to load working tree changes: Repository unavailable/)
  assert.match(html, /<button type="button" data-vim-native-activation="true">Retry<\/button>/)
  assert.doesNotMatch(html, /<table/)
  const view = View(props)
  const errorView = view.props.children.find((child) => child?.props?.role === 'alert')
  errorView.props.children.find((child) => child.type === 'button').props.onClick()
  assert.equal(calls, 1)
})

test('summaries use tree order for root files and nested directories', () => {
  const paths = ['z.txt', 'src/z.txt', 'README.md', 'src/nested/a.txt', 'assets/icon.png', 'src/a.txt']
  const files = paths.map((path) => ({ path, status: 'modified', additions: 1, deletions: 2 }))
  const html = preloadFileTree(workingTreePickerTreeOptions(files)).shadowHtml
  const renderedPaths = [...html.matchAll(/data-item-path="([^"]+)" data-item-type="file"/g)].map((match) => match[1])
  assert.deepEqual(renderedPaths, ['assets/icon.png', 'src/nested/a.txt', 'src/a.txt', 'src/z.txt', 'README.md', 'z.txt'])
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /data-icon-name="file-tree-icon-file"/)
  assert.match(render({ status: 'success', files }), /<file-tree-container[^>]*aria-label="Working tree changes"[^>]*tabIndex="0"/)
  assert.doesNotMatch(html, /aria-selected="true"|<input|<table/)
})

test('summaries preserve status, rename paths, zero counts, and unavailable counts', () => {
  const files = [
    { path: 'new 雪.txt', previousPath: 'old & file.txt', status: 'renamed', additions: 0, deletions: 3 },
    { path: 'binary.dat', previousPath: null, status: 'added', additions: null, deletions: null },
    { path: 'gone.txt', previousPath: null, status: 'deleted', additions: null, deletions: 5 },
  ]
  const html = preloadFileTree(workingTreePickerTreeOptions(files)).shadowHtml
  assert.match(html, /new 雪.txt/)
  assert.match(html, /From old &amp; file.txt/)
  assert.match(html, /title="Git status: renamed">R/)
  assert.match(html, />\+0<\/span>/)
  assert.match(html, />\u00a0−3<\/span>/)
  assert.match(html, /title="Git status: added">A/)
  assert.match(html, /title="Git status: deleted">D/)
  assert.equal([...html.matchAll(/(?:Added|Deleted): Unavailable/g)].length, 3)
})

test('tree navigation expands folders without selecting files for review', () => {
  const model = new FileTree(workingTreePickerTreeOptions([{ path: 'src/a.txt', status: 'modified', additions: 1, deletions: 0 }]))
  const actions = createFileTreeActionAdapter(model, () => {})
  model.focusPath('src/')
  assert.equal(actions[ApplicationAction.TREE_COLLAPSE_OR_PARENT](), true)
  assert.equal(model.getItem('src/').isExpanded(), false)
  assert.equal(actions[ApplicationAction.TREE_EXPAND](), true)
  assert.equal(model.getItem('src/').isExpanded(), true)
  assert.equal(actions[ApplicationAction.CURSOR_DOWN](), true)
  assert.equal(model.getFocusedPath(), 'src/a.txt')
  assert.equal(actions[ApplicationAction.ITEM_ACTIVATE](), true)
  assert.deepEqual(model.getSelectedPaths(), [])
  model.cleanUp()
})
