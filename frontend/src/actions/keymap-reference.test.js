import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApplicationAction,
  applicationActionCatalog,
  defaultNormalKeymap,
} from './application-actions.js'
import {
  KEYMAP_REFERENCE_SCROLL_STEP,
  createKeymapReference,
  createKeymapReferenceActionAdapter,
  filterKeymapReference,
} from './keymap-reference.js'
import { resolveConfiguration } from '../app/configuration.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { VimController } from '../vim/machine.js'
import { attachVimKeyboardCapture } from '../vim/keyboard.js'

function referenceController(normal = {}, leader) {
  const configuration = resolveConfiguration({ configuration: { keybindings: { normal, ...(leader ? { leader } : {}) } } })
  assert.equal(configuration.diagnostic, null)
  const scrolls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => assert.fail('Reference must block the workspace'),
    getSurfaceActions: () => assert.fail('Reference must block the workspace'),
    getOverlayActions: () => createKeymapReferenceActionAdapter({ scrollBy: (options) => scrolls.push(options.top) }),
    globalActions: { [ApplicationAction.CLOSE_APPLICATION]: () => assert.fail('Reference must block global actions') },
  })
  const controller = new VimController({ bindings: configuration.bindings })
  controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
  return { controller, scrolls, configuration }
}

test('the keymap reference groups catalog descriptions and effective bindings', () => {
  const keymap = {
    ...defaultNormalKeymap,
    [ApplicationAction.CURSOR_UP]: [['w']],
    [ApplicationAction.COPY_COMMENTS]: [],
  }
  const groups = createKeymapReference(keymap)
  const actions = groups.flatMap((group) => group.actions)
  const byId = Object.fromEntries(actions.map((action) => [action.id, action]))

  assert.deepEqual(
    actions.map((action) => action.id).sort(),
    Object.keys(applicationActionCatalog).sort(),
  )
  assert.deepEqual(byId[ApplicationAction.CURSOR_UP].sequences, [['w']])
  assert.deepEqual(byId[ApplicationAction.COPY_COMMENTS].sequences, [])
  assert(actions.every((action) => action.aliases.length === 0))
  assert.deepEqual(
    byId[ApplicationAction.FOCUS_FILE_TREE].sequences,
    [['<Space>', 'o']],
  )
  assert.equal(
    byId[ApplicationAction.CURSOR_UP].description,
    applicationActionCatalog[ApplicationAction.CURSOR_UP].description,
  )

  const configured = createKeymapReference(keymap, '\\')
  const configuredActions = Object.fromEntries(
    configured.flatMap((group) => group.actions).map((action) => [action.id, action]),
  )
  assert.deepEqual(
    configuredActions[ApplicationAction.FOCUS_FILE_TREE].sequences,
    [['\\', 'o']],
  )
})

test('the keymap reference sorts aliases by name and maps them to their target actions', () => {
  const keymap = { ...defaultNormalKeymap, [ApplicationAction.COPY_COMMENTS]: [] }
  const aliases = {
    yank: ApplicationAction.COPY_COMMENTS,
    up: ApplicationAction.CURSOR_UP,
    copy: ApplicationAction.COPY_COMMENTS,
  }
  const actions = createKeymapReference(keymap, undefined, aliases)
    .flatMap((group) => group.actions)
  const byId = Object.fromEntries(actions.map((action) => [action.id, action]))

  assert.deepEqual(byId[ApplicationAction.COPY_COMMENTS].aliases, ['copy', 'yank'])
  assert.deepEqual(byId[ApplicationAction.COPY_COMMENTS].sequences, [])
  assert.deepEqual(byId[ApplicationAction.CURSOR_UP].aliases, ['up'])
  assert(actions.filter((action) => ![
    ApplicationAction.COPY_COMMENTS, ApplicationAction.CURSOR_UP,
  ].includes(action.id)).every((action) => action.aliases.length === 0))
  assert(Object.isFrozen(byId[ApplicationAction.COPY_COMMENTS].aliases))
  assert.deepEqual(Object.keys(aliases), ['yank', 'up', 'copy'])
})

test('default reference motions scroll with Vim counts and arrow keys', () => {
  const { controller, scrolls } = referenceController()
  for (const key of ['j', 'k', '<Down>', '<Up>', '3', 'j']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, true)
  }
  assert.deepEqual(scrolls, [56, -56, 56, -56, 3 * KEYMAP_REFERENCE_SCROLL_STEP])
  assert.equal(controller.dispatch({ type: 'key', key: 'q' }).handled, false)
})

test('custom reference motions replace defaults and support counts and multi-key sequences', () => {
  const { controller, scrolls } = referenceController({
    [ApplicationAction.CURSOR_DOWN]: [['n'], ['<leader>', 'd']],
    [ApplicationAction.CURSOR_UP]: [['z', 'u']],
  }, ',')
  for (const key of ['j', 'k', '<Down>', '<Up>']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, false)
  }
  assert.deepEqual(scrolls, [])
  for (const key of ['n', '3', ',', 'd', '2', 'z', 'u']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, true)
  }
  assert.deepEqual(scrolls, [56, 168, -112])
})

test('disabled reference motions do not scroll', () => {
  const { controller, scrolls } = referenceController({
    [ApplicationAction.CURSOR_DOWN]: [],
    [ApplicationAction.CURSOR_UP]: [],
  })
  for (const key of ['j', 'k', '<Down>', '<Up>']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, false)
  }
  assert.deepEqual(scrolls, [])
})

test('reference capture leaves search input and header controls native', () => {
  const { controller, scrolls } = referenceController({ [ApplicationAction.CURSOR_DOWN]: [['n']] })
  let listener
  const document = {
    addEventListener: (_type, callback) => { listener = callback },
    removeEventListener: () => {},
  }
  const dispose = attachVimKeyboardCapture({ target: document, dispatch: controller.dispatch })
  const dialog = { tagName: 'DIALOG', hasAttribute: (name) => name === 'data-vim-capture' }
  const controls = { tagName: 'DIV', hasAttribute: (name) => name === 'data-vim-ignore', parentElement: dialog }
  const input = { tagName: 'INPUT', parentElement: dialog }
  const button = { tagName: 'BUTTON', parentElement: controls }
  for (const [target, key] of [[input, 'n'], [input, 'j'], [input, '/'], [button, 'Enter'], [button, ' ']]) {
    listener({
      target, key, defaultPrevented: false, isComposing: false, repeat: false,
      preventDefault: () => assert.fail('Search and controls must remain native'),
      stopPropagation: () => assert.fail('Search and controls must remain native'),
    })
  }
  assert.deepEqual(scrolls, [])
  let prevented = false
  listener({
    target: dialog, key: 'n', defaultPrevented: false, isComposing: false, repeat: false,
    preventDefault: () => { prevented = true }, stopPropagation: () => {},
  })
  assert.equal(prevented, true)
  assert.deepEqual(scrolls, [56])
  dispose()
})

test('search matches descriptions, IDs, aliases, and displayed bindings without changing order', () => {
  const groups = createKeymapReference({
    ...defaultNormalKeymap,
    [ApplicationAction.COPY_COMMENTS]: [],
  }, undefined, {
    yank: ApplicationAction.COPY_COMMENTS,
    duplicate: ApplicationAction.COPY_COMMENTS,
  })
  for (const [query, expected] of [
    ['active cursor UP.', [ApplicationAction.CURSOR_UP]],
    [ApplicationAction.CURSOR_UP.toUpperCase(), [ApplicationAction.CURSOR_UP]],
    ['YaNk', [ApplicationAction.COPY_COMMENTS]],
    ['DuPlicate', [ApplicationAction.COPY_COMMENTS]],
    ['<sPaCe> o', [ApplicationAction.FOCUS_FILE_TREE, ApplicationAction.FOCUS_DIFF_PANE]],
  ]) {
    const result = filterKeymapReference(groups, query)
    assert.deepEqual(result.flatMap((group) => group.actions.map((action) => action.id)), expected)
    assert(result.every((group) => group.actions.length > 0))
    assert.deepEqual(result.map((group) => group.id),
      groups.filter((group) => group.actions.some((action) => expected.includes(action.id)))
        .map((group) => group.id))
  }
  const unbound = filterKeymapReference(groups, 'yank').flatMap((group) => group.actions)
  assert.equal(unbound[0].id, ApplicationAction.COPY_COMMENTS)
  assert.deepEqual(unbound[0].sequences, [])
  assert.deepEqual(unbound[0].aliases, ['duplicate', 'yank'])
  assert.equal(filterKeymapReference(groups, ''), groups)
  assert.deepEqual(filterKeymapReference(groups, 'no-such-action'), [])
  assert.deepEqual(filterKeymapReference(groups, ' '), groups)
})
