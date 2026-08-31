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
  REVIEW: 'review',
})

export const applicationActionGroups = Object.freeze([
  Object.freeze({ id: ActionGroup.APPLICATION, label: 'Application' }),
  Object.freeze({ id: ActionGroup.NAVIGATION, label: 'Navigation' }),
  Object.freeze({ id: ActionGroup.FILE_TREE, label: 'File tree' }),
  Object.freeze({ id: ActionGroup.REVIEW, label: 'Review comments' }),
])

export const ApplicationAction = Object.freeze({
  CLOSE_APPLICATION: 'application.close',
  OPEN_KEYMAP_REFERENCE: 'keymap_reference.open',
  CURSOR_UP: 'cursor.up',
  CURSOR_DOWN: 'cursor.down',
  CURSOR_PAGE_UP: 'cursor.page.up',
  CURSOR_PAGE_DOWN: 'cursor.page.down',
  CURSOR_FIRST: 'cursor.first',
  CURSOR_LAST: 'cursor.last',
  CURSOR_CENTER: 'cursor.center',
  FILE_TREE_ITEM_ACTIVATE: 'file_tree.item.activate',
  TREE_COLLAPSE_OR_PARENT: 'tree.collapse_or_parent',
  TREE_EXPAND: 'tree.expand',
  TREE_SIZE_INCREASE: 'tree.size.increase',
  TREE_SIZE_DECREASE: 'tree.size.decrease',
  FOCUS_FILE_TREE: 'focus.file_tree',
  FOCUS_DIFF_PANE: 'focus.diff_pane',
  SHOW_CHANGES: 'tree_mode.changes',
  SHOW_FILES: 'tree_mode.files',
  OPEN_NEXT_FILE: 'file.open.next',
  OPEN_PREVIOUS_FILE: 'file.open.previous',
  OPEN_FILE_FINDER: 'file_finder.open',
  COPY_COMMENTS: 'comments.copy',
  ADD_COMMENT: 'comments.add',
  ADD_FILE_COMMENT: 'comments.add_file',
  EDIT_COMMENT: 'comments.edit',
  DELETE_COMMENT: 'comments.delete',
})

const actionDefinitions = [
  [ApplicationAction.CLOSE_APPLICATION, ActionScope.GLOBAL, ActionGroup.APPLICATION, 'Close the application.'],
  [ApplicationAction.OPEN_KEYMAP_REFERENCE, ActionScope.GLOBAL, ActionGroup.APPLICATION, 'Show the effective keyboard bindings.'],
  [ApplicationAction.CURSOR_UP, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor up.'],
  [ApplicationAction.CURSOR_DOWN, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor down.'],
  [ApplicationAction.CURSOR_PAGE_UP, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor up by half a viewport.'],
  [ApplicationAction.CURSOR_PAGE_DOWN, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor down by half a viewport.'],
  [ApplicationAction.CURSOR_FIRST, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor to the first item.'],
  [ApplicationAction.CURSOR_LAST, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Move the active cursor to the last item.'],
  [ApplicationAction.CURSOR_CENTER, ActionScope.ACTIVE_SURFACE, ActionGroup.NAVIGATION, 'Center the active cursor in its viewport.'],
  [ApplicationAction.FILE_TREE_ITEM_ACTIVATE, ActionScope.FILE_TREE, ActionGroup.FILE_TREE, 'Activate the focused file-tree item.'],
  [ApplicationAction.TREE_COLLAPSE_OR_PARENT, ActionScope.FILE_TREE, ActionGroup.FILE_TREE, 'Collapse the focused tree item or focus its parent.'],
  [ApplicationAction.TREE_EXPAND, ActionScope.FILE_TREE, ActionGroup.FILE_TREE, 'Expand the focused tree item.'],
  [ApplicationAction.TREE_SIZE_INCREASE, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Widen the file-tree pane.'],
  [ApplicationAction.TREE_SIZE_DECREASE, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Narrow the file-tree pane.'],
  [ApplicationAction.FOCUS_FILE_TREE, ActionScope.GLOBAL, ActionGroup.APPLICATION, 'Focus the file tree.'],
  [ApplicationAction.FOCUS_DIFF_PANE, ActionScope.GLOBAL, ActionGroup.APPLICATION, 'Focus the diff pane.'],
  [ApplicationAction.SHOW_CHANGES, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Show changed files in the file tree.'],
  [ApplicationAction.SHOW_FILES, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Show all repository files in the file tree.'],
  [ApplicationAction.OPEN_NEXT_FILE, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Open the next file in the active file-tree mode.'],
  [ApplicationAction.OPEN_PREVIOUS_FILE, ActionScope.GLOBAL, ActionGroup.FILE_TREE, 'Open the previous file in the active file-tree mode.'],
  [ApplicationAction.OPEN_FILE_FINDER, ActionScope.GLOBAL, ActionGroup.APPLICATION, 'Open the file finder.'],
  [ApplicationAction.COPY_COMMENTS, ActionScope.GLOBAL, ActionGroup.REVIEW, 'Copy all review comments as Markdown.'],
  [ApplicationAction.ADD_COMMENT, ActionScope.DIFF_PANE, ActionGroup.REVIEW, 'Add a comment at the active diff cursor.'],
  [ApplicationAction.ADD_FILE_COMMENT, ActionScope.DIFF_PANE, ActionGroup.REVIEW, 'Add a comment to the open file.'],
  [ApplicationAction.EDIT_COMMENT, ActionScope.ACTIVE_SURFACE, ActionGroup.REVIEW, 'Edit the comment in the active context.'],
  [ApplicationAction.DELETE_COMMENT, ActionScope.ACTIVE_SURFACE, ActionGroup.REVIEW, 'Delete the comment in the active context.'],
]

/** Stable application actions indexed by their user-configurable identifier. */
export const applicationActionCatalog = Object.freeze(Object.fromEntries(
  actionDefinitions.map(([id, scope, group, description]) => [
    id,
    Object.freeze({ id, scope, group, description }),
  ]),
))

const keySequence = (...keys) => Object.freeze(keys)
const actionBindings = (...sequences) => Object.freeze(sequences)

export const LEADER_KEY = '<leader>'
export const DEFAULT_LEADER_KEY = '<Space>'

/** Built-in Normal-mode bindings, grouped by semantic application action. */
export const defaultNormalKeymap = Object.freeze({
  [ApplicationAction.CLOSE_APPLICATION]: actionBindings(keySequence('q')),
  [ApplicationAction.OPEN_KEYMAP_REFERENCE]: actionBindings(keySequence('?')),
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
  [ApplicationAction.COPY_COMMENTS]: actionBindings(keySequence('y')),
  [ApplicationAction.ADD_COMMENT]: actionBindings(keySequence('c')),
  [ApplicationAction.ADD_FILE_COMMENT]: actionBindings(keySequence('C')),
  [ApplicationAction.EDIT_COMMENT]: actionBindings(keySequence('e')),
  [ApplicationAction.DELETE_COMMENT]: actionBindings(keySequence('d', 'd')),
})

const contextualDuplicateSets = Object.freeze([
  new Set([ApplicationAction.FOCUS_FILE_TREE, ApplicationAction.FOCUS_DIFF_PANE]),
  new Set([ApplicationAction.SHOW_CHANGES, ApplicationAction.ADD_COMMENT]),
])

function isContextualDuplicate(actions) {
  return contextualDuplicateSets.some((allowed) => (
    actions.length === allowed.size && actions.every((action) => allowed.has(action))
  ))
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
    if (actions.length > 1 && !isContextualDuplicate(actions)) {
      throw new TypeError(`Duplicate Vim binding for normal: ${keys.join(' ')}`)
    }
    return Object.freeze({
      mode: VimMode.NORMAL,
      keys,
      ...(actions.length === 1
        ? { command: actions[0] }
        : { commands: Object.freeze(actions) }),
    })
  })

  compileBindings(bindings)
  return Object.freeze(bindings)
}

export const defaultApplicationBindings = compileApplicationKeymap()
