export function fileViewedDecoration(item, viewedPaths) {
  return item.kind === 'file' && viewedPaths.has(item.path)
    ? { text: '✓', title: 'Viewed' }
    : null
}
