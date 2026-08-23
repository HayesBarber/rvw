import { File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react'
import PaneStatus from './PaneStatus.jsx'

const diffOptions = {
  diffStyle: 'split',
}

export default function DiffPane({ fileReview, loading, error }) {
  if (loading) {
    return <PaneStatus>Loading file…</PaneStatus>
  }

  if (error) {
    return <PaneStatus>{error}</PaneStatus>
  }

  if (!fileReview) {
    return <PaneStatus>Select a file to view it.</PaneStatus>
  }

  return (
    <Virtualizer className="diff-scroll">
      {fileReview.content.kind === 'diff' ? (
        <MultiFileDiff
          oldFile={fileReview.content.oldFile}
          newFile={fileReview.content.newFile}
          options={diffOptions}
        />
      ) : (
        <File file={fileReview.content.file} />
      )}
    </Virtualizer>
  )
}

