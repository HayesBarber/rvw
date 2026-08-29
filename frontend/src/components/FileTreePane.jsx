import { useEffect, useMemo } from 'react'
import {
  FileTree,
  useFileTree,
  useFileTreeSelection,
} from '@pierre/trees/react'

export default function FileTreePane({ files, mode, selectedPath, onSelectFile }) {
  const filePaths = useMemo(
    () => new Set(files.map((file) => file.path)),
    [files],
  )
  const gitStatus = useMemo(
    () =>
      files
        .filter((file) => file.status !== 'unchanged')
        .map((file) => ({ path: file.path, status: file.status })),
    [files],
  )
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    gitStatus,
    initialExpansion: mode === 'changes' ? 'open' : 'closed',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
  })
  const selectedPaths = useFileTreeSelection(model)

  useEffect(() => {
    const nextPath = selectedPaths.findLast((path) => filePaths.has(path))
    if (nextPath && nextPath !== selectedPath) {
      onSelectFile(nextPath)
    }
  }, [filePaths, onSelectFile, selectedPath, selectedPaths])

  return <FileTree model={model} className="file-tree" />
}
