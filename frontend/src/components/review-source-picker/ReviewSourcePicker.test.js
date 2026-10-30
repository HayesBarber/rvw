import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { ApplicationAction } from '../../actions/application-actions.js'
import { createApplicationDispatcher } from '../../actions/application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from '../../actions/overlay-actions.js'

let server
let ReviewSourcePicker
let ReviewSourceModeControl
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  ReviewSourcePicker = (await server.ssrLoadModule('/src/components/review-source-picker/ReviewSourcePicker.jsx')).default
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
  assert.match(html, /<button type="button" data-vim-ignore="true" aria-label="Close review source picker">Close<\/button>/)
})

test('the picker starts with only Commits selected', () => {
  const html = renderToStaticMarkup(createElement(ReviewSourcePicker, {
    onClose: () => {},
    registerActionAdapter: () => {},
  }))
  assert.match(html, /role="group" aria-label="Review source mode" data-vim-ignore="true"/)
  assert.match(html, /aria-pressed="true">Commits<\/button>/)
  assert.match(html, /aria-pressed="false">Pull requests<\/button>/)
  assert.match(html, /aria-pressed="false">Working tree<\/button>/)
})

test('mode controls select one mode at a time', () => {
  let mode = 'commits'
  const onChange = (value) => { mode = value }
  for (const value of ['pull-requests', 'working-tree', 'commits']) {
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
