export function normalizeCommentRange(path, range, isDiff) {
  const startSide = range.side ?? range.endSide ?? 'additions'
  const endSide = range.endSide ?? startSide
  const crossesSides = isDiff && startSide !== endSide
  const startLine = crossesSides ? range.end : Math.min(range.start, range.end)
  const endLine = crossesSides ? range.end : Math.max(range.start, range.end)
  const side = endSide

  return {
    annotationSide: side,
    selection: isDiff
      ? { start: startLine, end: endLine, side, endSide: side }
      : { start: startLine, end: endLine },
    target: {
      kind: 'line',
      path,
      side: side === 'deletions' ? 'old' : 'new',
      startLine,
      endLine,
    },
  }
}

export function commentTargetLabel(target) {
  if (target.kind === 'file') return `File comment on ${target.path}`

  const side = target.side === 'old' ? 'old' : 'new'
  const lines = target.startLine === target.endLine
    ? `line ${target.startLine}`
    : `lines ${target.startLine}–${target.endLine}`
  return `Comment on ${side} ${lines}`
}

export function commentAnnotation(comment, isDiff, fallbackSide) {
  const lineNumber = comment.target.kind === 'line' ? comment.target.endLine : 0
  const metadata = { kind: 'comment', comment }
  if (!isDiff) return { lineNumber, metadata }

  const side = comment.target.kind === 'line'
    ? (comment.target.side === 'old' ? 'deletions' : 'additions')
    : fallbackSide
  return { lineNumber, side, metadata }
}

export function createCommentAnnotations(fileDiff, comments, draft) {
  if (!fileDiff) return []

  const isDiff = fileDiff.content.kind === 'diff'
  const fallbackSide = isDiff && !fileDiff.content.newFile
    ? 'deletions'
    : 'additions'
  const annotations = comments
    .filter((comment) => comment.target.path === fileDiff.path)
    .map((comment) => commentAnnotation(comment, isDiff, fallbackSide))

  if (!draft) return annotations

  const lineNumber = draft.target.kind === 'line' ? draft.target.endLine : 0
  const annotation = {
    lineNumber,
    metadata: { kind: 'draft', draft },
  }
  if (!isDiff) return [...annotations, annotation]

  const side = draft.target.kind === 'line'
    ? draft.annotationSide
    : fallbackSide
  return [...annotations, { ...annotation, side }]
}
