import assert from 'node:assert/strict'
import test from 'node:test'
import { ActionScope, ApplicationAction, defaultNormalKeymap } from './application-actions.js'
import { commandPaletteActions } from './command-palette.js'
import { createKeymapReference } from './keymap-reference.js'

test('switch side is discoverable in the diff commands and keyboard help', () => {
  assert.deepEqual(commandPaletteActions(ActionScope.DIFF_PANE, 'switch diff side')
    .map((action) => action.id), [ApplicationAction.DIFF_SWITCH_SIDE])
  assert.deepEqual(commandPaletteActions(ActionScope.FILE_TREE, 'switch diff side'), [])
  const reference = createKeymapReference(defaultNormalKeymap).flatMap((group) => group.actions)
  assert.deepEqual(reference.find((action) => action.id === ApplicationAction.DIFF_SWITCH_SIDE)
    .sequences, [['<Space>', 's']])
  assert.deepEqual(commandPaletteActions(ActionScope.DIFF_PANE, 'missing command'), [])
})
