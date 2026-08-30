import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApplicationAction,
  defaultApplicationBindings,
} from '../actions/application-actions.js'
import {
  USER_CONFIGURATION_PATH,
  loadKeyboardConfiguration,
  resolveKeyboardConfiguration,
} from './keyboard-configuration.js'
import { VimController } from '../vim/machine.js'

function bindingKeys(bindings, action) {
  return bindings
    .filter((binding) => binding.command === action)
    .map((binding) => binding.keys)
}

test('configured actions replace defaults while missing actions retain them', () => {
  const result = resolveKeyboardConfiguration({
    configuration: {
      keybindings: {
        normal: {
          [ApplicationAction.CURSOR_UP]: [['w']],
          [ApplicationAction.ADD_COMMENT]: [['a']],
        },
      },
    },
    diagnostic: null,
  })

  assert.equal(result.diagnostic, null)
  assert.deepEqual(bindingKeys(result.bindings, ApplicationAction.CURSOR_UP), [['w']])
  assert.deepEqual(
    bindingKeys(result.bindings, ApplicationAction.CURSOR_DOWN),
    [['j'], ['<Down>']],
  )
  assert.deepEqual(bindingKeys(result.bindings, ApplicationAction.ADD_COMMENT), [['a']])
})

test('an empty configured sequence list disables its action', () => {
  const result = resolveKeyboardConfiguration({
    configuration: {
      keybindings: {
        normal: {
          [ApplicationAction.COPY_COMMENTS]: [],
        },
      },
    },
    diagnostic: null,
  })

  assert.equal(result.diagnostic, null)
  assert.deepEqual(bindingKeys(result.bindings, ApplicationAction.COPY_COMMENTS), [])
})

for (const [name, normal, message] of [
  [
    'unknown actions',
    { 'unknown.action': [['x']] },
    'Unknown application action: unknown.action',
  ],
  [
    'non-normalized keys',
    { [ApplicationAction.CURSOR_UP]: [['<Control-k>']] },
    'key "<Control-k>" is not normalized Vim notation',
  ],
  [
    'duplicate keys',
    {
      [ApplicationAction.CURSOR_UP]: [['x']],
      [ApplicationAction.CURSOR_DOWN]: [['x']],
    },
    'Duplicate Vim binding for normal: x',
  ],
  [
    'ambiguous prefixes',
    {
      [ApplicationAction.CURSOR_UP]: [['x']],
      [ApplicationAction.CURSOR_DOWN]: [['x', 'x']],
    },
    'Ambiguous Vim binding prefix in normal',
  ],
]) {
  test(`${name} produce diagnostics without installable bindings`, () => {
    const result = resolveKeyboardConfiguration({
      configuration: { keybindings: { normal } },
      diagnostic: null,
    })

    assert.equal(result.bindings, null)
    assert.equal(result.diagnostic.code, 'invalid_keybindings')
    assert.equal(result.diagnostic.path, USER_CONFIGURATION_PATH)
    assert.match(result.diagnostic.message, new RegExp(message))
  })
}

test('backend diagnostics preserve the built-in keymap', () => {
  const diagnostic = {
    code: 'malformed_json',
    message: 'user configuration contains malformed JSON',
    path: '/Users/example/.config/rvw/config.json',
  }
  const result = resolveKeyboardConfiguration({ configuration: {}, diagnostic })

  assert.equal(result.bindings, null)
  assert.equal(result.diagnostic, diagnostic)
})

test('configuration transport failures produce an actionable fallback diagnostic', async () => {
  const result = await loadKeyboardConfiguration(async () => {
    throw new Error('service unavailable')
  })

  assert.equal(result.bindings, null)
  assert.deepEqual(result.diagnostic, {
    code: 'configuration_unavailable',
    message: 'unable to load user configuration: service unavailable',
    path: USER_CONFIGURATION_PATH,
  })
})

test('Vim binding replacement is atomic when a later map is invalid', () => {
  const controller = new VimController({ bindings: defaultApplicationBindings })
  const valid = resolveKeyboardConfiguration({
    configuration: {
      keybindings: {
        normal: { [ApplicationAction.CURSOR_UP]: [['w']] },
      },
    },
    diagnostic: null,
  })
  controller.setBindings(valid.bindings)

  assert.throws(() => controller.setBindings([
    { mode: 'normal', keys: ['x'], command: ApplicationAction.CURSOR_UP },
    { mode: 'normal', keys: ['x'], command: ApplicationAction.CURSOR_DOWN },
  ]))
  assert.equal(
    controller.dispatch({ type: 'key', key: 'w' }).command.command,
    ApplicationAction.CURSOR_UP,
  )
})
