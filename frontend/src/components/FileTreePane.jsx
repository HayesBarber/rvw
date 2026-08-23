import { useEffect, useMemo } from 'react'
import {
  FileTree,
  useFileTree,
  useFileTreeSelection,
} from '@pierre/trees/react'

export default function FileTreePane({ files, selectedPath, onSelectFile }) {
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
    initialExpandedPaths: ['src', 'src/app'],
    initialSelectedPaths: [selectedPath],
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

