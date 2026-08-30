import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ActionScope,
  ApplicationAction,
  DEFAULT_LEADER_KEY,
  LEADER_KEY,
  applicationActionCatalog,
  compileApplicationKeymap,
  defaultApplicationBindings,
  defaultNormalKeymap,
} from './application-actions.js'
import { VimController, VimMode } from './vim/machine.js'

test('the action catalog is frozen, enumerable, and documented', () => {
  const actionIds = Object.values(ApplicationAction)

  assert.deepEqual(Object.keys(applicationActionCatalog), actionIds)
  assert(Object.isFrozen(ApplicationAction))
  assert(Object.isFrozen(applicationActionCatalog))

  for (const action of actionIds) {
    const definition = applicationActionCatalog[action]
    assert(Object.isFrozen(definition))
    assert.equal(definition.id, action)
    assert(Object.values(ActionScope).includes(definition.scope))
    assert.match(definition.description, /\S/)
  }
})

test('every default binding references a known action and compiles for Normal mode', () => {
  assert.deepEqual(
    Object.keys(defaultNormalKeymap),
    Object.values(ApplicationAction),
  )
  assert(Object.isFrozen(defaultNormalKeymap))
  assert(Object.isFrozen(defaultApplicationBindings))

  for (const binding of defaultApplicationBindings) {
    assert.equal(binding.mode, VimMode.NORMAL)
    assert(Object.hasOwn(applicationActionCatalog, binding.command))
    assert(Object.isFrozen(binding))
    assert(Object.isFrozen(binding.keys))
  }

  assert.doesNotThrow(() => new VimController({
    bindings: defaultApplicationBindings,
  }))
})

test('the default keymap includes navigation, pane, mode, and global bindings', () => {
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.CURSOR_UP], [['k'], ['<Up>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.CURSOR_DOWN], [['j'], ['<Down>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.CURSOR_FIRST], [['g', 'g']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.CURSOR_LAST], [['G']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.CURSOR_CENTER], [['z', 'z']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.FILE_TREE_ITEM_ACTIVATE], [['<Enter>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.TREE_COLLAPSE_OR_PARENT], [['h'], ['<Left>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.TREE_EXPAND], [['l'], ['<Right>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.TREE_SIZE_INCREASE], [['<C-w>', '>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.TREE_SIZE_DECREASE], [['<C-w>', '<']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.FOCUS_FILE_TREE], [['g', 't']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.FOCUS_DIFF_PANE], [['g', 'd']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.SHOW_CHANGES], [['g', 'c']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.SHOW_FILES], [['g', 'f']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.OPEN_FILE_FINDER], [['<C-p>'], ['<D-p>']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.COPY_COMMENTS], [['y']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.EDIT_COMMENT], [['e']])
  assert.deepEqual(defaultNormalKeymap[ApplicationAction.DELETE_COMMENT], [['d', 'c']])
})

test('leader placeholders compile to a concrete key without mutating the keymap', () => {
  const keymap = {
    [ApplicationAction.COPY_COMMENTS]: [[LEADER_KEY, 'y']],
  }

  assert.equal(DEFAULT_LEADER_KEY, '<Space>')
  assert.deepEqual(compileApplicationKeymap(keymap), [{
    mode: VimMode.NORMAL,
    keys: ['<Space>', 'y'],
    command: ApplicationAction.COPY_COMMENTS,
  }])
  assert.deepEqual(compileApplicationKeymap(keymap, { leader: '\\' }), [{
    mode: VimMode.NORMAL,
    keys: ['\\', 'y'],
    command: ApplicationAction.COPY_COMMENTS,
  }])
  assert.deepEqual(keymap, {
    [ApplicationAction.COPY_COMMENTS]: [[LEADER_KEY, 'y']],
  })
})

test('compiled bindings preserve counts and multi-key sequences', () => {
  const controller = new VimController({ bindings: defaultApplicationBindings })

  assert.equal(controller.dispatch({ type: 'key', key: '2' }).command, null)
  assert.equal(controller.dispatch({ type: 'key', key: '0' }).command, null)
  assert.deepEqual(controller.dispatch({ type: 'key', key: 'j' }).command, {
    type: 'command',
    command: ApplicationAction.CURSOR_DOWN,
    args: undefined,
    count: 20,
    keys: ['j'],
    mode: VimMode.NORMAL,
  })

  assert.equal(controller.dispatch({ type: 'key', key: 'g' }).command, null)
  assert.deepEqual(controller.dispatch({ type: 'key', key: 'g' }).command, {
    type: 'command',
    command: ApplicationAction.CURSOR_FIRST,
    args: undefined,
    count: 1,
    keys: ['g', 'g'],
    mode: VimMode.NORMAL,
  })
})

test('unknown actions produce a deterministic error', () => {
  assert.throws(
    () => compileApplicationKeymap({ 'unknown.action': [['x']] }),
    { name: 'TypeError', message: 'Unknown application action: unknown.action' },
  )
})

test('duplicate bindings produce a deterministic error', () => {
  assert.throws(
    () => compileApplicationKeymap({
      [ApplicationAction.CURSOR_UP]: [['x']],
      [ApplicationAction.CURSOR_DOWN]: [['x']],
    }),
    { name: 'TypeError', message: 'Duplicate Vim binding for normal: x' },
  )
})

test('ambiguous binding prefixes produce a deterministic error', () => {
  assert.throws(
    () => compileApplicationKeymap({
      [ApplicationAction.CURSOR_UP]: [['g']],
      [ApplicationAction.CURSOR_DOWN]: [['g', 'g']],
    }),
    { name: 'TypeError', message: 'Ambiguous Vim binding prefix in normal' },
  )
})
