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
  keymapReferenceScrollDelta,
} from './keymap-reference.js'

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

test('plain j and k map to one reference scroll step', () => {
  assert.equal(keymapReferenceScrollDelta('j'), KEYMAP_REFERENCE_SCROLL_STEP)
  assert.equal(keymapReferenceScrollDelta('k'), -KEYMAP_REFERENCE_SCROLL_STEP)
  assert.equal(keymapReferenceScrollDelta('J'), null)
  assert.equal(keymapReferenceScrollDelta('<Down>'), null)
})
