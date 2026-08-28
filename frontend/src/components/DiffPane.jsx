import { File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react'
import PaneStatus from './PaneStatus.jsx'

const diffOptions = {
  diffStyle: 'split',
}

export default function DiffPane({ fileDiff, loading, error }) {
  if (loading) {
    return <PaneStatus>Loading file…</PaneStatus>
  }

  if (error) {
    return <PaneStatus>{error}</PaneStatus>
  }

  if (!fileDiff) {
    return <PaneStatus>Select a file to view it.</PaneStatus>
  }

  if (fileDiff.content.kind === 'unavailable') {
    const descriptions = {
      binary: 'Binary file contents cannot be displayed.',
      'invalid-utf8': 'This file is not valid UTF-8 text.',
      'too-large': 'This file is larger than the 512 KiB review limit.',
      symlink: 'Symbolic link changes cannot be displayed.',
      submodule: 'Submodule changes cannot be displayed.',
    }
    return <PaneStatus>{descriptions[fileDiff.content.reason]}</PaneStatus>
  }

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <MultiFileDiff
          oldFile={fileDiff.content.oldFile}
          newFile={fileDiff.content.newFile}
          options={diffOptions}
        />
      ) : (
        <File file={fileDiff.content.file} />
      )}
    </Virtualizer>
  )
}
