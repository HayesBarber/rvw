import { useMemo } from 'react'
import { DEFAULT_VIRTUAL_FILE_METRICS } from '@pierre/diffs'
import { File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react'

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
  const options = useMemo(() => ({
    ...baseOptions,
    expandUnchanged,
    overflow: wrapLines ? 'wrap' : 'scroll',
    onGutterUtilityClick: onBeginComment,
    onLineSelected: onSelectLines,
    onLineSelectionChange: onSelectLines,
    onLineSelectionEnd: onSelectLines,
    onPostRender,
  }), [expandUnchanged, onBeginComment, onPostRender, onSelectLines, wrapLines])

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <MultiFileDiff
          key={expandUnchanged ? 'expanded' : 'collapsed'}
          oldFile={fileDiff.content.oldFile}
          newFile={fileDiff.content.newFile}
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
