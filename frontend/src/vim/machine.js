export const VimMode = Object.freeze({
  NORMAL: 'normal',
  INSERT: 'insert',
  VISUAL: 'visual',
  OPERATOR_PENDING: 'operator_pending',
})

const countModes = new Set([
  VimMode.NORMAL,
  VimMode.VISUAL,
  VimMode.OPERATOR_PENDING,
])
const sequenceSeparator = '\u0000'

function sequenceKey(keys) {
  return keys.join(sequenceSeparator)
}

function initialState(mode) {
  return Object.freeze({
    mode,
    count: '',
    pendingKeys: Object.freeze([]),
  })
}

/**
 * Creates an immutable keymap index. Bindings describe semantic commands; they
 * deliberately do not know about React components or browser events.
 *
 * @param {{ mode: string, keys: string[], command?: string, commands?: string[], args?: unknown, nextMode?: string }[]} bindings
 */
export function compileBindings(bindings = []) {
  const byMode = new Map()

  for (const binding of bindings) {
    if (!binding || typeof binding.mode !== 'string' || binding.mode.length === 0) {
      throw new TypeError('Vim bindings require a mode')
    }
    if (!Array.isArray(binding.keys) || binding.keys.length === 0) {
      throw new TypeError('Vim bindings require at least one key')
    }
    if (binding.keys.some((key) => typeof key !== 'string' || key.length === 0)) {
      throw new TypeError('Vim binding keys must be non-empty strings')
    }
    if (binding.command !== undefined && typeof binding.command !== 'string') {
      throw new TypeError('Vim binding commands must be strings')
    }
    if (
      binding.commands !== undefined &&
      (!Array.isArray(binding.commands) ||
        binding.commands.length === 0 ||
        binding.commands.some((command) => typeof command !== 'string'))
    ) {
      throw new TypeError('Vim binding command candidates must be non-empty strings')
    }
    if (binding.command !== undefined && binding.commands !== undefined) {
      throw new TypeError('Vim bindings cannot define both command and command candidates')
    }

    let mode = byMode.get(binding.mode)
    if (!mode) {
      mode = { exact: new Map(), prefixes: new Set() }
      byMode.set(binding.mode, mode)
    }

    const key = sequenceKey(binding.keys)
    if (mode.exact.has(key)) {
      throw new TypeError(`Duplicate Vim binding for ${binding.mode}: ${binding.keys.join(' ')}`)
    }
    mode.exact.set(key, Object.freeze({
      ...binding,
      keys: Object.freeze([...binding.keys]),
      ...(binding.commands
        ? { commands: Object.freeze([...binding.commands]) }
        : {}),
    }))

    for (let length = 1; length < binding.keys.length; length += 1) {
      mode.prefixes.add(sequenceKey(binding.keys.slice(0, length)))
    }
  }

  for (const [modeName, mode] of byMode) {
    for (const key of mode.exact.keys()) {
      if (mode.prefixes.has(key)) {
        throw new TypeError(`Ambiguous Vim binding prefix in ${modeName}`)
      }
    }
  }

  return byMode
}

export function createVimState(mode = VimMode.NORMAL) {
  return initialState(mode)
}

function isCountKey(state, key) {
  if (!countModes.has(state.mode) || state.pendingKeys.length !== 0) return false
  if (!/^\d$/.test(key)) return false
  return state.count.length > 0 || key !== '0'
}

/**
 * Pure state transition used by the controller and unit tests.
 * One input can complete at most one binding. A command record can carry
 * ordered semantic candidates for the controller to offer until one handles.
 *
 * @param {{ mode: string, count: string, pendingKeys: readonly string[] }} state
 * @param {{ type: 'key', key: string } | { type: 'reset' } | { type: 'set_mode', mode: string }} input
 * @param {ReturnType<typeof compileBindings>} bindings
 */
export function transitionVimState(state, input, bindings) {
  if (input.type === 'reset') {
    const handled = state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(state.mode) : state, handled, command: null }
  }

  if (input.type === 'set_mode') {
    if (typeof input.mode !== 'string' || input.mode.length === 0) {
      throw new TypeError('set_mode requires a mode')
    }
    const handled =
      input.mode !== state.mode || state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(input.mode) : state, handled, command: null }
  }

  if (input.type !== 'key' || typeof input.key !== 'string' || input.key.length === 0) {
    throw new TypeError('Vim input must be a key, reset, or set_mode event')
  }

  if (input.key === '<Esc>') {
    const handled =
      state.mode !== VimMode.NORMAL || state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(VimMode.NORMAL) : state, handled, command: null }
  }

  if (isCountKey(state, input.key)) {
    return {
      state: Object.freeze({ ...state, count: `${state.count}${input.key}` }),
      handled: true,
      command: null,
    }
  }

  const keys = [...state.pendingKeys, input.key]
  const modeBindings = bindings.get(state.mode)
  const key = sequenceKey(keys)
  const binding = modeBindings?.exact.get(key)

  if (binding) {
    const count = state.count === '' ? 1 : Number.parseInt(state.count, 10)
    const candidateCommands = binding.commands ?? (
      binding.command ? [binding.command] : []
    )
    const command = candidateCommands.length > 0
      ? Object.freeze({
          type: 'command',
          command: candidateCommands[0],
          ...(binding.commands ? { candidates: binding.commands } : {}),
          args: binding.args,
          count,
          keys: binding.keys,
          mode: state.mode,
        })
      : null
    return {
      state: initialState(binding.nextMode ?? state.mode),
      handled: true,
      command,
    }
  }

  if (modeBindings?.prefixes.has(key)) {
    return {
      state: Object.freeze({ ...state, pendingKeys: Object.freeze(keys) }),
      handled: true,
      command: null,
    }
  }

  const hadPendingInput = state.count !== '' || state.pendingKeys.length > 0
  return {
    state: hadPendingInput ? initialState(state.mode) : state,
    handled: hadPendingInput,
    command: null,
  }
}

export class VimController {
  constructor({ bindings = [], initialMode = VimMode.NORMAL } = {}) {
    this.bindings = compileBindings(bindings)
    this.state = createVimState(initialMode)
    this.stateChangeListeners = new Set()
    this.commandListeners = new Set()
  }

  getSnapshot = () => this.state

  /** Notifies consumers to read getSnapshot again after durable state changes. */
  subscribe = (listener) => {
    this.stateChangeListeners.add(listener)
    return () => this.stateChangeListeners.delete(listener)
  }

  /** Subscribes to transient semantic commands, which are not controller state. */
  subscribeCommands = (listener) => {
    this.commandListeners.add(listener)
    return () => this.commandListeners.delete(listener)
  }

  setBindings(bindings) {
    this.bindings = compileBindings(bindings)
    this.dispatch({ type: 'reset' })
  }

  dispatch = (input) => {
    const result = transitionVimState(this.state, input, this.bindings)
    if (result.state !== this.state) {
      this.state = result.state
      for (const listener of this.stateChangeListeners) listener()
    }
    if (!result.command) return result

    let handled = false
    let handledCommand = result.command
    const candidates = result.command.candidates ?? [result.command.command]
    for (const candidate of candidates) {
      const command = candidate === result.command.command
        ? result.command
        : Object.freeze({ ...result.command, command: candidate })
      for (const listener of this.commandListeners) {
        if (listener(command) === true) {
          handled = true
          handledCommand = command
          break
        }
      }
      if (handled) break
    }
    let deliveredCommand = handledCommand
    if (handledCommand.candidates !== undefined) {
      const singleCommand = { ...handledCommand }
      delete singleCommand.candidates
      deliveredCommand = Object.freeze(singleCommand)
    }
    return handled === result.handled && deliveredCommand === result.command
      ? result
      : { ...result, handled, command: deliveredCommand }
  }
}
