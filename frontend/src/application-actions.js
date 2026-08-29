import { compileBindings, VimMode } from './vim/machine.js'

export const ActionScope = Object.freeze({
  GLOBAL: 'global',
  ACTIVE_SURFACE: 'active_surface',
  FILE_TREE: 'file_tree',
})

export const ApplicationAction = Object.freeze({
  CURSOR_UP: 'cursor.up',
  CURSOR_DOWN: 'cursor.down',
  CURSOR_FIRST: 'cursor.first',
  CURSOR_LAST: 'cursor.last',
  FILE_TREE_ITEM_ACTIVATE: 'file_tree.item.activate',
  TREE_COLLAPSE_OR_PARENT: 'tree.collapse_or_parent',
  TREE_EXPAND: 'tree.expand',
  FOCUS_FILE_TREE: 'focus.file_tree',
  FOCUS_DIFF_PANE: 'focus.diff_pane',
  SHOW_CHANGES: 'tree_mode.changes',
  SHOW_FILES: 'tree_mode.files',
  OPEN_FILE_FINDER: 'file_finder.open',
  COPY_COMMENTS: 'comments.copy',
})

const actionDefinitions = [
  [ApplicationAction.CURSOR_UP, ActionScope.ACTIVE_SURFACE, 'Move the active cursor up.'],
  [ApplicationAction.CURSOR_DOWN, ActionScope.ACTIVE_SURFACE, 'Move the active cursor down.'],
  [ApplicationAction.CURSOR_FIRST, ActionScope.ACTIVE_SURFACE, 'Move the active cursor to the first item.'],
  [ApplicationAction.CURSOR_LAST, ActionScope.ACTIVE_SURFACE, 'Move the active cursor to the last item.'],
  [ApplicationAction.FILE_TREE_ITEM_ACTIVATE, ActionScope.FILE_TREE, 'Activate the focused file-tree item.'],
  [ApplicationAction.TREE_COLLAPSE_OR_PARENT, ActionScope.FILE_TREE, 'Collapse the focused tree item or focus its parent.'],
  [ApplicationAction.TREE_EXPAND, ActionScope.FILE_TREE, 'Expand the focused tree item.'],
  [ApplicationAction.FOCUS_FILE_TREE, ActionScope.GLOBAL, 'Focus the file tree.'],
  [ApplicationAction.FOCUS_DIFF_PANE, ActionScope.GLOBAL, 'Focus the diff pane.'],
  [ApplicationAction.SHOW_CHANGES, ActionScope.GLOBAL, 'Show changed files in the file tree.'],
  [ApplicationAction.SHOW_FILES, ActionScope.GLOBAL, 'Show all repository files in the file tree.'],
  [ApplicationAction.OPEN_FILE_FINDER, ActionScope.GLOBAL, 'Open the file finder.'],
  [ApplicationAction.COPY_COMMENTS, ActionScope.GLOBAL, 'Copy all review comments as Markdown.'],
]

/** Stable application actions indexed by their user-configurable identifier. */
export const applicationActionCatalog = Object.freeze(Object.fromEntries(
  actionDefinitions.map(([id, scope, description]) => [
    id,
    Object.freeze({ id, scope, description }),
  ]),
))

const keySequence = (...keys) => Object.freeze(keys)
const actionBindings = (...sequences) => Object.freeze(sequences)

export const LEADER_KEY = '<leader>'
export const DEFAULT_LEADER_KEY = '<Space>'

/** Built-in Normal-mode bindings, grouped by semantic application action. */
export const defaultNormalKeymap = Object.freeze({
  [ApplicationAction.CURSOR_UP]: actionBindings(
    keySequence('k'),
    keySequence('<Up>'),
  ),
  [ApplicationAction.CURSOR_DOWN]: actionBindings(
    keySequence('j'),
    keySequence('<Down>'),
  ),
  [ApplicationAction.CURSOR_FIRST]: actionBindings(keySequence('g', 'g')),
  [ApplicationAction.CURSOR_LAST]: actionBindings(keySequence('G')),
  [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: actionBindings(keySequence('<Enter>')),
  [ApplicationAction.TREE_COLLAPSE_OR_PARENT]: actionBindings(
    keySequence('h'),
    keySequence('<Left>'),
  ),
  [ApplicationAction.TREE_EXPAND]: actionBindings(
    keySequence('l'),
    keySequence('<Right>'),
  ),
  [ApplicationAction.FOCUS_FILE_TREE]: actionBindings(keySequence('g', 't')),
  [ApplicationAction.FOCUS_DIFF_PANE]: actionBindings(keySequence('g', 'd')),
  [ApplicationAction.SHOW_CHANGES]: actionBindings(keySequence('g', 'c')),
  [ApplicationAction.SHOW_FILES]: actionBindings(keySequence('g', 'f')),
  [ApplicationAction.OPEN_FILE_FINDER]: actionBindings(
    keySequence('<C-p>'),
    keySequence('<D-p>'),
  ),
  [ApplicationAction.COPY_COMMENTS]: actionBindings(keySequence('y')),
})

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

  const bindings = Object.entries(keymap).flatMap(([action, sequences]) => (
    sequences.map((keys) => Object.freeze({
      mode: VimMode.NORMAL,
      keys: Object.freeze(keys.map((key) => key === LEADER_KEY ? leader : key)),
      command: action,
    }))
  ))

  compileBindings(bindings)
  return Object.freeze(bindings)
}

export const defaultApplicationBindings = compileApplicationKeymap()
