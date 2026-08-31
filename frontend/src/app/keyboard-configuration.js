import { getConfiguration } from '../review/api.js'
import {
  compileApplicationKeymap,
  defaultNormalKeymap,
} from '../actions/application-actions.js'

export const USER_CONFIGURATION_PATH = '~/.config/rvw/config.json'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyFields(object, allowed) {
  return Object.keys(object).every((field) => allowed.includes(field))
}

function configuredNormalKeymap(configuration) {
  if (!isObject(configuration)) {
    throw new TypeError('User configuration must be a JSON object')
  }
  if (!onlyFields(configuration, ['keybindings'])) {
    throw new TypeError('User configuration contains an unsupported top-level field')
  }

  const keybindings = configuration.keybindings
  if (keybindings === undefined) return defaultNormalKeymap
  if (!isObject(keybindings)) {
    throw new TypeError('User configuration keybindings must be a JSON object')
  }
  if (!onlyFields(keybindings, ['normal'])) {
    throw new TypeError('User configuration keybindings contains an unsupported field')
  }

  const normal = keybindings.normal
  if (normal === undefined) return defaultNormalKeymap
  if (!isObject(normal)) {
    throw new TypeError('User configuration keybindings.normal must be a JSON object')
  }
  for (const action of Object.keys(normal)) {
    if (!Object.hasOwn(defaultNormalKeymap, action)) {
      throw new TypeError(`Unknown application action: ${action}`)
    }
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(defaultNormalKeymap).map(([action, defaults]) => [
      action,
      Object.hasOwn(normal, action) ? normal[action] : defaults,
    ]),
  ))
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
export function resolveKeyboardConfiguration(snapshot) {
  if (!isObject(snapshot)) {
    return {
      bindings: null,
      keymap: null,
      diagnostic: frontendDiagnostic(
        'invalid_keybindings',
        'configuration service returned an invalid snapshot',
      ),
    }
  }

  if (snapshot.diagnostic) {
    return { bindings: null, keymap: null, diagnostic: snapshot.diagnostic }
  }

  try {
    const keymap = configuredNormalKeymap(snapshot.configuration)
    return {
      bindings: compileApplicationKeymap(keymap),
      keymap,
      diagnostic: null,
    }
  } catch (error) {
    return {
      bindings: null,
      keymap: null,
      diagnostic: frontendDiagnostic('invalid_keybindings', error.message),
    }
  }
}

/** Loads and validates configuration without delaying other startup requests. */
export async function loadKeyboardConfiguration(loadSnapshot = getConfiguration) {
  try {
    return resolveKeyboardConfiguration(await loadSnapshot())
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
