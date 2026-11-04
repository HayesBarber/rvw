import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { ApplicationAction } from '../../actions/application-actions.js'
import { createApplicationDispatcher } from '../../actions/application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from '../../actions/overlay-actions.js'
import { createCommitsRequest } from '../../review/commits-request.js'
import { createPullRequestsRequest } from '../../review/pull-requests-request.js'

let server
let ReviewSourcePicker
let ReviewSourcePickerContent
let ReviewSourcePickerStatus
let ReviewSourceModeControl
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const pickerModule = await server.ssrLoadModule('/src/components/review-source-picker/ReviewSourcePicker.jsx')
  ReviewSourcePicker = pickerModule.default
  ReviewSourcePickerContent = pickerModule.ReviewSourcePickerContent
  ReviewSourcePickerStatus = pickerModule.ReviewSourcePickerStatus
  ReviewSourceModeControl = (await server.ssrLoadModule('/src/components/review-source-picker/ReviewSourceModeControl.jsx')).default
})
after(async () => { await server?.close() })

test('the picker shell uses a labelled native dialog and a Close control', () => {
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => {},
    registerActionAdapter: () => {},
  }))
  const titleId = html.match(/<h2 id="([^"]+)">Choose review source<\/h2>/)?.[1]
  assert(titleId)
  assert(html.includes(`aria-labelledby="${titleId}"`))
  assert.match(html, /<dialog class="review-source-picker-dialog"/)
  assert.match(html, /tabindex="-1" data-vim-capture="true"/)
  assert.match(html, /<button type="button" data-vim-native-activation="true" aria-label="Close review source picker">Close<\/button>/)
})

test('the picker starts with only Commits selected', () => {
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => {},
    registerActionAdapter: () => {},
  }))
  assert.match(html, /role="group" aria-label="Review source mode"/)
  assert.match(html, /aria-pressed="true">Commits<\/button>/)
  assert.match(html, /aria-pressed="false">Pull requests<\/button>/)
  assert.match(html, /Working tree/)
  assert.match(html, /Loading commits…/)
  assert.doesNotMatch(html, /aria-pressed="false">Working tree<\/button>/)
  assert.doesNotMatch(html, /Pull request selection|Working tree selection/)
})

test('each mode displays only its corresponding content', () => {
  for (const [mode, expected] of [
    ['commits', 'Loading commits…'],
    ['pull-requests', null],
  ]) {
    const registerActionAdapter = () => () => {}
    const content = ReviewSourcePickerContent({ mode, registerActionAdapter, commitsRequest: createCommitsRequest(), pullRequestsRequest: createPullRequestsRequest() })
    assert.equal(content.props.registerActionAdapter, registerActionAdapter)
    const html = renderToStaticMarkup(content)
    if (expected) {
      assert(html.includes(expected))
      assert.match(html, /Working tree/)
      assert.doesNotMatch(html, /Loading pull requests/)
    } else {
      assert.equal(html, '<p role="status">Loading pull requests…</p>')
    }
  }
})

test('the pull request mode receives the overlay request and selection callback', async () => {
  const onSelectPullRequest = () => {}
  let loads = 0
  const pullRequestsRequest = createPullRequestsRequest({ list: async () => {
    loads += 1
    return { pullRequests: [{ number: 42, title: 'Loaded once', authorLogin: 'author', baseRefName: 'main', headRefName: 'fix' }] }
  } })
  await pullRequestsRequest.load()
  const props = { onSelectPullRequest, pullRequestsRequest }
  const content = ReviewSourcePickerContent({ ...props, mode: 'pull-requests' })
  assert.equal(content.props.onSelect, onSelectPullRequest)
  assert.equal(content.props.request, pullRequestsRequest)
  ReviewSourcePickerContent({ ...props, mode: 'commits' })
  const reopened = ReviewSourcePickerContent({ ...props, mode: 'pull-requests' })
  assert.equal(reopened.props.request, pullRequestsRequest)
  assert.match(renderToStaticMarkup(reopened), /Loaded once/)
  assert.equal(loads, 1)
})

test('mode controls select one mode at a time', () => {
  let mode = 'commits'
  const onChange = (value) => { mode = value }
  for (const value of ['pull-requests', 'commits']) {
    const controls = ReviewSourceModeControl({ mode, onChange })
    const button = controls.props.children.find((child) => child.key === value)
    assert.equal(button.props.type, 'button')
    button.props.onClick()
    assert.equal(mode, value)
    const updated = ReviewSourceModeControl({ mode, onChange }).props.children
    assert.deepEqual(updated.filter((child) => child.props['aria-pressed']).map((child) => child.key), [value])
  }
})

test('the picker registration blocks all workspace actions until it closes', () => {
  const registry = createOverlayActionRegistry()
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => 'diff_pane',
    getSurfaceActions: () => ({
      [ApplicationAction.ADD_COMMENT]: () => { calls.push('comment'); return true },
    }),
    getOverlayActions: registry.get,
    globalActions: {
      [ApplicationAction.RELOAD_REVIEW]: () => { calls.push('reload'); return true },
    },
  })
  const picker = registry.register(OverlayKind.REVIEW_SOURCE_PICKER)
  for (const action of Object.values(ApplicationAction)) assert.equal(dispatch(action), false)
  assert.deepEqual(calls, [])
  picker.unregister()
  assert.equal(dispatch(ApplicationAction.ADD_COMMENT), true)
  assert.equal(dispatch(ApplicationAction.RELOAD_REVIEW), true)
  assert.deepEqual(calls, ['comment', 'reload'])
})

test('the commits mode retains the overlay request and comparison callback across mode changes', async () => {
  const onSelectComparison = () => {}
  let loads = 0
  const commitsRequest = createCommitsRequest({ list: async () => {
    loads += 1
    return { commits: [{ sha: 'a'.repeat(40), subject: 'Loaded once', authorName: 'Author', commitDate: '2026-11-03' }] }
  } })
  await commitsRequest.load()
  const props = { onSelectComparison, commitsRequest }
  const content = ReviewSourcePickerContent({ ...props, mode: 'commits' })
  assert.equal(content.props.onSelect, onSelectComparison)
  assert.equal(content.props.request, commitsRequest)
  assert.match(renderToStaticMarkup(content), /Loaded once/)
  ReviewSourcePickerContent({ ...props, mode: 'pull-requests' })
  const returned = ReviewSourcePickerContent({ ...props, mode: 'commits' })
  assert.equal(returned.props.request, commitsRequest)
  assert.match(renderToStaticMarkup(returned), /Loaded once/)
  assert.equal(loads, 1)
})

test('pending replacement shows progress and disables closing, mode controls, and endpoint selection', () => {
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => assert.fail('Closed while replacing'), registerActionAdapter: () => {},
    reloadRequest: { status: 'loading', isLocked: () => true },
  }))
  assert.match(html, /role="status">Loading selected review/)
  assert.match(html, /disabled="" aria-label="Close review source picker"/)
  assert.match(html, /aria-pressed="true" disabled="">Commits/)
  assert.match(html, /aria-pressed="false" disabled="">Pull requests/)
  assert.match(html, /aria-busy="true"/)
})

test('a failed replacement keeps picker content available for another submission', () => {
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => {}, registerActionAdapter: () => {},
    reloadRequest: { status: 'error', error: 'Selected review unavailable', isLocked: () => false },
  }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Selected review unavailable/)
  assert.match(html, /Working tree/)
  assert.match(html, /aria-label="Close review source picker">Close/)
  assert.doesNotMatch(html, /aria-pressed="true" disabled="">Commits/)
})

test('a document navigation error offers retry while source controls stay locked', () => {
  let retries = 0
  const request = {
    status: 'error', error: 'Unable to load document', data: { sessionId: 2 },
    isLocked: () => true, reload: () => { retries++ },
  }
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => {}, registerActionAdapter: () => {}, reloadRequest: request,
  }))
  assert.match(html, /disabled="" aria-label="Close review source picker"/)
  assert.match(html, /Unable to load document/)
  assert.match(html, /data-vim-native-activation="true">Retry loading review<\/button>/)
  const status = ReviewSourcePickerStatus({ request })
  status.props.children[1].props.onClick()
  assert.equal(retries, 1)
})
