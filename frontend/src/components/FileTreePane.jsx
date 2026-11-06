import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  FileTree,
  useFileTree,
} from '@pierre/trees/react'
import {
  createFileTreeActionAdapter,
  fileTreeFocusCSS,
} from '../actions/file-tree-actions.js'
import { synchronizeFileTreeSelection } from './file-tree-selection.js'
import { fileViewedDecoration } from './file-viewed-decoration.js'

export default function FileTreePane({
  files,
  viewedPaths,
  isCursorVisible,
  mode,
  onFocusDiffPane,
  onCopyFilePath,
  selectedPath,
  onSelectFile,
  onShowChanges,
  onShowFiles,
  registerActionAdapter,
}) {
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
  const filePathsRef = useRef(filePaths)
  const onSelectFileRef = useRef(onSelectFile)
  const synchronizingSelectionRef = useRef(false)
  const viewedPathsRef = useRef(new Set(viewedPaths))

  useEffect(() => {
    filePathsRef.current = filePaths
    onSelectFileRef.current = onSelectFile
  }, [filePaths, onSelectFile])

  const handleSelectionChange = useCallback((selectedPaths) => {
    if (synchronizingSelectionRef.current) return
    const nextPath = selectedPaths.findLast(
      (path) => filePathsRef.current.has(path),
    )
    if (nextPath) onSelectFileRef.current(nextPath)
  }, [])

  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    gitStatus,
    initialExpansion: mode === 'changes' ? 'open' : 'closed',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange: handleSelectionChange,
    unsafeCSS: fileTreeFocusCSS,
    renderRowDecoration: ({ item }) => fileViewedDecoration(item, viewedPathsRef.current),
  })

  useEffect(() => {
    viewedPathsRef.current = new Set(viewedPaths)
    // Refresh decorations through the public rendering API without resetting tree state.
    model.setComposition(model.getComposition())
  }, [model, viewedPaths])

  useEffect(
    () => registerActionAdapter(createFileTreeActionAdapter(
      model,
      onSelectFile,
      {
        focusDiffPane: onFocusDiffPane,
        copyFilePath: onCopyFilePath,
        showChanges: onShowChanges,
        showFiles: onShowFiles,
      },
    )),
    [
      model,
      onFocusDiffPane,
      onCopyFilePath,
      onSelectFile,
      onShowChanges,
      onShowFiles,
      registerActionAdapter,
    ],
  )

  useEffect(() => {
    synchronizingSelectionRef.current = true
    try {
      synchronizeFileTreeSelection(model, filePaths, selectedPath)
    } finally {
      synchronizingSelectionRef.current = false
    }
  }, [filePaths, model, selectedPath])

  return (
    <FileTree
      model={model}
      className="file-tree"
      data-cursor-visible={isCursorVisible ? 'true' : undefined}
    />
  )
}
