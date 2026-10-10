import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ActionScope,
  ApplicationAction,
  applicationActionCatalog,
  compileApplicationKeymap,
} from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { resolveCommand } from './command-line.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'

const open = ApplicationAction.OPEN_COMMENTS
const location = ApplicationAction.OPEN_COMMENT_LOCATION
const activate = ApplicationAction.FILE_TREE_ITEM_ACTIVATE

function keyActions(bindings, keys) {
  const controller = new VimController({ bindings })
  let command
  for (const key of keys) {
    command = controller.dispatch({ type: 'key', key }).command
  }
  return command?.args.actions
}

test('comments actions have distinct identifiers, scopes, and default bindings', () => {
  const result = resolveConfiguration({ configuration: {} })
  assert.equal(result.diagnostic, null)
  assert.equal(open, 'comments.open')
  assert.equal(location, 'comments.location.open')
  assert.equal(Object.hasOwn(applicationActionCatalog[open], 'scope'), false)
  assert.equal(applicationActionCatalog[location].scope, ActionScope.COMMENTS_LIST)
  assert.deepEqual(keyActions(result.bindings, ['<Space>', 'c']), [open])
  assert.deepEqual(keyActions(result.bindings, ['<Enter>']), [activate, location])
})

test('custom comments bindings replace defaults and resolve command aliases', () => {
  const aliases = { feedback: open, jump: location }
  const result = resolveConfiguration({ configuration: {
    keybindings: { leader: ',', normal: {
      [open]: [['<leader>', 'm']],
      [location]: [['<C-g>']],
    } },
    commandLine: { aliases },
  } })
  assert.equal(result.diagnostic, null)
  assert.deepEqual(keyActions(result.bindings, [',', 'm']), [open])
  assert.deepEqual(keyActions(result.bindings, ['<C-g>']), [location])
  assert.equal(keyActions(result.bindings, [',', 'c']), undefined)
  assert.deepEqual(keyActions(result.bindings, ['<Enter>']), [activate])
  assert.deepEqual(resolveCommand('feedback', result.commandAliases), { kind: 'action', action: open })
  assert.deepEqual(resolveCommand('jump', result.commandAliases), { kind: 'action', action: location })
})

test('disabling comments bindings keeps action names available to commands', () => {
  const result = resolveConfiguration({ configuration: { keybindings: { normal: {
    [open]: [], [location]: [],
  } } } })
  assert.equal(result.diagnostic, null)
  assert.equal(keyActions(result.bindings, ['<Space>', 'c']), undefined)
  assert.deepEqual(keyActions(result.bindings, ['<Enter>']), [activate])
  assert.deepEqual(resolveCommand(open), { kind: 'action', action: open })
  assert.deepEqual(resolveCommand(location), { kind: 'action', action: location })
})

test('shared Enter dispatches only to the active workspace or overlay handler', () => {
  const result = resolveConfiguration({ configuration: {} })
  const actions = keyActions(result.bindings, ['<Enter>'])
  let overlay = null
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => 'file_tree',
    getSurfaceActions: () => ({ [activate]: () => { calls.push('tree'); return true } }),
    getOverlayActions: () => overlay,
  })

  assert.equal(dispatch(actions), true)
  overlay = { [location]: () => { calls.push('location'); return true } }
  assert.equal(dispatch(actions), true)
  overlay = { [location]: () => false }
  assert.equal(dispatch(actions), false)
  assert.deepEqual(calls, ['tree', 'location'])
})

test('comments location can share a scoped key but rejects an unrestricted conflict', () => {
  assert.doesNotThrow(() => compileApplicationKeymap({
    [location]: [['x']],
    [ApplicationAction.ADD_FILE_COMMENT]: [['x']],
    [ApplicationAction.TREE_EXPAND]: [['x']],
  }))
  assert.throws(() => compileApplicationKeymap({
    [location]: [['x']],
    [open]: [['x']],
  }), /Duplicate Vim binding/)
})
