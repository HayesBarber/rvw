import { ApplicationAction } from './application-actions.js'

// Adapts file tree operations to the application action vocabulary.

export const fileTreeFocusCSS = `
  :host([data-cursor-visible='true']) [data-type='item'][tabindex='0'] {
    box-shadow: inset 0 0 0 var(--trees-focus-ring-width)
      var(--trees-focus-ring-color);
  }

  :host([data-cursor-visible='true'])
    [data-type='item'][tabindex='0']:not([data-item-selected='true']) {
    background-color: var(--trees-bg-muted);
    --truncate-marker-background-overlay-color: var(--trees-bg-muted);
  }
`

function repeat(count, operation) {
  const repetitions = Number.isSafeInteger(count) && count > 0 ? count : 1
  for (let index = 0; index < repetitions; index += 1) operation()
}

function scrollFocusedItemIntoView(model) {
  const path = model.getFocusedPath()
  if (path) model.scrollToPath(path, { focus: false, offset: 'nearest' })
}

function moveFocus(model, operation, count = 1) {
  repeat(count, operation)
  scrollFocusedItemIntoView(model)
  return model.getFocusedItem() !== null
}

function halfPageItemCount(model) {
  const viewportHeight = model.getFileTreeContainer?.()?.clientHeight ?? 0
  const itemHeight = model.getItemHeight?.() ?? 0
  if (viewportHeight <= 0 || itemHeight <= 0) return 0
  return Math.max(1, Math.round(viewportHeight / itemHeight / 2))
}

function moveFocusByPage(model, operation, count = 1) {
  const pageItems = halfPageItemCount(model)
  if (pageItems === 0) return false
  return moveFocus(model, operation, pageItems * (
    Number.isSafeInteger(count) && count > 0 ? count : 1
  ))
}

/** Adapts semantic application actions to the file-tree surface. */
export function createFileTreeActionAdapter(
  model,
  onSelectFile,
  {
    focusDiffPane = () => false,
    showChanges = () => false,
    showFiles = () => false,
  } = {},
) {
  return Object.freeze({
    [ApplicationAction.FOCUS_DIFF_PANE]: focusDiffPane,
    [ApplicationAction.SHOW_CHANGES]: showChanges,
    [ApplicationAction.SHOW_FILES]: showFiles,
    [ApplicationAction.CURSOR_UP]: (count) => moveFocus(
      model,
      () => model.focusPreviousItem(),
      count,
    ),
    [ApplicationAction.CURSOR_DOWN]: (count) => moveFocus(
      model,
      () => model.focusNextItem(),
      count,
    ),
    [ApplicationAction.CURSOR_PAGE_UP]: (count) => moveFocusByPage(
      model,
      () => model.focusPreviousItem(),
      count,
    ),
    [ApplicationAction.CURSOR_PAGE_DOWN]: (count) => moveFocusByPage(
      model,
      () => model.focusNextItem(),
      count,
    ),
    [ApplicationAction.CURSOR_FIRST]: () => moveFocus(
      model,
      () => model.focusFirstItem(),
    ),
    [ApplicationAction.CURSOR_LAST]: () => moveFocus(
      model,
      () => model.focusLastItem(),
    ),
    [ApplicationAction.CURSOR_CENTER]: () => {
      const path = model.getFocusedPath()
      if (!path) return false

      model.scrollToPath(path, { focus: false, offset: 'center' })
      return true
    },
    [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: () => {
      const item = model.getFocusedItem()
      if (!item) return false

      if (item.isDirectory()) item.toggle()
      else onSelectFile(item.getPath())
      return true
    },
    [ApplicationAction.TREE_COLLAPSE_OR_PARENT]: () => {
      const item = model.getFocusedItem()
      if (!item) return false

      if (item.isDirectory() && item.isExpanded()) item.collapse()
      else model.focusParentItem()
      scrollFocusedItemIntoView(model)
      return true
    },
    [ApplicationAction.TREE_EXPAND]: () => {
      const item = model.getFocusedItem()
      if (!item?.isDirectory()) return false

      item.expand()
      scrollFocusedItemIntoView(model)
      return true
    },
  })
}
