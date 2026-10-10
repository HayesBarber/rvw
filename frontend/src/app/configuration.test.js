import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApplicationAction,
  defaultApplicationBindings,
} from '../actions/application-actions.js'
import {
  DEFAULT_RELATIVE_LINE_NUMBERS,
  DEFAULT_COMMENT_TYPE,
  DEFAULT_COMMENT_TYPES,
  DEFAULT_WRAP_LINES,
  USER_CONFIGURATION_PATH,
  loadConfiguration,
  resolveConfiguration,
} from './configuration.js'
import { VimController } from '../vim/machine.js'

function bindingKeys(bindings, action) {
  return bindings
    .filter((binding) => binding.mode === 'normal' && binding.args.actions.includes(action))
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
  assert.equal(result.relativeLineNumbers, DEFAULT_RELATIVE_LINE_NUMBERS)
  assert.equal(result.relativeLineNumbers, false)
  assert.deepEqual(result.commentTypes, DEFAULT_COMMENT_TYPES)
  assert.equal(result.defaultCommentType, DEFAULT_COMMENT_TYPE)
  assert.equal(result.showReviewSource, true)
})

test('configured comment types replace built-ins and preserve order and default', () => {
  const result = resolveConfiguration({
    configuration: {
      comments: { types: ['BUG', 'IDEA'], defaultType: 'IDEA' },
    },
    diagnostic: null,
  })
  assert.equal(result.diagnostic, null)
  assert.deepEqual(result.commentTypes, ['BUG', 'IDEA'])
  assert.equal(result.defaultCommentType, 'IDEA')

  const disabled = resolveConfiguration({
    configuration: { comments: { types: [] } },
    diagnostic: null,
  })
  assert.deepEqual(disabled.commentTypes, [])
  assert.equal(disabled.defaultCommentType, null)
})

test('comment export text accepts empty and multiline strings', () => {
  for (const comments of [
    { intro: '', outro: '' },
    { intro: 'Review first\nThen fix' },
    { outro: 'Summarize\nThe changes' },
    { intro: 'Start', outro: 'Finish' },
  ]) {
    const result = resolveConfiguration({ configuration: { comments }, diagnostic: null })
    assert.equal(result.diagnostic, null)
  }
})

test('review source header defaults on and accepts both boolean values', () => {
  for (const value of [true, false]) {
    const result = resolveConfiguration({ configuration: { comments: { showReviewSource: value } }, diagnostic: null })
    assert.equal(result.diagnostic, null)
    assert.equal(result.showReviewSource, value)
  }
})

test('invalid comment type settings produce configuration diagnostics', () => {
  for (const configuration of [
    { comments: [] },
    { comments: { types: 'ISSUE' } },
    { comments: { types: [''] } },
    { comments: { types: ['BUG', 'BUG'] } },
    { comments: { types: ['BUG'], defaultType: 'IDEA' } },
    { comments: { intro: null } },
    { comments: { intro: [] } },
    { comments: { outro: 42 } },
    { comments: { outro: false } },
    { comments: { showReviewSource: null } },
  ]) {
    const result = resolveConfiguration({ configuration, diagnostic: null })
    assert.equal(result.bindings, null)
    assert.equal(result.diagnostic.code, 'invalid_configuration')
  }
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

test('configured diff.relativeLineNumbers controls the startup default', () => {
  const enabled = resolveConfiguration({
    configuration: { diff: { relativeLineNumbers: true } },
    diagnostic: null,
  })
  assert.equal(enabled.diagnostic, null)
  assert.equal(enabled.relativeLineNumbers, true)
  assert.equal(enabled.wrapLines, DEFAULT_WRAP_LINES)

  const disabled = resolveConfiguration({
    configuration: { diff: { relativeLineNumbers: false } },
    diagnostic: null,
  })
  assert.equal(disabled.relativeLineNumbers, false)
})

test('an invalid diff schema produces a diagnostic without installable bindings', () => {
  for (const [configuration, message] of [
    [{ diff: [] }, 'diff must be a JSON object'],
    [{ diff: { wrap: true } }, 'diff contains an unsupported field'],
    [{ diff: { wrapLines: 'yes' } }, 'diff.wrapLines must be a boolean'],
    [{ diff: { relativeLineNumbers: 'yes' } }, 'diff.relativeLineNumbers must be a boolean'],
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

test('visual entry is configurable and visual movement uses the configured keys', () => {
  const result = resolveConfiguration({ configuration: { keybindings: { normal: {
    [ApplicationAction.VISUAL_LINE]: [['s']],
    [ApplicationAction.CURSOR_DOWN]: [['n']],
  } } }, diagnostic: null })
  assert.equal(result.diagnostic, null)
  assert.deepEqual(bindingKeys(result.bindings, ApplicationAction.VISUAL_LINE), [['s']])
  const controller = new VimController({ bindings: result.bindings })
  assert.deepEqual(controller.dispatch({ type: 'key', key: 's' }).command.args.actions, [ApplicationAction.VISUAL_LINE])
  controller.dispatch({ type: 'set_mode', mode: 'visual' })
  assert.equal(controller.dispatch({ type: 'key', key: 'j' }).command, null)
  assert.deepEqual(controller.dispatch({ type: 'key', key: 'n' }).command.args.actions, [ApplicationAction.CURSOR_DOWN])
})

const visualMotions = [
  ApplicationAction.CURSOR_UP,
  ApplicationAction.CURSOR_DOWN,
  ApplicationAction.CURSOR_PAGE_UP,
  ApplicationAction.CURSOR_PAGE_DOWN,
  ApplicationAction.CURSOR_FIRST,
  ApplicationAction.CURSOR_LAST,
]

for (const configured of [false, true]) {
  test(`motion bindings match in Normal and Visual modes with ${configured ? 'custom' : 'default'} keys`, () => {
    const normal = {
      [ApplicationAction.CURSOR_UP]: [['<leader>', 'u']],
      [ApplicationAction.CURSOR_DOWN]: [['n']],
      [ApplicationAction.CURSOR_PAGE_UP]: [['<PageUp>']],
      [ApplicationAction.CURSOR_PAGE_DOWN]: [['<PageDown>']],
      [ApplicationAction.CURSOR_FIRST]: [['a', 'a']],
      [ApplicationAction.CURSOR_LAST]: [['<leader>', 'l']],
    }
    const result = resolveConfiguration({ configuration: configured
      ? { keybindings: { leader: '\\', normal } } : {} })
    assert.equal(result.diagnostic, null)
    for (const action of visualMotions) {
      const normalKeys = bindingKeys(result.bindings, action)
      const visualKeys = result.bindings
        .filter((binding) => binding.mode === 'visual' && binding.args.actions.includes(action))
        .map((binding) => binding.keys)
      assert.deepEqual(visualKeys, normalKeys)
      for (const mode of ['normal', 'visual']) {
        for (const keys of normalKeys) {
          const controller = new VimController({ bindings: result.bindings, initialMode: mode })
          controller.dispatch({ type: 'key', key: '2' })
          controller.dispatch({ type: 'key', key: '0' })
          for (const key of keys.slice(0, -1)) {
            assert.equal(controller.dispatch({ type: 'key', key }).command, null)
          }
          const command = controller.dispatch({ type: 'key', key: keys.at(-1) }).command
          assert.deepEqual(command.args.actions, [action])
          assert.equal(command.count, 20)
          assert.equal(command.mode, mode)
          assert.deepEqual(controller.getSnapshot(), { mode, count: '', pendingKeys: [] })
        }
      }
    }
    if (configured) {
      const controller = new VimController({ bindings: result.bindings, initialMode: 'visual' })
      for (const key of ['j', '<Down>', 'k', '<Up>', '<C-u>', '<C-d>', 'g', 'G']) {
        assert.equal(controller.dispatch({ type: 'key', key }).handled, false)
      }
    }
  })
}

test('disabled motions have no fallback in Visual mode and selection controls use configured keys', () => {
  const result = resolveConfiguration({ configuration: { keybindings: { normal: {
    ...Object.fromEntries(visualMotions.map((action) => [action, []])),
    [ApplicationAction.ADD_COMMENT]: [['a']],
    [ApplicationAction.VISUAL_LINE]: [['v']],
  } } } })
  assert.equal(result.diagnostic, null)
  const controller = new VimController({ bindings: result.bindings, initialMode: 'visual' })
  for (const key of ['j', '<Down>', 'k', '<Up>', '<C-u>', '<C-d>', '<PageUp>', '<PageDown>', 'g', 'G', 'c', 'V']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, false)
  }
  for (const [key, action] of [['a', ApplicationAction.ADD_COMMENT], ['v', ApplicationAction.VISUAL_LINE]]) {
    assert.deepEqual(controller.dispatch({ type: 'key', key }).command.args.actions, [action])
  }
  controller.dispatch({ type: 'key', key: '<Esc>' })
  assert.equal(controller.getSnapshot().mode, 'normal')
})

test('motion keys can use former Visual controls when those bindings are disabled', () => {
  for (const keys of [['c'], ['V'], ['c', 'n'], ['V', 'n']]) {
    const result = resolveConfiguration({ configuration: { keybindings: { normal: {
      [ApplicationAction.CURSOR_DOWN]: [keys],
      [ApplicationAction.ADD_COMMENT]: [],
      [ApplicationAction.SHOW_CHANGES]: [],
      [ApplicationAction.ADD_REVIEW_COMMENT]: [],
      [ApplicationAction.VISUAL_LINE]: [],
    } } } })
    assert.equal(result.diagnostic, null)
    const controller = new VimController({ bindings: result.bindings, initialMode: 'visual' })
    for (const key of keys.slice(0, -1)) controller.dispatch({ type: 'key', key })
    assert.deepEqual(controller.dispatch({ type: 'key', key: keys.at(-1) }).command.args.actions,
      [ApplicationAction.CURSOR_DOWN])
  }
})

test('Visual comment and selection controls support leader sequences and disabled bindings', () => {
  const controls = [ApplicationAction.ADD_COMMENT, ApplicationAction.VISUAL_LINE]
  const result = resolveConfiguration({ configuration: { keybindings: { leader: '\\', normal: {
    [ApplicationAction.ADD_COMMENT]: [['<leader>', 'a']],
    [ApplicationAction.VISUAL_LINE]: [['v', 'v']],
  } } } })
  assert.equal(result.diagnostic, null)
  for (const action of controls) {
    for (const mode of ['normal', 'visual']) {
      const controller = new VimController({ bindings: result.bindings, initialMode: mode })
      const keys = bindingKeys(result.bindings, action)[0]
      for (const key of keys.slice(0, -1)) {
        assert.equal(controller.dispatch({ type: 'key', key }).command, null)
      }
      assert.deepEqual(controller.dispatch({ type: 'key', key: keys.at(-1) }).command.args.actions, [action])
    }
  }
  const disabled = resolveConfiguration({ configuration: { keybindings: { normal: {
    [ApplicationAction.ADD_COMMENT]: [],
    [ApplicationAction.VISUAL_LINE]: [],
  } } } })
  assert.equal(disabled.diagnostic, null)
  const controller = new VimController({ bindings: disabled.bindings, initialMode: 'visual' })
  for (const key of ['c', 'V']) {
    assert.equal(controller.dispatch({ type: 'key', key }).handled, false)
  }
  controller.dispatch({ type: 'key', key: '<Esc>' })
  assert.equal(controller.getSnapshot().mode, 'normal')
})
