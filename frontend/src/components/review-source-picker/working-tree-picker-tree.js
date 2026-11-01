import { orderedFilePaths } from '../../actions/file-navigation-actions.js'
import { fileTreeFocusCSS } from '../../actions/file-tree-actions.js'

/** Use the Changes tree layout, with file summaries in its decoration lane. */
export function workingTreePickerTreeOptions(files) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  return {
    paths: orderedFilePaths(files),
    presorted: true,
    gitStatus: files.filter((file) => file.status !== 'unchanged')
      .map(({ path, status }) => ({ path, status })),
    initialExpansion: 'open',
    unsafeCSS: `${fileTreeFocusCSS}
      [data-item-section='decoration'] {
        white-space: pre;
        font-variant-numeric: tabular-nums;
      }
    `,
    renderRowDecoration({ item }) {
      const file = byPath.get(item.path)
      if (!file || item.kind !== 'file') return null
      const additions = file.additions == null ? '+—' : `+${file.additions}`
      const deletions = file.deletions == null ? '−—' : `−${file.deletions}`
      const previousPathLabel = file.previousPath == null ? '' : `From ${file.previousPath}  `
      return {
        text: `${previousPathLabel}${additions} ${deletions}`,
        title: `${file.path}: ${file.status}. ${previousPathLabel}Added: ${file.additions ?? 'Unavailable'}. Deleted: ${file.deletions ?? 'Unavailable'}.`,
        parts: [
          { text: previousPathLabel },
          { text: additions, color: 'var(--trees-git-added-color)' },
          { text: `\u00a0${deletions}`, color: 'var(--trees-git-deleted-color)' },
        ],
      }
    },
  }
}
