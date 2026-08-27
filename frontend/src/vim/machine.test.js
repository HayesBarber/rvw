import assert from 'node:assert/strict'
import test from 'node:test'
import { compileBindings, VimController, VimMode } from './machine.js'

const bindings = [
  { mode: VimMode.NORMAL, keys: ['j'], command: 'cursor.down' },
  { mode: VimMode.NORMAL, keys: ['g', 'g'], command: 'cursor.first' },
  {
    mode: VimMode.NORMAL,
    keys: ['v'],
    command: 'selection.start',
    nextMode: VimMode.VISUAL,
  },
]

test('dispatches a semantic command for an exact binding', () => {
  const controller = new VimController({ bindings })
  const commands = []
  controller.subscribeCommands((command) => commands.push(command))

  const result = controller.dispatch({ type: 'key', key: 'j' })

  assert.equal(result.handled, true)
  assert.equal(result.command.command, 'cursor.down')
  assert.deepEqual(commands, [
    {
      type: 'command',
      command: 'cursor.down',
      args: undefined,
      count: 1,
      keys: ['j'],
      mode: VimMode.NORMAL,
    },
  ])
})

test('waits for multi-key bindings and applies a count', () => {
  const controller = new VimController({ bindings })

  controller.dispatch({ type: 'key', key: '4' })
  const prefix = controller.dispatch({ type: 'key', key: 'g' })
  const result = controller.dispatch({ type: 'key', key: 'g' })

  assert.equal(prefix.handled, true)
  assert.deepEqual(prefix.state.pendingKeys, ['g'])
  assert.equal(result.command.command, 'cursor.first')
  assert.equal(result.command.count, 4)
  assert.deepEqual(controller.getSnapshot(), {
    mode: VimMode.NORMAL,
    count: '',
    pendingKeys: [],
  })
})

test('supports mode transitions and escape returns to normal mode', () => {
  const controller = new VimController({ bindings })

  controller.dispatch({ type: 'key', key: 'v' })
  assert.equal(controller.getSnapshot().mode, VimMode.VISUAL)

  const result = controller.dispatch({ type: 'key', key: '<Esc>' })
  assert.equal(result.handled, true)
  assert.equal(controller.getSnapshot().mode, VimMode.NORMAL)
})

test('does not consume an unbound key when no sequence is pending', () => {
  const controller = new VimController({ bindings })
  const result = controller.dispatch({ type: 'key', key: 'x' })

  assert.equal(result.handled, false)
  assert.equal(result.state, controller.getSnapshot())
})

test('clears an invalid pending sequence', () => {
  const controller = new VimController({ bindings })

  controller.dispatch({ type: 'key', key: 'g' })
  const result = controller.dispatch({ type: 'key', key: 'x' })

  assert.equal(result.handled, true)
  assert.deepEqual(controller.getSnapshot().pendingKeys, [])
})

test('rejects a binding that makes a longer sequence unreachable', () => {
  assert.throws(
    () => compileBindings([
      { mode: VimMode.NORMAL, keys: ['g'], command: 'single' },
      { mode: VimMode.NORMAL, keys: ['g', 'g'], command: 'double' },
    ]),
    /Ambiguous Vim binding prefix/,
  )
})
