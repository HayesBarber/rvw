import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  FileTree,
  useFileTree,
} from '@pierre/trees/react'
import {
  createFileTreeActionAdapter,
  fileTreeFocusCSS,
} from '../actions/file-tree-actions.js'

export default function FileTreePane({
  files,
  isCursorVisible,
  mode,
  onFocusDiffPane,
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
  })

  useEffect(
    () => registerActionAdapter(createFileTreeActionAdapter(
      model,
      onSelectFile,
      {
        focusDiffPane: onFocusDiffPane,
        showChanges: onShowChanges,
        showFiles: onShowFiles,
      },
    )),
    [
      model,
      onFocusDiffPane,
      onSelectFile,
      onShowChanges,
      onShowFiles,
      registerActionAdapter,
    ],
  )

  useEffect(() => {
    const selectedPaths = model.getSelectedPaths()
    if (
      selectedPaths.length === (selectedPath ? 1 : 0) &&
      selectedPaths[0] === selectedPath
    ) {
      return
    }

    synchronizingSelectionRef.current = true
    try {
      for (const path of selectedPaths) model.getItem(path)?.deselect()
      if (selectedPath && filePaths.has(selectedPath)) {
        model.getItem(selectedPath)?.select()
      }
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
