import { ActionScope, applicationActionCatalog } from './application-actions.js'

export function commandPaletteActions(activeSurface, query = '') {
  const search = query.trim().toLowerCase()
  return Object.values(applicationActionCatalog).filter((action) => (
    (action.scope === ActionScope.GLOBAL ||
      action.scope === ActionScope.ACTIVE_SURFACE || action.scope === activeSurface) &&
    `${action.description} ${action.id}`.toLowerCase().includes(search)
  ))
}
