import { getConfiguration } from '../review/api.js'
import {
  DEFAULT_LEADER_KEY,
  compileApplicationKeymap,
  defaultNormalKeymap,
} from '../actions/application-actions.js'

export const USER_CONFIGURATION_PATH = '~/.config/rvw/config.json'

export const DEFAULT_WRAP_LINES = true

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyFields(object, allowed) {
  return Object.keys(object).every((field) => allowed.includes(field))
}

function configuredDiffSettings(diff) {
  if (!isObject(diff)) {
    throw new TypeError('User configuration diff must be a JSON object')
  }
  if (!onlyFields(diff, ['wrapLines'])) {
    throw new TypeError('User configuration diff contains an unsupported field')
  }
  const wrapLines = diff.wrapLines ?? DEFAULT_WRAP_LINES
  if (typeof wrapLines !== 'boolean') {
    throw new TypeError('User configuration diff.wrapLines must be a boolean')
  }
  return wrapLines
}

function configuredKeyboardConfiguration(configuration) {
  if (!isObject(configuration)) {
    throw new TypeError('User configuration must be a JSON object')
  }
  if (!onlyFields(configuration, ['keybindings', 'diff'])) {
    throw new TypeError('User configuration contains an unsupported top-level field')
  }

  const keybindings = configuration.keybindings
  if (keybindings === undefined) {
    return { keymap: defaultNormalKeymap, leader: DEFAULT_LEADER_KEY }
  }
  if (!isObject(keybindings)) {
    throw new TypeError('User configuration keybindings must be a JSON object')
  }
  if (!onlyFields(keybindings, ['normal', 'leader'])) {
    throw new TypeError('User configuration keybindings contains an unsupported field')
  }

  const leader = keybindings.leader ?? DEFAULT_LEADER_KEY
  if (typeof leader !== 'string' || leader.length === 0 || leader === '<leader>') {
    throw new TypeError('User configuration keybindings.leader must be a concrete non-empty key')
  }

  const normal = keybindings.normal
  if (normal === undefined) {
    return { keymap: defaultNormalKeymap, leader }
  }
  if (!isObject(normal)) {
    throw new TypeError('User configuration keybindings.normal must be a JSON object')
  }
  for (const action of Object.keys(normal)) {
    if (!Object.hasOwn(defaultNormalKeymap, action)) {
      throw new TypeError(`Unknown application action: ${action}`)
    }
  }

  return Object.freeze({
    keymap: Object.freeze(Object.fromEntries(
      Object.entries(defaultNormalKeymap).map(([action, defaults]) => [
        action,
        Object.hasOwn(normal, action) ? normal[action] : defaults,
      ]),
    )),
    leader,
  })
}

function frontendDiagnostic(code, message) {
  return Object.freeze({
    code,
    message,
    path: USER_CONFIGURATION_PATH,
  })
}

/**
 * Resolves one backend snapshot without mutating the active Vim controller.
 * A null bindings result tells callers to preserve the currently installed map.
 */
export function resolveConfiguration(snapshot) {
  if (!isObject(snapshot)) {
    return {
      bindings: null,
      keymap: null,
      diagnostic: frontendDiagnostic(
        'invalid_configuration',
        'configuration service returned an invalid snapshot',
      ),
    }
  }

  if (snapshot.diagnostic) {
    return { bindings: null, keymap: null, diagnostic: snapshot.diagnostic }
  }

  try {
    const keyboard = configuredKeyboardConfiguration(snapshot.configuration)
    const wrapLines = snapshot.configuration.diff === undefined
      ? DEFAULT_WRAP_LINES
      : configuredDiffSettings(snapshot.configuration.diff)
    return {
      bindings: compileApplicationKeymap(keyboard.keymap, { leader: keyboard.leader }),
      keymap: keyboard.keymap,
      leader: keyboard.leader,
      wrapLines,
      diagnostic: null,
    }
  } catch (error) {
    return {
      bindings: null,
      keymap: null,
      diagnostic: frontendDiagnostic('invalid_configuration', error.message),
    }
  }
}

/** Loads and validates configuration without delaying other startup requests. */
export async function loadConfiguration(loadSnapshot = getConfiguration) {
  try {
    return resolveConfiguration(await loadSnapshot())
  } catch (error) {
    return {
      bindings: null,
      keymap: null,
      diagnostic: frontendDiagnostic(
        'configuration_unavailable',
        `unable to load user configuration: ${error.message}`,
      ),
    }
  }
}