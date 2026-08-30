import { useMemo } from 'react'
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
`

const baseOptions = {
  diffStyle: 'split',
  enableGutterUtility: true,
  enableLineSelection: true,
  lineHoverHighlight: 'line',
  unsafeCSS: diffCursorCSS,
}

export default function DiffSurface({
  fileDiff,
  lineAnnotations,
  selectedLines,
  renderAnnotation,
  onBeginComment,
  onPostRender,
  onSelectLines,
}) {
  const options = useMemo(() => ({
    ...baseOptions,
    onGutterUtilityClick: onBeginComment,
    onLineSelected: onSelectLines,
    onLineSelectionChange: onSelectLines,
    onLineSelectionEnd: onSelectLines,
    onPostRender,
  }), [onBeginComment, onPostRender, onSelectLines])

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <MultiFileDiff
          oldFile={fileDiff.content.oldFile}
          newFile={fileDiff.content.newFile}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      ) : (
        <File
          file={fileDiff.content.file}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      )}
    </Virtualizer>
  )
}
