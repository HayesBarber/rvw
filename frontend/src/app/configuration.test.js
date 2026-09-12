import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApplicationAction,
  defaultApplicationBindings,
} from '../actions/application-actions.js'
import {
  DEFAULT_WRAP_LINES,
  USER_CONFIGURATION_PATH,
  loadConfiguration,
  resolveConfiguration,
} from './configuration.js'
import { VimController } from '../vim/machine.js'

function bindingKeys(bindings, action) {
  return bindings
    .filter((binding) => binding.args.actions.includes(action))
    .map((binding) => binding.keys)
}

test('configured actions replace defaults while missing actions retain them', () => {
  const result = resolveConfiguration({
    configuration: {
      keybindings: {
        normal: {
          [ApplicationAction.CURSOR_UP]: [['w']],
          [ApplicationAction.ADD_COMMENT]: [['a']],
          [ApplicationAction.ADD_FILE_COMMENT]: [['x', 'c']],
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
  assert.deepEqual(
    bindingKeys(result.bindings, ApplicationAction.ADD_FILE_COMMENT),
    [['x', 'c']],
  )
})

test('an empty configured sequence list disables its action', () => {
  const result = resolveConfiguration({
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
  assert.deepEqual(result.keymap[ApplicationAction.COPY_COMMENTS], [])
})

test('a configured leader expands <leader> placeholders without mutating the keymap', () => {
  const result = resolveConfiguration({
    configuration: {
      keybindings: { leader: '\\' },
    },
    diagnostic: null,
  })

  assert.equal(result.diagnostic, null)
  assert.equal(result.leader, '\\')
  assert.deepEqual(
    bindingKeys(result.bindings, ApplicationAction.FOCUS_FILE_TREE),
    [['\\', 'o']],
  )
  assert.deepEqual(result.keymap[ApplicationAction.FOCUS_FILE_TREE], [['<leader>', 'o']])
})

test('an absent leader resolves to the default <Space>', () => {
  const result = resolveConfiguration({
    configuration: {
      keybindings: {
        normal: { [ApplicationAction.CURSOR_UP]: [['w']] },
      },
    },
    diagnostic: null,
  })

  assert.equal(result.diagnostic, null)
  assert.equal(result.leader, '<Space>')
  assert.deepEqual(
    bindingKeys(result.bindings, ApplicationAction.FOCUS_FILE_TREE),
    [['<Space>', 'o']],
  )
})

test('wrapLines defaults to wrapping when the diff section is omitted', () => {
  const result = resolveConfiguration({
    configuration: {
      keybindings: { leader: '<Space>' },
    },
    diagnostic: null,
  })

  assert.equal(result.diagnostic, null)
  assert.equal(result.wrapLines, DEFAULT_WRAP_LINES)
  assert.equal(result.wrapLines, true)
})

test('configured diff.wrapLines controls the startup default', () => {
  const disabled = resolveConfiguration({
    configuration: { diff: { wrapLines: false } },
    diagnostic: null,
  })

  assert.equal(disabled.diagnostic, null)
  assert.equal(disabled.wrapLines, false)

  const enabled = resolveConfiguration({
    configuration: { diff: { wrapLines: true } },
    diagnostic: null,
  })

  assert.equal(enabled.diagnostic, null)
  assert.equal(enabled.wrapLines, true)
})

test('an invalid diff schema produces a diagnostic without installable bindings', () => {
  for (const [configuration, message] of [
    [{ diff: [] }, 'diff must be a JSON object'],
    [{ diff: { wrap: true } }, 'diff contains an unsupported field'],
    [{ diff: { wrapLines: 'yes' } }, 'diff.wrapLines must be a boolean'],
  ]) {
    const result = resolveConfiguration({ configuration, diagnostic: null })

    assert.equal(result.bindings, null)
    assert.equal(result.diagnostic.code, 'invalid_configuration')
    assert.equal(result.diagnostic.path, USER_CONFIGURATION_PATH)
    assert.match(result.diagnostic.message, new RegExp(message))
  }
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
    const result = resolveConfiguration({
      configuration: { keybindings: { normal } },
      diagnostic: null,
    })

    assert.equal(result.bindings, null)
    assert.equal(result.diagnostic.code, 'invalid_configuration')
    assert.equal(result.diagnostic.path, USER_CONFIGURATION_PATH)
    assert.match(result.diagnostic.message, new RegExp(message))
  })
}

test('an invalid leader produces a diagnostic without installable bindings', () => {
  const result = resolveConfiguration({
    configuration: { keybindings: { leader: '' } },
    diagnostic: null,
  })

  assert.equal(result.bindings, null)
  assert.equal(result.diagnostic.code, 'invalid_configuration')
  assert.equal(result.diagnostic.path, USER_CONFIGURATION_PATH)
  assert.match(result.diagnostic.message, /leader/)
})

test('backend diagnostics preserve the built-in keymap', () => {
  const diagnostic = {
    code: 'malformed_json',
    message: 'user configuration contains malformed JSON',
    path: '/Users/example/.config/rvw/config.json',
  }
  const result = resolveConfiguration({ configuration: {}, diagnostic })

  assert.equal(result.bindings, null)
  assert.equal(result.diagnostic, diagnostic)
})

test('configuration transport failures produce an actionable fallback diagnostic', async () => {
  const result = await loadConfiguration(async () => {
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
  const valid = resolveConfiguration({
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
    controller.dispatch({ type: 'key', key: 'w' }).command.args.actions[0],
    ApplicationAction.CURSOR_UP,
  )
})
