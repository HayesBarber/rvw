import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommandLine, handleCommandLineKey, resolveCommand } from './command-line.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { defaultApplicationBindings, APPLICATION_DISPATCH_COMMAND } from './application-actions.js'
import { VimController } from '../vim/machine.js'
import { shouldCaptureKeyboardEvent } from '../vim/keyboard.js'
import { resolveConfiguration } from '../app/configuration.js'
import { currentFileLineTarget, createCurrentFileLineNavigation } from './line-navigation.js'
import { ActiveSurface, initialWorkspaceState, workspaceReducer } from '../app/workspace.js'

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

test('integer commands resolve positive decimal source lines and preserve configured aliases', () => {
  for (const [input, lineNumber] of [['212', 212], [' 1 ', 1], ['00042', 42],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    assert.deepEqual(resolveCommand(input), { kind: 'line', lineNumber })
  }
  for (const input of ['0', '000', '-1', '+1', '1.5', '1e2', '0x10', '12x', '1 2',
    ':212', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.equal(resolveCommand(input).kind, 'unknown')
  }
  assert.deepEqual(resolveCommand('212', { 212: 'comments.clear' }), {
    kind: 'action', action: 'comments.clear',
  })
})

test('integer submission navigates the current file, moves focus, and supports history and repetition', () => {
  const f = fixture()
  let state = { ...initialWorkspaceState, selectedPath: 'a.txt', activeSurface: ActiveSurface.FILE_TREE }
  let focus = 'tree'
  const file = { path: 'a.txt', content: { kind: 'file', file: {
    contents: Array.from({ length: 300 }, () => 'line\n').join(''),
  } } }
  const navigate = createCurrentFileLineNavigation({
    getTarget: (line) => currentFileLineTarget(file, null, line),
    dispatchWorkspace: (action) => { state = workspaceReducer(state, action) },
    focusDiffPane: () => { focus = 'diff'; return true },
  })
  const dispatch = () => assert.fail('line numbers must not dispatch named actions')
  for (const input of ['212', '1', '212', '212']) {
    f.controller.open(); f.focusInput()
    const previousTarget = state.lineNavigation
    assert.equal(f.controller.submit(input, {}, dispatch, f.focusInput, navigate), true)
    assert.deepEqual(state.lineNavigation, { path: 'a.txt', lineNumber: Number(input), side: 'new' })
    assert.notEqual(state.lineNavigation, previousTarget)
    assert.equal(state.activeSurface, ActiveSurface.DIFF_PANE)
    assert.equal(focus, 'diff')
    assert.equal(f.state().open, false)
    assert.equal(f.vim.getSnapshot().mode, 'normal')
  }
  f.controller.open()
  assert.equal(f.controller.recallPrevious('draft'), '212')
  assert.equal(f.controller.recallPrevious('212'), '212')
  assert.equal(f.controller.recallPrevious('212'), '1')
  assert.equal(f.controller.recallNext('1'), '212')
})

test('unavailable line submissions keep input focus and enter history without changing the view', () => {
  const f = fixture()
  f.controller.open(); f.focusInput()
  const calls = []
  assert.equal(f.controller.submit('212', {}, () => assert.fail('must not dispatch'),
    f.focusInput, (line) => { calls.push(line); return false }), false)
  assert.deepEqual(calls, [212])
  assert.deepEqual(f.state(), { open: true, error: 'Line unavailable: 212' })
  assert.equal(f.focus(), 'input')
  assert.equal(f.vim.getSnapshot().mode, 'command')
  assert.equal(f.controller.recallPrevious('draft'), '212')
  f.controller.cancel()
  assert.equal(f.state().open, false)
})

test('numeric aliases keep named dispatch and line navigation cannot submit twice', () => {
  const f = fixture()
  f.controller.open()
  assert.equal(f.controller.submit('212', { 212: 'comments.clear' }, (action) => {
    assert.equal(action, 'comments.clear'); return true
  }, f.focusInput, () => assert.fail('must use the alias')), true)
  f.controller.open()
  let calls = 0
  const navigate = () => {
    calls++
    assert.equal(f.controller.submit('212', {}, () => false, f.focusInput, navigate), false)
    f.controller.cancel()
    return true
  }
  assert.equal(f.controller.submit('212', {}, () => false, f.focusInput, navigate), true)
  assert.equal(f.controller.submit('212', {}, () => false, f.focusInput, navigate), false)
  assert.equal(calls, 1)
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

test('history survives closing, recalls submissions in reverse order, and allows edited submission', () => {
  const f = fixture()
  const calls = []
  const dispatch = (action) => { calls.push(action); return true }
  for (const input of ['  clear  ', 'cursor.down', 'diff.wrap.toggle']) {
    f.controller.open()
    f.controller.submit(input, { clear: 'comments.clear' }, dispatch)
  }
  f.controller.open(); f.focusInput()
  assert.equal(f.controller.recallPrevious('draft'), 'diff.wrap.toggle')
  assert.equal(f.controller.recallPrevious('diff.wrap.toggle'), 'cursor.down')
  assert.equal(f.controller.recallPrevious('cursor.down'), '  clear  ')
  assert.equal(f.controller.recallPrevious('  clear  '), '  clear  ')
  assert.equal(f.focus(), 'input')
  assert.equal(f.vim.getSnapshot().mode, 'command')
  assert.equal(calls.length, 3)
  f.controller.submit('cursor.up', {}, dispatch)
  assert.equal(calls.at(-1), 'cursor.up')
  f.controller.open()
  assert.equal(f.controller.recallPrevious(''), 'cursor.up')
  f.controller.cancel()
  assert.equal(f.controller.recallPrevious('closed'), 'closed')
  f.controller.open()
  assert.equal(f.controller.recallPrevious(''), 'cursor.up')
})

test('empty history and blank submissions preserve input; failed submissions enter history', () => {
  const f = fixture()
  f.controller.open()
  assert.equal(f.controller.recallPrevious('draft'), 'draft')
  f.controller.submit('  ', {}, () => assert.fail('must not dispatch'))
  f.controller.open()
  assert.equal(f.controller.recallPrevious('draft'), 'draft')
  f.controller.submit('unknown', {}, () => assert.fail('must not dispatch'))
  assert.equal(f.controller.recallPrevious('draft'), 'unknown')
  f.controller.submit('comments.clear', {}, () => false, f.focusInput)
  assert.equal(f.controller.recallPrevious('draft'), 'comments.clear')
  assert.equal(f.controller.recallPrevious(''), 'unknown')
  assert.equal(fixture().controller.recallPrevious('new session'), 'new session')
})

test('history retains only the latest 1,000 submissions, including duplicates', () => {
  const f = fixture()
  f.controller.open()
  for (let i = 0; i < 1002; i++) f.controller.submit(`unknown-${i}`, {}, () => false)
  f.controller.submit('unknown-1001', {}, () => false)
  assert.equal(f.controller.recallPrevious(''), 'unknown-1001')
  assert.equal(f.controller.recallPrevious(''), 'unknown-1001')
  for (let i = 1000; i >= 3; i--) assert.equal(f.controller.recallPrevious(''), `unknown-${i}`)
  assert.equal(f.controller.recallPrevious(''), 'unknown-3')
})

test('Down Arrow recalls newer commands and restores the draft without submission or focus changes', () => {
  const f = fixture()
  f.controller.open(); f.focusInput()
  assert.equal(f.controller.recallNext('empty history'), 'empty history')
  for (const input of ['first', 'second', 'third']) f.controller.submit(input, {}, () => assert.fail('must not dispatch'))
  assert.equal(f.controller.recallNext('draft'), 'draft')
  assert.equal(f.controller.recallPrevious('draft'), 'third')
  assert.equal(f.controller.recallPrevious('third'), 'second')
  assert.equal(f.controller.recallPrevious('second'), 'first')
  assert.equal(f.controller.recallNext('first'), 'second')
  assert.equal(f.controller.recallNext('second'), 'third')
  assert.equal(f.controller.recallNext('third edited'), 'draft')
  assert.equal(f.controller.recallNext('draft edited'), 'draft edited')
  assert.equal(f.controller.recallPrevious('draft edited'), 'third')
  assert.equal(f.controller.recallNext('third'), 'draft edited')
  assert.equal(f.focus(), 'input')
  assert.equal(f.vim.getSnapshot().mode, 'command')
  f.controller.cancel()
  assert.equal(f.controller.recallNext('closed'), 'closed')
  f.controller.open()
  assert.equal(f.controller.recallNext('new draft'), 'new draft')
  assert.equal(f.controller.recallPrevious(''), 'third')
  assert.equal(f.controller.recallNext('third'), '')
  f.controller.recallPrevious('old draft')
  f.controller.submit('fourth', {}, () => assert.fail('must not dispatch'))
  assert.equal(f.controller.recallNext('fourth'), 'fourth')
  assert.equal(f.controller.recallPrevious('new draft'), 'fourth')
  assert.equal(f.controller.recallNext('fourth'), 'new draft')
})

for (const key of ['ArrowUp', 'ArrowDown']) {
  test(`${key} recalls without submission, supports repeat, and respects IME and modifiers`, () => {
    let recalls = 0
    const handlers = {
      recallPrevious: () => recalls++,
      recallNext: () => recalls++,
      submit: () => assert.fail('must not submit'),
      cancel: () => assert.fail('must not cancel'),
    }
    for (const extra of [{}, { repeat: true }, { isComposing: true },
      { nativeEvent: { isComposing: true } }, { altKey: true }, { ctrlKey: true },
      { metaKey: true }, { shiftKey: true }]) {
      let stopped = false; let prevented = false
      handleCommandLineKey({ key, stopPropagation: () => { stopped = true },
        preventDefault: () => { prevented = true }, ...extra }, handlers)
      assert(stopped)
      assert.equal(prevented, Object.keys(extra).length === 0 || Boolean(extra.repeat))
    }
    assert.equal(recalls, 2)
  })
}

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
