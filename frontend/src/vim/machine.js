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
 * @param {{ mode: string, keys: string[], command?: string, args?: unknown, nextMode?: string }[]} bindings
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

    let mode = byMode.get(binding.mode)
    if (!mode) {
      mode = { exact: new Map(), prefixes: new Set() }
      byMode.set(binding.mode, mode)
    }

    const key = sequenceKey(binding.keys)
    if (mode.exact.has(key)) {
      throw new TypeError(`Duplicate Vim binding for ${binding.mode}: ${binding.keys.join(' ')}`)
    }
    mode.exact.set(key, Object.freeze({ ...binding, keys: Object.freeze([...binding.keys]) }))

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
 *
 * @param {{ mode: string, count: string, pendingKeys: readonly string[] }} state
 * @param {{ type: 'key', key: string } | { type: 'reset' } | { type: 'set_mode', mode: string }} input
 * @param {ReturnType<typeof compileBindings>} bindings
 */
export function transitionVimState(state, input, bindings) {
  if (input.type === 'reset') {
    const handled = state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(state.mode) : state, handled, commands: [] }
  }

  if (input.type === 'set_mode') {
    if (typeof input.mode !== 'string' || input.mode.length === 0) {
      throw new TypeError('set_mode requires a mode')
    }
    const handled =
      input.mode !== state.mode || state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(input.mode) : state, handled, commands: [] }
  }

  if (input.type !== 'key' || typeof input.key !== 'string' || input.key.length === 0) {
    throw new TypeError('Vim input must be a key, reset, or set_mode event')
  }

  if (input.key === '<Esc>') {
    const handled =
      state.mode !== VimMode.NORMAL || state.count !== '' || state.pendingKeys.length > 0
    return { state: handled ? initialState(VimMode.NORMAL) : state, handled, commands: [] }
  }

  if (isCountKey(state, input.key)) {
    return {
      state: Object.freeze({ ...state, count: `${state.count}${input.key}` }),
      handled: true,
      commands: [],
    }
  }

  const keys = [...state.pendingKeys, input.key]
  const modeBindings = bindings.get(state.mode)
  const key = sequenceKey(keys)
  const binding = modeBindings?.exact.get(key)

  if (binding) {
    const count = state.count === '' ? 1 : Number.parseInt(state.count, 10)
    const command = binding.command
      ? Object.freeze({
          type: 'command',
          command: binding.command,
          args: binding.args,
          count,
          keys: binding.keys,
          mode: state.mode,
        })
      : null
    return {
      state: initialState(binding.nextMode ?? state.mode),
      handled: true,
      commands: command ? [command] : [],
    }
  }

  if (modeBindings?.prefixes.has(key)) {
    return {
      state: Object.freeze({ ...state, pendingKeys: Object.freeze(keys) }),
      handled: true,
      commands: [],
    }
  }

  const hadPendingInput = state.count !== '' || state.pendingKeys.length > 0
  return {
    state: hadPendingInput ? initialState(state.mode) : state,
    handled: hadPendingInput,
    commands: [],
  }
}

export class VimController {
  constructor({ bindings = [], initialMode = VimMode.NORMAL } = {}) {
    this.bindings = compileBindings(bindings)
    this.state = createVimState(initialMode)
    this.stateListeners = new Set()
    this.commandListeners = new Set()
  }

  getSnapshot = () => this.state

  subscribe = (listener) => {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

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
      for (const listener of this.stateListeners) listener()
    }
    for (const command of result.commands) {
      for (const listener of this.commandListeners) listener(command)
    }
    return result
  }
}
