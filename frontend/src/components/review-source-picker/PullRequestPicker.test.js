import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { createPullRequestSubmitHandler } from '../../actions/pull-request-picker-actions.js'
import { createPullRequestsRequest } from '../../review/pull-requests-request.js'

let server
let PullRequestPickerContent
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const picker = await server.ssrLoadModule('/src/components/review-source-picker/PullRequestPicker.jsx')
  PullRequestPickerContent = picker.PullRequestPickerContent
})
after(async () => { await server?.close() })

const pullRequests = [
  { number: 42, title: 'Fix <quoted> 雪', authorLogin: 'author', isDraft: true,
    baseRefName: 'main', headRefName: 'feature/雪' },
  { number: 7, title: 'Earlier PR', authorLogin: 'other', isDraft: false,
    baseRefName: 'release', headRefName: 'fix' },
]

function render(state) {
  return renderToStaticMarkup(createElement(PullRequestPickerContent, { state }))
}

function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate))
  if (!node?.props) return []
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate)]
}

test('tiles display metadata, drafts, escaped text, and API order', () => {
  const html = render({ status: 'success', data: pullRequests })
  assert.match(html, /<ul class="pull-request-picker-list" aria-label="Open pull requests">/)
  assert.equal((html.match(/class="pull-request-picker-tile"/g) ?? []).length, 2)
  assert(html.indexOf('#42') < html.indexOf('#7'))
  for (const text of ['Fix &lt;quoted&gt; 雪', 'author', 'Base: main', 'Head: feature/雪',
    'Earlier PR', 'other', 'Base: release', 'Head: fix']) assert(html.includes(text))
  assert.equal((html.match(/>Draft<\/span>/g) ?? []).length, 1)
  assert.doesNotMatch(html, /<a /)
})

test('loading, empty, and error states have no tiles', () => {
  for (const status of ['idle', 'loading', 'error']) {
    const html = render({ status, data: pullRequests, error: 'Authentication failed' })
    assert.doesNotMatch(html, /pull-request-picker-tile|No open pull requests/)
    if (status === 'error') {
      assert.match(html, /role="alert"/)
      assert.match(html, /Unable to load pull requests: Authentication failed/)
      assert.match(html, /data-vim-native-activation="true">Retry<\/button>/)
    } else {
      assert.match(html, /role="status">Loading pull requests…/)
      assert.doesNotMatch(html, /Retry/)
    }
  }
  assert.equal(render({ status: 'success', data: [] }), '<p role="status">No open pull requests.</p>')
})

test('pointer activation uses the guarded callback and sends only the clicked PR number', () => {
  let state = { status: 'success', data: pullRequests }
  const selected = []
  const focused = []
  const onSubmit = createPullRequestSubmitHandler({
    getRequest: () => state, onSelect: (...args) => selected.push(args),
  })
  const content = PullRequestPickerContent({ state, onSubmit, onFocus: (number) => focused.push(number) })
  const buttons = findAll(content, (node) => node.type === 'button')
  assert.equal(buttons[1].props.type, 'button')
  assert.equal(buttons[1].props['data-vim-native-activation'], true)
  buttons[1].props.onFocus()
  assert.deepEqual(focused, [7])
  assert.deepEqual(selected, [])
  buttons[1].props.onClick()
  assert.deepEqual(selected, [[7]])
  state = { status: 'loading', data: [] }
  buttons[0].props.onClick()
  state = { status: 'error', data: [], error: 'Failed' }
  buttons[1].props.onClick()
  assert.deepEqual(selected, [[7]])
})

test('Retry starts a fresh request and replaces the error state with results', async () => {
  let calls = 0
  const request = createPullRequestsRequest({ list: async () => {
    if (++calls === 1) throw new Error('Request failed')
    return { pullRequests }
  } })
  await request.load()
  const content = PullRequestPickerContent({ state: request.getSnapshot(), onRetry: request.load })
  const [retry] = findAll(content, (node) => node.type === 'button')
  const pending = retry.props.onClick()
  assert.equal(request.getSnapshot().status, 'loading')
  await pending
  assert.equal(calls, 2)
  assert.match(render(request.getSnapshot()), /Fix &lt;quoted&gt; 雪/)
  assert.doesNotMatch(render(request.getSnapshot()), /Request failed|Retry/)
})
