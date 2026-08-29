import { ApplicationAction } from './application-actions.js'

export const fileTreeFocusCSS = `
  [data-type='item'][tabindex='0'] {
    box-shadow: inset 0 0 0 var(--trees-focus-ring-width)
      var(--trees-focus-ring-color);
  }

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

/** Adapts semantic application actions to the public @pierre/trees API. */
export function createFileTreeActionAdapter(model, onSelectFile) {
  return Object.freeze({
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
    [ApplicationAction.CURSOR_FIRST]: () => moveFocus(
      model,
      () => model.focusFirstItem(),
    ),
    [ApplicationAction.CURSOR_LAST]: () => moveFocus(
      model,
      () => model.focusLastItem(),
    ),
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
