import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction, defaultNormalKeymap } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createOverlayActionRegistry, OverlayKind } from './overlay-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'
import {
  createCommentsListActionAdapter,
  commentLocation,
  moveCommentSelection,
  pageCommentSelection,
  revealSelectedComment,
} from './comments-list-actions.js'

function listModel(length = 5) {
  const comments = Array.from({ length }, (_, index) => ({ id: `comment-${index}` }))
  let selectedId = comments[0]?.id ?? null
  const actions = createCommentsListActionAdapter({
    getComments: () => comments,
    getSelectedId: () => selectedId,
    selectComment: (id) => { selectedId = id },
    getPageIndex: (index, direction, count) => pageCommentSelection(
      comments.map((_, item) => item * 100), index, direction, 400, count,
    ),
  })
  return { comments, actions, selected: () => selectedId }
}

test('up, down, first, and last actions navigate comments and stop at boundaries', () => {
  const model = listModel()
  const { actions } = model
  assert.equal(actions[ApplicationAction.CURSOR_UP](), true)
  assert.equal(model.selected(), 'comment-0')
  actions[ApplicationAction.CURSOR_DOWN](3)
  assert.equal(model.selected(), 'comment-3')
  actions[ApplicationAction.CURSOR_DOWN](100)
  assert.equal(model.selected(), 'comment-4')
  actions[ApplicationAction.CURSOR_UP](2)
  assert.equal(model.selected(), 'comment-2')
  actions[ApplicationAction.CURSOR_FIRST]()
  assert.equal(model.selected(), 'comment-0')
  actions[ApplicationAction.CURSOR_LAST]()
  assert.equal(model.selected(), 'comment-4')
})

test('movement uses one step for invalid counts and safely handles a stale selection', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, '3']) {
    assert.equal(moveCommentSelection(5, 2, 1, count), 3)
  }
  assert.equal(moveCommentSelection(5, 99, -1), 3)
  assert.equal(moveCommentSelection(0, 0, 1), -1)
  const model = listModel()
  model.comments.shift()
  model.actions[ApplicationAction.CURSOR_DOWN]()
  assert.equal(model.selected(), 'comment-2')
})

test('page actions use half the viewport with variable comment heights and counts', () => {
  const centers = [40, 140, 400, 500, 900]
  assert.equal(pageCommentSelection(centers, 0, 1, 600), 2)
  assert.equal(pageCommentSelection(centers, 4, -1, 600), 3)
  assert.equal(pageCommentSelection(centers, 0, 1, 600, 2), 4)
  assert.equal(pageCommentSelection(centers, 4, -1, 600, 2), 1)
  assert.equal(pageCommentSelection(centers, 4, 1, 600), 4)
  assert.equal(pageCommentSelection(centers, 0, -1, 600), 0)
  assert.equal(pageCommentSelection([], 0, 1, 600), -1)
  assert.equal(pageCommentSelection(centers, 0, 1, 0), -1)
  const model = listModel()
  model.actions[ApplicationAction.CURSOR_PAGE_DOWN]()
  assert.equal(model.selected(), 'comment-2')
  model.actions[ApplicationAction.CURSOR_PAGE_UP]()
  assert.equal(model.selected(), 'comment-0')
  model.actions[ApplicationAction.CURSOR_PAGE_DOWN](2)
  assert.equal(model.selected(), 'comment-4')
})

test('empty lists leave every cursor action unavailable', () => {
  const model = listModel(0)
  for (const action of Object.values(model.actions)) assert.equal(action(3), false)
  assert.equal(model.selected(), null)
})

test('comment locations preserve file, old-side range, and new-side coordinates', () => {
  assert.equal(commentLocation({ target: { kind: 'review' } }), null)
  assert.equal(commentLocation(null), null)
  assert.deepEqual(commentLocation({ target: { kind: 'file', path: 'README.md' } }), {
    path: 'README.md', lineNumber: 0, side: 'new',
  })
  for (const side of ['old', 'new']) {
    assert.deepEqual(commentLocation({ target: {
      kind: 'line', path: 'src/main.zig', side, startLine: 10, endLine: 15,
    } }), { path: 'src/main.zig', lineNumber: 15, side })
  }
})

test('the configured location action opens only the selected comment through the overlay', () => {
  const comments = [
    { id: 'review', target: { kind: 'review' } },
    { id: 'line', target: { kind: 'line', path: 'a.txt', side: 'old', startLine: 3, endLine: 5 } },
  ]
  for (const keys of [['<Enter>'], ['<C-g>']]) {
    const result = resolveConfiguration({ configuration: { keybindings: { normal: {
      [ApplicationAction.OPEN_COMMENT_LOCATION]: [keys],
    } } } })
    assert.equal(result.diagnostic, null)
    let selectedId = 'review'
    const opened = []
    const adapter = createCommentsListActionAdapter({
      getComments: () => comments,
      getSelectedId: () => selectedId,
      openLocation: (location) => { opened.push(location); return true },
    })
    const dispatch = createApplicationDispatcher({
      getActiveSurface: () => 'file_tree',
      getSurfaceActions: () => ({ [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: () => assert.fail('Reached tree') }),
      getOverlayActions: () => adapter,
    })
    const controller = new VimController({ bindings: result.bindings })
    const open = () => {
      let command
      for (const key of keys) command = controller.dispatch({ type: 'key', key }).command
      return dispatch(command.args.actions)
    }
    assert.equal(open(), false)
    selectedId = 'line'
    assert.equal(open(), true)
    selectedId = 'missing'
    assert.equal(open(), false)
    assert.deepEqual(opened, [{ path: 'a.txt', lineNumber: 5, side: 'old' }])
  }
})

test('selection scrolling reveals clipped comments without moving a visible item', () => {
  const calls = []
  const list = {
    clientTop: 1,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 10 }),
    scrollBy: (options) => calls.push(options),
  }
  const item = (top, bottom) => ({
    getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
  })
  revealSelectedComment(list, item(20, 100))
  assert.deepEqual(calls, [])
  revealSelectedComment(list, item(0, 80))
  revealSelectedComment(list, item(180, 260))
  revealSelectedComment(list, item(100, 400))
  assert.deepEqual(calls, [
    { top: -11, behavior: 'instant' },
    { top: 49, behavior: 'instant' },
    { top: 89, behavior: 'instant' },
  ])
  revealSelectedComment(null, item(0, 100))
  revealSelectedComment(list, null)
})

test('default and custom cursor bindings dispatch only to comments handlers', () => {
  const custom = {
    [ApplicationAction.CURSOR_UP]: [['p']],
    [ApplicationAction.CURSOR_DOWN]: [['n']],
    [ApplicationAction.CURSOR_FIRST]: [['H']],
    [ApplicationAction.CURSOR_LAST]: [['L']],
    [ApplicationAction.CURSOR_PAGE_UP]: [['U']],
    [ApplicationAction.CURSOR_PAGE_DOWN]: [['D']],
  }
  for (const normal of [undefined, custom]) {
    const configuration = resolveConfiguration({ configuration: normal ? { keybindings: { normal } } : {} })
    assert.equal(configuration.diagnostic, null)
    const model = listModel()
    const registry = createOverlayActionRegistry()
    const registration = registry.register(OverlayKind.COMMENTS)
    registration.update(model.actions)
    const dispatch = createApplicationDispatcher({
      getActiveSurface: () => 'diff_pane',
      getOverlayActions: registry.get,
      getSurfaceActions: () => ({ [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Reached diff pane') }),
      globalActions: { [ApplicationAction.OPEN_NEXT_FILE]: () => assert.fail('Opened a workspace file') },
    })
    const controller = new VimController({ bindings: configuration.bindings })
    controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
    const press = (action, count = 1) => {
      if (count > 1) controller.dispatch({ type: 'key', key: String(count) })
      for (const key of (normal ?? defaultNormalKeymap)[action][0]) {
        controller.dispatch({ type: 'key', key })
      }
    }
    press(ApplicationAction.CURSOR_DOWN, 3)
    assert.equal(model.selected(), 'comment-3')
    press(ApplicationAction.CURSOR_UP)
    assert.equal(model.selected(), 'comment-2')
    press(ApplicationAction.CURSOR_FIRST)
    assert.equal(model.selected(), 'comment-0')
    press(ApplicationAction.CURSOR_LAST)
    assert.equal(model.selected(), 'comment-4')
    press(ApplicationAction.CURSOR_PAGE_UP)
    assert.equal(model.selected(), 'comment-2')
    press(ApplicationAction.CURSOR_PAGE_DOWN)
    assert.equal(model.selected(), 'comment-4')
    assert.equal(dispatch(ApplicationAction.OPEN_NEXT_FILE), false)
    model.comments.length = 0
    assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
    registration.unregister()
    assert.equal(registry.get(), null)
  }
})
