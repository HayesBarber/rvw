import { getConfiguration } from '../review/api.js'
import {
  applicationActionCatalog,
  DEFAULT_LEADER_KEY,
  compileApplicationKeymap,
  defaultNormalKeymap,
} from '../actions/application-actions.js'

export const USER_CONFIGURATION_PATH = '~/.config/rvw/config.json'

export const DEFAULT_WRAP_LINES = true
export const DEFAULT_RELATIVE_LINE_NUMBERS = false
export const DEFAULT_COMMENT_TYPES = Object.freeze(['ISSUE', 'QUESTION', 'NITPICK'])
export const DEFAULT_COMMENT_TYPE = null

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
  if (!onlyFields(diff, ['wrapLines', 'relativeLineNumbers'])) {
    throw new TypeError('User configuration diff contains an unsupported field')
  }
  const wrapLines = diff.wrapLines ?? DEFAULT_WRAP_LINES
  if (typeof wrapLines !== 'boolean') {
    throw new TypeError('User configuration diff.wrapLines must be a boolean')
  }
  const relativeLineNumbers = diff.relativeLineNumbers ?? DEFAULT_RELATIVE_LINE_NUMBERS
  if (typeof relativeLineNumbers !== 'boolean') {
    throw new TypeError('User configuration diff.relativeLineNumbers must be a boolean')
  }
  return { relativeLineNumbers, wrapLines }
}

function configuredCommentSettings(comments) {
  if (comments === undefined) {
    return {
      commentTypes: DEFAULT_COMMENT_TYPES,
      defaultCommentType: DEFAULT_COMMENT_TYPE,
    }
  }
  if (!isObject(comments)) {
    throw new TypeError('User configuration comments must be a JSON object')
  }
  if (!onlyFields(comments, ['types', 'defaultType'])) {
    throw new TypeError('User configuration comments contains an unsupported field')
  }

  const types = comments.types ?? DEFAULT_COMMENT_TYPES
  if (!Array.isArray(types)) {
    throw new TypeError('User configuration comments.types must be an array')
  }
  const seen = new Set()
  for (const type of types) {
    if (typeof type !== 'string') {
      throw new TypeError('Each comments.types entry must be a string')
    }
    if (type.trim().length === 0) {
      throw new TypeError('Comments.types entries cannot be blank')
    }
    if (/\r|\n/.test(type)) {
      throw new TypeError('Comments.types entries cannot contain line breaks')
    }
    if (seen.has(type)) {
      throw new TypeError('Comments.types entries must be unique')
    }
    seen.add(type)
  }

  const defaultType = comments.defaultType ?? null
  if (defaultType !== null && typeof defaultType !== 'string') {
    throw new TypeError('User configuration comments.defaultType must be a string or null')
  }
  if (defaultType !== null && !seen.has(defaultType)) {
    throw new TypeError('User configuration comments.defaultType must match a configured type')
  }
  return {
    commentTypes: Object.freeze([...types]),
    defaultCommentType: defaultType,
  }
}

export function configuredCommandAliases(commandLine = {}) {
  if (!isObject(commandLine) || !onlyFields(commandLine, ['aliases'])) {
    throw new TypeError('User configuration commandLine must be an object containing only aliases')
  }
  const aliases = commandLine.aliases === undefined ? {} : commandLine.aliases
  if (!isObject(aliases)) throw new TypeError('commandLine.aliases must be an object')
  for (const [name, action] of Object.entries(aliases)) {
    if (!name || /\s/u.test(name)) throw new TypeError('Command aliases must be non-empty names without whitespace')
    if (Object.hasOwn(applicationActionCatalog, name)) throw new TypeError(`Command alias shadows an action: ${name}`)
    if (typeof action !== 'string' || !Object.hasOwn(applicationActionCatalog, action)) {
      throw new TypeError(`Unknown command alias target: ${String(action)}`)
    }
  }
  return Object.freeze({ ...aliases })
}

function configuredKeyboardConfiguration(configuration) {
  if (!isObject(configuration)) {
    throw new TypeError('User configuration must be a JSON object')
  }
  if (!onlyFields(configuration, ['keybindings', 'diff', 'comments', 'commandLine'])) {
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
    const diff = snapshot.configuration.diff === undefined
      ? {
          relativeLineNumbers: DEFAULT_RELATIVE_LINE_NUMBERS,
          wrapLines: DEFAULT_WRAP_LINES,
        }
      : configuredDiffSettings(snapshot.configuration.diff)
    const comments = configuredCommentSettings(snapshot.configuration.comments)
    return {
      bindings: compileApplicationKeymap(keyboard.keymap, { leader: keyboard.leader }),
      keymap: keyboard.keymap,
      leader: keyboard.leader,
      ...diff,
      ...comments,
      commandAliases: configuredCommandAliases(snapshot.configuration.commandLine),
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
