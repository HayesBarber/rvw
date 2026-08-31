import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApplicationAction,
  applicationActionCatalog,
  defaultNormalKeymap,
} from './application-actions.js'
import { createKeymapReference } from './keymap-reference.js'

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
  assert.deepEqual(
    byId[ApplicationAction.FOCUS_FILE_TREE].sequences,
    [['<Space>', 'o']],
  )
  assert.equal(
    byId[ApplicationAction.CURSOR_UP].description,
    applicationActionCatalog[ApplicationAction.CURSOR_UP].description,
  )
})
