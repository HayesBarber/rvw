import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommandLine, handleCommandLineKey, resolveCommand } from './command-line.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { defaultApplicationBindings, APPLICATION_DISPATCH_COMMAND } from './application-actions.js'
import { VimController } from '../vim/machine.js'
import { shouldCaptureKeyboardEvent } from '../vim/keyboard.js'
import { resolveConfiguration } from '../app/configuration.js'

function fixture() {
  const vim = new VimController({ bindings: defaultApplicationBindings })
  let state
  let focus = 'workspace'
  const controller = createCommandLine({
    getFocus: () => ({ isConnected: true, focus: () => { focus = 'workspace' } }),
    setMode: (mode) => vim.dispatch({ type: 'set_mode', mode }),
    onChange: (next) => { state = next },
  })
  return { controller, vim, state: () => state, focus: () => focus,
    focusInput: () => { focus = 'input' } }
}

test('resolution trims and accepts only exact canonical names or direct aliases', () => {
  assert.deepEqual(resolveCommand('  comments.clear \n'), { kind: 'action', action: 'comments.clear' })
  assert.deepEqual(resolveCommand('clear', { clear: 'comments.clear' }), resolveCommand('comments.clear'))
  assert.deepEqual(resolveCommand('  '), { kind: 'empty' })
  for (const name of ['comments.clear now', 'Comments.clear', 'comments.clear|review.reload', ':comments.clear', 'constructor', 'toString']) {
    assert.equal(resolveCommand(name).kind, 'unknown')
  }
  assert.equal(resolveCommand('a', { a: 'b', b: 'comments.clear' }).kind, 'unknown')
})

test('canonical and alias submissions share global and surface dispatch, including availability', () => {
  const f = fixture()
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => 'file_tree',
    getSurfaceActions: () => ({ 'cursor.down': () => { calls.push('tree'); return true } }),
    globalActions: { 'comments.clear': () => { calls.push('clear'); return true } },
  })
  for (const name of ['clear', 'comments.clear', 'cursor.down']) {
    f.controller.open(); f.focusInput()
    assert.equal(f.controller.submit(name, { clear: 'comments.clear' }, dispatch, f.focusInput), true)
    assert.equal(f.focus(), 'workspace')
    assert.equal(f.state().open, false)
    assert.equal(f.vim.getSnapshot().mode, 'normal')
  }
  assert.deepEqual(calls, ['clear', 'clear', 'tree'])
  f.controller.open(); f.focusInput()
  assert.equal(f.controller.submit('diff.wrap.toggle', {}, dispatch, f.focusInput), false)
  assert.match(f.state().error, /unavailable/)
  assert.equal(f.focus(), 'input')
  assert.equal(f.vim.getSnapshot().mode, 'command')
  f.controller.submit('bogus', {}, dispatch, f.focusInput)
  assert.match(f.state().error, /Unknown/)
  assert.deepEqual(calls, ['clear', 'clear', 'tree'])
})

test('escape and empty input restore focus; duplicate and reentrant submissions are guarded', () => {
  const f = fixture()
  const dispatch = () => assert.fail('must not dispatch')
  f.controller.open(); f.focusInput(); f.controller.cancel()
  assert.equal(f.focus(), 'workspace')
  f.controller.open(); f.focusInput(); f.controller.submit(' ', {}, dispatch)
  assert.equal(f.state().open, false)
  f.controller.open()
  let calls = 0
  const accept = () => {
    calls++
    assert.equal(f.controller.submit('comments.clear', {}, accept), false)
    f.controller.cancel() // blur while restoring focus must not cancel execution
    return true
  }
  f.controller.submit('comments.clear', {}, accept)
  f.controller.submit('comments.clear', {}, accept)
  assert.equal(calls, 1)
})

test('actions that move focus or enter a mode retain their intended outcome', () => {
  const f = fixture()
  f.controller.open()
  f.controller.submit('diff.visual_line', {}, () => {
    assert.equal(f.focus(), 'workspace')
    f.vim.dispatch({ type: 'set_mode', mode: 'visual' })
    return true
  })
  assert.equal(f.vim.getSnapshot().mode, 'visual')
})

test('colon opens through the keyboard dispatcher, overlays block it, command mode has no workspace bindings', () => {
  const f = fixture()
  let overlay = null
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => 'file_tree', getSurfaceActions: () => ({}),
    getOverlayActions: () => overlay,
    globalActions: { 'command_line.open': f.controller.open },
  })
  f.vim.subscribeCommands((command) => command.command === APPLICATION_DISPATCH_COMMAND && dispatch(command.args.actions))
  overlay = {}
  assert.equal(f.vim.dispatch({ type: 'key', key: ':' }).handled, false)
  overlay = null
  assert.equal(f.vim.dispatch({ type: 'key', key: ':' }).handled, true)
  assert.equal(f.vim.getSnapshot().mode, 'command')
  for (const key of ['q', 'j', 'd', ':', '<Enter>']) {
    assert.equal(f.vim.dispatch({ type: 'key', key }).handled, false)
  }
  for (const tagName of ['INPUT', 'TEXTAREA']) {
    assert.equal(shouldCaptureKeyboardEvent({ target: { tagName } }), false)
  }
})

test('input owns navigation and editing, ignores repeated Enter and IME confirmation, and traps Tab', () => {
  let submits = 0; let cancels = 0
  const handlers = { submit: () => submits++, cancel: () => cancels++ }
  for (const key of ['j', 'ArrowLeft', 'Backspace', 'Enter', 'Escape', 'Tab']) {
    let stopped = false; let prevented = false
    handleCommandLineKey({ key, stopPropagation: () => { stopped = true }, preventDefault: () => { prevented = true } }, handlers)
    assert(stopped)
    assert.equal(prevented, ['Enter', 'Escape', 'Tab'].includes(key))
  }
  for (const extra of [{ repeat: true }, { isComposing: true }, { nativeEvent: { isComposing: true } }]) {
    handleCommandLineKey({ key: 'Enter', stopPropagation() {}, preventDefault() {}, ...extra }, handlers)
  }
  assert.equal(submits, 1); assert.equal(cancels, 1)
})

test('alias configuration validates targets, names, types, shadowing, and fallback diagnostics', () => {
  const resolve = (commandLine) => resolveConfiguration({ configuration: { commandLine } })
  assert.deepEqual(resolve(undefined).commandAliases, {})
  const aliases = { clear: 'comments.clear', wipe: 'comments.clear', cmd: 'command_line.open' }
  assert.deepEqual(resolve({ aliases }).commandAliases, aliases)
  for (const commandLine of [null, [], { other: {} }, { aliases: null }, { aliases: [] },
    ...['', 'two words', 'a\tb', 'a\u00a0b', 'a\ufeffb', 'comments.clear'].map((name) => ({ aliases: { [name]: 'comments.clear' } })),
    ...[5, null, [], 'unknown', 'clear', 'constructor'].map((target) => ({ aliases: { clear: target } })),
  ]) {
    const result = resolve(commandLine)
    assert.equal(result.bindings, null, JSON.stringify(commandLine))
    assert.equal(result.diagnostic.code, 'invalid_configuration')
    assert.match(result.diagnostic.path, /config.json/)
  }
  const remap = resolveConfiguration({ configuration: { keybindings: { normal: { 'command_line.open': [[';']] } } } })
  assert.equal(remap.diagnostic, null)
  assert.deepEqual(remap.keymap['command_line.open'], [[';']])
})
