import { ApplicationAction } from './application-actions.js'

export const RenderableFileKind = Object.freeze({
  DIFF: 'diff',
  FILE: 'file',
})

/** Builds path-copy actions for the file opened by the diff surface. */
export function createDiffFilePathActionAdapter({ filePath, copyFilePath }) {
  const copy = (format) => Boolean(
    filePath && copyFilePath(filePath, format),
  )
  return {
    [ApplicationAction.COPY_FILE_PATH_RELATIVE]: () => copy('relative'),
    [ApplicationAction.COPY_FILE_PATH_ABSOLUTE]: () => copy('absolute'),
  }
}

/** Builds display actions that are valid only for the currently rendered text view. */
export function createDiffViewActionAdapter({
  contentKind,
  prepareLayoutChange,
  toggleExpandUnchanged,
  toggleRelativeLineNumbers,
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
    [ApplicationAction.DIFF_RELATIVE_LINE_NUMBERS_TOGGLE]: () => (
      (contentKind === RenderableFileKind.DIFF ||
        contentKind === RenderableFileKind.FILE) &&
      (toggleRelativeLineNumbers(), true)
    ),
    [ApplicationAction.DIFF_WRAP_TOGGLE]: () => (
      (contentKind === RenderableFileKind.DIFF ||
        contentKind === RenderableFileKind.FILE) &&
      applyLayoutChange(toggleWrapLines)
    ),
  }
}
