import { ApplicationAction } from './application-actions.js'

export const RenderableFileKind = Object.freeze({
  DIFF: 'diff',
  FILE: 'file',
})

/** Builds display actions that are valid only for the currently rendered text view. */
export function createDiffViewActionAdapter({
  contentKind,
  prepareLayoutChange,
  toggleExpandUnchanged,
  toggleWrapLines,
}) {
  const applyLayoutChange = (toggle) => {
    prepareLayoutChange()
    toggle()
    return true
  }

  return {
    [ApplicationAction.DIFF_EXPAND_TOGGLE]: () => (
      contentKind === RenderableFileKind.DIFF &&
      applyLayoutChange(toggleExpandUnchanged)
    ),
    [ApplicationAction.DIFF_WRAP_TOGGLE]: () => (
      (contentKind === RenderableFileKind.DIFF ||
        contentKind === RenderableFileKind.FILE) &&
      applyLayoutChange(toggleWrapLines)
    ),
  }
}
