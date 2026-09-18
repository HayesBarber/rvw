import { fileRendered } from '../../review/file-load-performance.js'
import { useCallback, useMemo } from 'react'
import { DEFAULT_VIRTUAL_FILE_METRICS } from '@pierre/diffs'
import { File, FileDiff, Virtualizer, useWorkerPool } from '@pierre/diffs/react'

const diffCursorCSS = `
  [data-line][data-editor-active-line],
  [data-column-number][data-editor-active-line] {
    --diffs-editor-active-line-source-mix: 68%;
  }

  [data-line][data-editor-active-line] {
    box-shadow: inset 0 1px color-mix(in lab, var(--diffs-modified-base) 45%, transparent),
      inset 0 -1px color-mix(in lab, var(--diffs-modified-base) 45%, transparent);
  }

  [data-diffs-header] {
    min-height: 52px;
  }

  [data-header-content], [data-title] {
    min-width: 0;
  }

  [data-title] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const baseOptions = {
  diffStyle: 'split',
  enableGutterUtility: true,
  enableLineSelection: true,
  lineHoverHighlight: 'line',
  stickyHeader: true,
  unsafeCSS: diffCursorCSS,
}

const metrics = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  diffHeaderHeight: 52,
}

export default function DiffSurface({
  expandUnchanged = false,
  fileDiff,
  lineAnnotations,
  selectedLines,
  renderAnnotation,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  onBeginComment,
  onPostRender,
  onSelectLines,
  wrapLines = true,
}) {
  const pool = useWorkerPool()
  const handlePostRender = useCallback((node, instance, phase) => {
    onPostRender?.(node, instance, phase)
    const highlighted = fileDiff.content.kind === 'diff'
      ? pool?.getDiffResultCache(fileDiff.parsedDiff) != null
      : pool?.getFileResultCache(fileDiff.content.file) != null
    fileRendered(fileDiff, node, phase, highlighted)
  }, [fileDiff, onPostRender, pool])
  const options = useMemo(() => ({
    ...baseOptions,
    expandUnchanged,
    overflow: wrapLines ? 'wrap' : 'scroll',
    onGutterUtilityClick: onBeginComment,
    // onLineSelected also fires for controlled prop writes. Only pointer
    // lifecycle callbacks should replace a keyboard selection.
    onLineSelectionStart: onSelectLines,
    onLineSelectionChange: onSelectLines,
    onLineSelectionEnd: onSelectLines,
    onPostRender: handlePostRender,
  }), [expandUnchanged, onBeginComment, handlePostRender, onSelectLines, wrapLines])

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <FileDiff
          key={expandUnchanged ? 'expanded' : 'collapsed'}
          fileDiff={fileDiff.parsedDiff}
          lineAnnotations={lineAnnotations}
          metrics={metrics}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
          renderHeaderMetadata={renderHeaderMetadata}
          options={options}
        />
      ) : (
        <File
          file={fileDiff.content.file}
          lineAnnotations={lineAnnotations}
          metrics={metrics}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
          renderHeaderMetadata={renderHeaderMetadata}
          options={options}
        />
      )}
    </Virtualizer>
  )
}
