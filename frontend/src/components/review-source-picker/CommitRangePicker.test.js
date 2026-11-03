import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { comparisonEndpoints, createComparisonSubmitHandler, toggleComparisonEndpoint } from '../../review/comparison-selection.js'
import { createCommitsRequest } from '../../review/commits-request.js'

let server
let Content
before(async () => {
  server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null } })
  Content = (await server.ssrLoadModule('/src/components/review-source-picker/CommitRangePicker.jsx')).CommitRangePickerContent
})
after(async () => { await server?.close() })

const commits = [
  { sha: 'b'.repeat(40), subject: 'Fix <quoted> 雪', authorName: 'Test Author', commitDate: '2026-11-03T10:00:00-05:00' },
  { sha: 'a'.repeat(40), subject: 'Earlier commit', authorName: 'Other Author', commitDate: '2026-11-02T09:00:00-05:00' },
]
const endpoints = comparisonEndpoints(commits)
const success = { status: 'success', data: commits }
function render(state, selected = []) {
  return renderToStaticMarkup(createElement(Content, { state, selected }))
}
function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate))
  if (!node?.props) return []
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate)]
}

test('the timeline renders Working tree above commit metadata in API order', () => {
  const html = render(success)
  assert.match(html, /aria-label="Comparison endpoints"/)
  assert(html.indexOf('Working tree') < html.indexOf('bbbbbbb'))
  assert(html.indexOf('bbbbbbb') < html.indexOf('aaaaaaa'))
  for (const text of ['Fix &lt;quoted&gt; 雪', 'Test Author', '2026-11-03', 'Earlier commit', 'Other Author', '2026-11-02']) assert(html.includes(text))
  assert.match(html, /dateTime="2026-11-03T10:00:00-05:00"/)
  assert.match(html, /comparison-picker-marker-working-tree/)
  assert.equal((html.match(/class="comparison-picker-marker/g) ?? []).length, 3)
  assert.doesNotMatch(html, /Compare the file state|Select two endpoints|Lines show list order/)
  assert.match(html, /data-endpoint="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"/)
})

test('checked markers and Base and Target labels follow list order for both source kinds', () => {
  for (const indices of [[2, 1], [2, 0]]) {
    const selected = indices.map((index) => endpoints[index])
    const html = render(success, selected)
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2)
    assert.equal((html.match(/>✓<\/span>/g) ?? []).length, 2)
    assert.equal((html.match(/>Target<\/span>/g) ?? []).length, 1)
    assert.equal((html.match(/>Base<\/span>/g) ?? []).length, 1)
    assert(html.indexOf('>Target</span>') < html.indexOf('>Base</span>'))
    assert.doesNotMatch(html, /disabled=""[^>]*>Review comparison/)
  }
})

test('loading and errors keep Working tree visible and disable selection and submission', () => {
  for (const status of ['idle', 'loading', 'error']) {
    const state = { status, data: commits, error: 'Repository unavailable' }
    const html = render(state, endpoints.slice(1))
    assert.match(html, /Working tree/)
    assert.doesNotMatch(html, /bbbbbbb|aaaaaaa|>Base<|>Target</)
    assert.match(html, /disabled=""[^>]*>Review comparison/)
    const nodes = findAll(Content({ state, selected: [] }), (node) => node.props.className === 'comparison-picker-node')
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].props.disabled, true)
    if (status === 'error') {
      assert.match(html, /role="alert"/)
      assert.match(html, /Repository unavailable/)
      assert.match(html, />Retry<\/button>/)
    } else assert.match(html, /role="status">Loading commits…/)
  }
})

test('empty history leaves a selectable Working tree but cannot submit a comparison', () => {
  const state = { status: 'success', data: [] }
  const html = render(state, [endpoints[0]])
  assert.match(html, /No commits. Two endpoints are required/)
  const nodes = findAll(Content({ state, selected: [endpoints[0]] }), (node) => node.props.className === 'comparison-picker-node')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].props.disabled, false)
  assert.equal(nodes[0].props['aria-pressed'], true)
  assert.match(html, /disabled=""[^>]*>Review comparison/)
})

test('pointer selection checks, replaces, and unchecks endpoints without submitting', () => {
  let selected = []
  const calls = []
  const submit = createComparisonSubmitHandler({
    getRequest: () => success, getSelection: () => selected, onSelect: (source) => calls.push(source),
  })
  const content = () => Content({ state: success, selected, onSubmit: submit,
    onToggle: (endpoint) => { selected = toggleComparisonEndpoint(endpoints, selected, endpoint) },
  })
  const nodes = () => findAll(content(), (node) => node.props.className === 'comparison-picker-node')
  nodes()[2].props.onClick()
  nodes()[1].props.onClick()
  nodes()[0].props.onClick()
  assert.deepEqual(selected, [endpoints[2], endpoints[0]])
  assert.deepEqual(calls, [])
  const button = findAll(content(), (node) => node.props.className === 'comparison-picker-submit')[0]
  assert.equal(button.props.disabled, false)
  assert.equal(button.props.onClick(), true)
  assert.deepEqual(calls, [{ kind: 'working-tree', base: commits[1].sha }])
  nodes()[0].props.onClick()
  assert.deepEqual(selected, [endpoints[2]])
  assert.equal(button.props.onClick(), false)
})

test('Retry replaces the error with a fresh commit list', async () => {
  let calls = 0
  const request = createCommitsRequest({ list: async () => {
    if (++calls === 1) throw new Error('Failed')
    return { commits }
  } })
  await request.load()
  const content = Content({ state: request.getSnapshot(), selected: [], onRetry: request.load })
  const [retry] = findAll(content, (node) => node.type === 'button' && node.props.children === 'Retry')
  await retry.props.onClick()
  assert.equal(calls, 2)
  assert.match(render(request.getSnapshot()), /Fix &lt;quoted&gt; 雪/)
  assert.doesNotMatch(render(request.getSnapshot()), />Retry<\/button>/)
})

test('the range includes all rows between Target and Base but only the endpoints are checked', () => {
  const history = Array.from({ length: 5 }, (_, index) => ({ ...commits[0], sha: String(index + 1).repeat(40) }))
  const timeline = comparisonEndpoints(history)
  const state = { status: 'success', data: history }
  for (const [target, base] of [[1, 4], [0, 4]]) {
    for (const selected of [[timeline[target], timeline[base]], [timeline[base], timeline[target]]]) {
      const content = Content({ state, selected })
      const rows = findAll(content, (node) => node.type === 'li')
      assert.deepEqual(rows.map((row) => row.props['data-in-comparison'] === true),
        timeline.map((_, index) => index >= target && index <= base))
      assert.equal(rows[target].props['data-comparison-role'], 'Target')
      assert.equal(rows[base].props['data-comparison-role'], 'Base')
      const checked = findAll(content, (node) => node.props['aria-pressed'] === true)
      assert.equal(checked.length, 2)
    }
  }
  for (const selected of [[], [timeline[1]], [timeline[0]]]) {
    const rows = findAll(Content({ state, selected }), (node) => node.type === 'li')
    assert(rows.every((row) => row.props['data-in-comparison'] === undefined))
  }
})

test('the review button is outside the scroll area in every request state', () => {
  for (const status of ['idle', 'loading', 'error', 'success']) {
    const content = Content({ state: { status, data: commits, error: 'Failed' }, selected: [] })
    const [scroll] = findAll(content, (node) => node.props.className === 'comparison-picker-scroll')
    const [footer] = findAll(content, (node) => node.type === 'footer')
    const submit = (node) => node.props.className === 'comparison-picker-submit'
    assert.equal(findAll(scroll, submit).length, 0)
    assert.equal(findAll(footer, submit).length, 1)
  }
})

test('timeline focus reports an explicit endpoint without checking or submitting it', () => {
  const focused = []
  const content = Content({ state: success, selected: [], onFocus: (endpoint) => focused.push(endpoint) })
  const nodes = findAll(content, (node) => node.props.className === 'comparison-picker-node')
  for (const node of nodes) {
    assert.equal(node.props['data-vim-capture'], true)
    assert.equal(node.props['data-vim-native-activation'], undefined)
    node.props.onFocus()
  }
  assert.deepEqual(focused, endpoints)
  assert(nodes.every((node) => node.props['aria-pressed'] === false))
  const [submit] = findAll(content, (node) => node.props.className === 'comparison-picker-submit')
  assert.equal(submit.props['data-vim-native-activation'], true)
})
