import {
  DEFAULT_LEADER_KEY,
  LEADER_KEY,
  applicationActionCatalog,
  applicationActionGroups,
} from './application-actions.js'

function effectiveSequence(keys, leader) {
  return keys.map((key) => key === LEADER_KEY ? leader : key)
}

export const KEYMAP_REFERENCE_SCROLL_STEP = 56

/** Maps the reference's plain Vim scroll keys to a vertical pixel delta. */
export function keymapReferenceScrollDelta(key) {
  if (key === 'j') return KEYMAP_REFERENCE_SCROLL_STEP
  if (key === 'k') return -KEYMAP_REFERENCE_SCROLL_STEP
  return null
}

/** Builds the reference model from the effective map and action catalog. */
export function createKeymapReference(keymap, leader = DEFAULT_LEADER_KEY, aliases = {}) {
  const aliasEntries = Object.entries(aliases)
  return applicationActionGroups.map((group) => Object.freeze({
    ...group,
    actions: Object.freeze(Object.values(applicationActionCatalog)
      .filter((action) => action.group === group.id)
      .map((action) => Object.freeze({
        ...action,
        aliases: Object.freeze(aliasEntries
          .filter(([, target]) => target === action.id)
          .map(([name]) => name)
          .sort()),
        sequences: Object.freeze((keymap[action.id] ?? [])
          .map((keys) => Object.freeze(effectiveSequence(keys, leader)))),
      }))),
  }))
}
