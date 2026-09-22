import actionDefinitions from '../../../src/app/application-actions.json' with { type: 'json' }
import { compileBindings, VimMode } from '../vim/machine.js'
import { isNormalizedVimKey } from '../vim/keyboard.js'

export const ActionScope = Object.freeze({
  GLOBAL: 'global',
  ACTIVE_SURFACE: 'active_surface',
  FILE_TREE: 'file_tree',
  DIFF_PANE: 'diff_pane',
})

export const ActionGroup = Object.freeze({
  APPLICATION: 'application',
  NAVIGATION: 'navigation',
  FILE_TREE: 'file_tree',
  FILE: 'file',
  REVIEW: 'review',
})

export const applicationActionGroups = Object.freeze([
  Object.freeze({ id: ActionGroup.APPLICATION, label: 'Application' }),
  Object.freeze({ id: ActionGroup.NAVIGATION, label: 'Navigation' }),
  Object.freeze({ id: ActionGroup.FILE_TREE, label: 'File tree' }),
  Object.freeze({ id: ActionGroup.FILE, label: 'File' }),
  Object.freeze({ id: ActionGroup.REVIEW, label: 'Review comments' }),
])

export const ApplicationAction = Object.freeze(Object.fromEntries(
  actionDefinitions.map(({ name, id }) => [name, id]),
))

/** Shared with backend configuration validation; behaviors live in the dispatcher. */
export const applicationActionCatalog = Object.freeze(Object.fromEntries(
  actionDefinitions.map(({ id, scope, group, description }) => [
    id, Object.freeze({ id, scope, group, description }),
  ]),
))

const keySequence = (...keys) => Object.freeze(keys)
const actionBindings = (...sequences) => Object.freeze(sequences)

export const LEADER_KEY = '<leader>'
export const DEFAULT_LEADER_KEY = '<Space>'
/** Internal Vim command carrying configured actions to the application dispatcher. */
export const APPLICATION_DISPATCH_COMMAND = 'application.dispatch'

/** Built-in Normal-mode bindings, grouped by semantic application action. */
export const defaultNormalKeymap = Object.freeze({
  [ApplicationAction.CLOSE_APPLICATION]: actionBindings(keySequence('q')),
  [ApplicationAction.RELOAD_REVIEW]: actionBindings(keySequence(LEADER_KEY, 'r')),
  [ApplicationAction.OPEN_KEYMAP_REFERENCE]: actionBindings(keySequence('?')),
  [ApplicationAction.OPEN_COMMAND_LINE]: actionBindings(keySequence(':')),
  [ApplicationAction.CURSOR_UP]: actionBindings(
    keySequence('k'),
    keySequence('<Up>'),
  ),
  [ApplicationAction.CURSOR_DOWN]: actionBindings(
    keySequence('j'),
    keySequence('<Down>'),
  ),
  [ApplicationAction.CURSOR_PAGE_UP]: actionBindings(keySequence('<C-u>')),
  [ApplicationAction.CURSOR_PAGE_DOWN]: actionBindings(keySequence('<C-d>')),
  [ApplicationAction.CURSOR_FIRST]: actionBindings(keySequence('g', 'g')),
  [ApplicationAction.CURSOR_LAST]: actionBindings(keySequence('G')),
  [ApplicationAction.CURSOR_CENTER]: actionBindings(keySequence('z', 'z')),
  [ApplicationAction.VISUAL_LINE]: actionBindings(keySequence('V')),
  [ApplicationAction.DIFF_SWITCH_SIDE]: actionBindings(keySequence(LEADER_KEY, 's')),
  [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: actionBindings(keySequence('<Enter>')),
  [ApplicationAction.TREE_COLLAPSE_OR_PARENT]: actionBindings(
    keySequence('h'),
    keySequence('<Left>'),
  ),
  [ApplicationAction.TREE_EXPAND]: actionBindings(
    keySequence('l'),
    keySequence('<Right>'),
  ),
  [ApplicationAction.TREE_SIZE_INCREASE]: actionBindings(
    keySequence('>'),
  ),
  [ApplicationAction.TREE_SIZE_DECREASE]: actionBindings(
    keySequence('<'),
  ),
  [ApplicationAction.FOCUS_FILE_TREE]: actionBindings(keySequence(LEADER_KEY, 'o')),
  [ApplicationAction.FOCUS_DIFF_PANE]: actionBindings(keySequence(LEADER_KEY, 'o')),
  [ApplicationAction.SHOW_CHANGES]: actionBindings(keySequence('c')),
  [ApplicationAction.SHOW_FILES]: actionBindings(keySequence('f')),
  [ApplicationAction.OPEN_NEXT_FILE]: actionBindings(keySequence(']', 'b')),
  [ApplicationAction.OPEN_PREVIOUS_FILE]: actionBindings(keySequence('[', 'b')),
  [ApplicationAction.OPEN_FILE_FINDER]: actionBindings(
    keySequence('<C-p>'),
    keySequence('<D-p>'),
    keySequence(LEADER_KEY, 'f'),
  ),
  [ApplicationAction.OPEN_FILE_FINDER_ALL]: actionBindings(
    keySequence(LEADER_KEY, 'F'),
  ),
  [ApplicationAction.DIFF_EXPAND_TOGGLE]: actionBindings(keySequence(LEADER_KEY, 'e')),
  [ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE]: actionBindings(keySequence(LEADER_KEY, 'n')),
  [ApplicationAction.DIFF_WRAP_TOGGLE]: actionBindings(keySequence(LEADER_KEY, 'w')),
  [ApplicationAction.COPY_FILE_PATH_RELATIVE]: actionBindings(keySequence(LEADER_KEY, 'y')),
  [ApplicationAction.COPY_FILE_PATH_ABSOLUTE]: actionBindings(keySequence(LEADER_KEY, 'Y')),
  [ApplicationAction.COPY_COMMENTS]: actionBindings(keySequence('y')),
  [ApplicationAction.ADD_COMMENT]: actionBindings(keySequence('c')),
  [ApplicationAction.ADD_FILE_COMMENT]: actionBindings(keySequence('C')),
  [ApplicationAction.EDIT_COMMENT]: actionBindings(keySequence('e')),
  [ApplicationAction.DELETE_COMMENT]: actionBindings(keySequence('d', 'd')),
  [ApplicationAction.CLEAR_COMMENTS]: actionBindings(keySequence('d', 'a')),
  [ApplicationAction.OPEN_TEXT_SEARCH]: actionBindings(keySequence(LEADER_KEY, '/')),
  [ApplicationAction.OPEN_TEXT_SEARCH_ALL]: actionBindings(keySequence(LEADER_KEY, '?')),
})

export const visualKeymap = Object.freeze({
  [ApplicationAction.CURSOR_UP]: actionBindings(keySequence('k'), keySequence('<Up>')),
  [ApplicationAction.CURSOR_DOWN]: actionBindings(keySequence('j'), keySequence('<Down>')),
  [ApplicationAction.CURSOR_PAGE_UP]: actionBindings(keySequence('<C-u>'), keySequence('<PageUp>')),
  [ApplicationAction.CURSOR_PAGE_DOWN]: actionBindings(keySequence('<C-d>'), keySequence('<PageDown>')),
  [ApplicationAction.CURSOR_FIRST]: actionBindings(keySequence('g', 'g')),
  [ApplicationAction.CURSOR_LAST]: actionBindings(keySequence('G')),
  [ApplicationAction.ADD_COMMENT]: actionBindings(keySequence('c')),
  [ApplicationAction.VISUAL_LINE]: actionBindings(keySequence('V')),
})

const workspaceSurfaces = Object.freeze([
  ActionScope.FILE_TREE,
  ActionScope.DIFF_PANE,
])

function actionBindingSurfaces(action) {
  const definition = applicationActionCatalog[action]
  if (!definition) return []
  if (workspaceSurfaces.includes(definition.scope)) return [definition.scope]
  return workspaceSurfaces
}

function haveDisjointBindingSurfaces(actions) {
  const claimedSurfaces = new Set()
  for (const action of actions) {
    for (const surface of actionBindingSurfaces(action)) {
      if (claimedSurfaces.has(surface)) return false
      claimedSurfaces.add(surface)
    }
  }
  return true
}

function validateKeymap(keymap) {
  if (!keymap || typeof keymap !== 'object' || Array.isArray(keymap)) {
    throw new TypeError('Application keymap must be an object')
  }

  for (const [action, sequences] of Object.entries(keymap)) {
    if (!Object.hasOwn(applicationActionCatalog, action)) {
      throw new TypeError(`Unknown application action: ${action}`)
    }
    if (!Array.isArray(sequences)) {
      throw new TypeError(`Application action ${action} requires a list of key sequences`)
    }
    for (const sequence of sequences) {
      if (!Array.isArray(sequence) || sequence.length === 0) {
        throw new TypeError(`Application action ${action} requires non-empty key sequences`)
      }
      if (sequence.some((key) => typeof key !== 'string' || key.length === 0)) {
        throw new TypeError(`Application action ${action} keys must be non-empty strings`)
      }
      for (const key of sequence) {
        if (key !== LEADER_KEY && !isNormalizedVimKey(key)) {
          throw new TypeError(
            `Application action ${action} key ${JSON.stringify(key)} is not normalized Vim notation`,
          )
        }
      }
    }
  }
}

/**
 * Converts an application keymap into the binding records accepted by the Vim
 * controller. Compiling once here also rejects duplicate and ambiguous input
 * before a keymap is installed at runtime.
 */
export function compileApplicationKeymap(
  keymap = defaultNormalKeymap,
  { leader = DEFAULT_LEADER_KEY } = {},
) {
  validateKeymap(keymap)
  if (typeof leader !== 'string' || leader.length === 0 || leader === LEADER_KEY) {
    throw new TypeError('Application keymap leader must be a concrete non-empty key')
  }

  const groupedBindings = new Map()
  for (const [action, sequences] of Object.entries(keymap)) {
    for (const keys of sequences) {
      const expandedKeys = Object.freeze(
        keys.map((key) => key === LEADER_KEY ? leader : key),
      )
      const sequence = expandedKeys.join('\u0000')
      const grouped = groupedBindings.get(sequence)
      if (grouped) grouped.actions.push(action)
      else groupedBindings.set(sequence, { keys: expandedKeys, actions: [action] })
    }
  }

  const bindings = [...groupedBindings.values()].map(({ keys, actions }) => {
    if (actions.length > 1 && !haveDisjointBindingSurfaces(actions)) {
      throw new TypeError(`Duplicate Vim binding for normal: ${keys.join(' ')}`)
    }
    const bindingActions = Object.freeze(actions)
    return Object.freeze({
      mode: VimMode.NORMAL,
      keys,
      command: APPLICATION_DISPATCH_COMMAND,
      args: Object.freeze({ actions: bindingActions }),
    })
  })

  // Visual bindings are fixed and separate from configurable Normal bindings.
  for (const [action, sequences] of Object.entries(visualKeymap)) {
    for (const keys of sequences) bindings.push(Object.freeze({
      mode: VimMode.VISUAL,
      keys,
      command: APPLICATION_DISPATCH_COMMAND,
      args: Object.freeze({ actions: Object.freeze([action]) }),
    }))
  }
  compileBindings(bindings)
  return Object.freeze(bindings)
}

export const defaultApplicationBindings = compileApplicationKeymap()
