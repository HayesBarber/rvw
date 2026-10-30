import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { clearAllComments, removeDeletedComment, replaceEditedComment } from '../review/comments-request.js'
import { ApplicationAction } from '../actions/application-actions.js'
import { createApplicationDispatcher } from '../actions/application-dispatch.js'
import { openReviewSourcePicker } from '../actions/review-source-picker-actions.js'
import { initialWorkspaceState, workspaceReducer } from '../app/workspace.js'

let server
let ApplicationFooter
let FooterActionsMenu
before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
  })
  const footerModule = await server.ssrLoadModule('/src/components/ApplicationFooter.jsx')
  ApplicationFooter = footerModule.default
  FooterActionsMenu = footerModule.FooterActionsMenu
})
after(async () => { await server?.close() })

function render(comments = [], extra = {}) {
  return renderToStaticMarkup(createElement(ApplicationFooter, {
    repositoryName: 'review',
    overview: { files: [] },
    commentsCount: comments.length,
    onToggleComments: () => {},
    vimState: { mode: 'normal', pendingKeys: [] },
    ...extra,
  }))
}

function assertCount(comments, count) {
  const html = render(comments)
  assert.match(html, new RegExp(`Comments \\(${count}\\)`))
  assert.match(html, /<button class="comments-button" type="button" aria-haspopup="dialog" aria-expanded="false">/)
  assert.doesNotMatch(html, /Copy as Markdown|copy-markdown-button/)
}

test('the footer menu opens the picker through the application dispatcher', () => {
  let workspace = initialWorkspaceState
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => workspace.activeSurface,
    getSurfaceActions: () => null,
    globalActions: {
      [ApplicationAction.OPEN_REVIEW_SOURCE_PICKER]: () => openReviewSourcePicker((action) => {
        workspace = workspaceReducer(workspace, action)
      }, true),
    },
  })
  const menu = FooterActionsMenu({
    id: 'footer-menu',
    onChooseReviewSource: () => dispatch(ApplicationAction.OPEN_REVIEW_SOURCE_PICKER),
    onReload: () => assert.fail('Reload must not run'),
    onSearchText: () => assert.fail('Search must not run'),
    reloadDisabled: true,
  })
  const html = renderToStaticMarkup(menu)
  assert.match(html, /<button class="footer-actions-item" type="button" aria-haspopup="dialog">Choose review source<\/button>/)
  menu.props.children.find((child) => child.props.children === 'Choose review source').props.onClick()
  assert.deepEqual(workspace, { ...initialWorkspaceState, reviewSourcePickerOpen: true })
})

test('footer counts saved review, file, and line comments after mutations', () => {
  let comments = []
  assertCount(comments, 0)
  for (const target of [
    { kind: 'review' },
    { kind: 'file', path: 'a.js' },
    { kind: 'line', path: 'a.js', side: 'new', startLine: 1, endLine: 1 },
  ]) {
    comments = [...comments, { id: String(comments.length), body: 'Saved', target }]
    assertCount(comments, comments.length)
  }
  comments = replaceEditedComment(comments, { ...comments[0], body: 'Edited' })
  assertCount(comments, 3)
  comments = removeDeletedComment(comments, '1')
  assertCount(comments, 2)
  comments = clearAllComments(comments)
  assertCount(comments, 0)
})

test('an empty review keeps the comments button enabled during copy requests', () => {
  for (const status of ['idle', 'loading', 'success', 'error']) {
    const html = render([], { copyRequest: { status } })
    assert.match(html, /<button class="comments-button" type="button" aria-haspopup="dialog" aria-expanded="false">/)
    assert.match(html, /Comments \(0\)/)
  }
})

test('loading and failed review shells have no comments button', () => {
  assert.doesNotMatch(render([], { repositoryName: undefined, overview: undefined }), /comments-button/)
})

test('workspace copy errors remain visible next to the comments button', () => {
  const html = render([], {
    copyRequest: { status: 'error' },
    copyMessage: 'Unable to copy: Clipboard unavailable',
  })
  assert.match(html, /role="alert"[^>]*>Unable to copy: Clipboard unavailable/)
})


test('comments button exposes panel state and a directional chevron', () => {
  const closed = render()
  const open = render([], { commentsOpen: true })
  assert.match(closed, /aria-expanded="false"/)
  assert.match(closed, /<path d="M4 10l4-4 4 4"/)
  assert.match(open, /aria-expanded="true"/)
  assert.match(open, /<path d="M4 6l4 4 4-4"/)
  assert.match(open, /<svg class="comments-chevron"[^>]*aria-hidden="true"/)
})

test('workspace copy progress and success remain visible with the comments button', () => {
  for (const [status, message] of [['loading', 'Copying…'], ['success', 'Copied 3 comments']]) {
    const html = render([], { copyRequest: { status }, copyMessage: message })
    assert.match(html, new RegExp(`role="status"[^>]*>${message}`))
    assert.match(html, /Comments \(0\)/)
  }
})

test('footer shows clear progress, success, and errors beside copy and Comments', () => {
  for (const [status, message, role] of [
    ['loading', 'Clearing…', 'status'],
    ['success', 'Cleared 3 comments', 'status'],
    ['error', 'Clear failed', 'alert'],
  ]) {
    const html = render([], {
      clearStatus: status, clearMessage: message,
      copyRequest: { status: 'success' }, copyMessage: 'Copied 3 comments',
    })
    const left = html.slice(html.indexOf('class="footer-left"'), html.indexOf('class="repository-context"'))
    const messages = html.slice(html.indexOf('class="footer-comments-status"'), html.indexOf('class="footer-actions"'))
    assert.doesNotMatch(left, /clear-status|copy-status/)
    assert.match(messages, new RegExp(`class="clear-status ${status}" role="${role}"[^>]*>${message}`))
    assert.match(messages, /class="copy-status success"/)
    assert.match(html.slice(html.indexOf('class="footer-comments-action"')), /class="comments-button"/)
  }
})

test('footer keeps a message container before More actions and Comments in all request states', () => {
  for (const extra of [
    {},
    { copyRequest: { status: 'loading' }, copyMessage: 'Copying…' },
    { clearStatus: 'success', clearMessage: 'Cleared 3 comments' },
    { copyRequest: { status: 'error' }, copyMessage: 'Copy failed', clearStatus: 'error', clearMessage: 'Clear failed' },
  ]) {
    const html = render([], extra)
    const actions = html.indexOf('class="footer-actions"')
    const messages = html.indexOf('class="footer-comments-status"')
    const comments = html.indexOf('class="footer-comments-action"')
    assert(messages >= 0 && messages < actions && actions < comments)
    if (!extra.copyMessage && !extra.clearMessage) {
      assert.match(html, /<span class="footer-comments-status"><\/span>/)
    }
  }
})


test('tree path copy progress, success, and failures appear in the footer', () => {
  for (const [request, message, role] of [
    [{ status: 'idle' }, '', 'status'],
    [{ status: 'loading' }, 'Copying path…', 'status'],
    [{ status: 'success', data: { format: 'relative' } }, 'Path copied', 'status'],
    [{ status: 'success', data: { format: 'absolute' } }, 'Absolute path copied', 'status'],
    [{ status: 'error', error: 'Clipboard unavailable' }, 'Clipboard unavailable', 'alert'],
  ]) {
    const html = render([], { pathCopyRequest: request })
    const left = html.slice(html.indexOf('class="footer-left"'), html.indexOf('class="repository-context"'))
    if (message) {
      assert.match(left, new RegExp(`class="file-path-copy-status ${request.status}" role="${role}">${message}`))
    } else {
      assert.doesNotMatch(left, /file-path-copy-status/)
    }
  }
})
