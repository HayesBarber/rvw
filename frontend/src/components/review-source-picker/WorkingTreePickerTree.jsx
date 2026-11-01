import { useLayoutEffect } from 'react'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { createFileTreeActionAdapter } from '../../actions/file-tree-actions.js'
import { workingTreePickerTreeOptions } from './working-tree-picker-tree.js'

export default function WorkingTreePickerTree({ files, registerActionAdapter }) {
  const { model } = useFileTree({
    ...workingTreePickerTreeOptions(files),
    // Rows summarize the whole source. No file is selected for review.
    onSelectionChange(paths) {
      for (const path of paths) model.getItem(path)?.deselect()
    },
  })

  useLayoutEffect(() => registerActionAdapter(createFileTreeActionAdapter(model, () => {})), [model, registerActionAdapter])

  return (
    <FileTree
      model={model}
      className="working-tree-picker-files"
      aria-label="Working tree changes"
      tabIndex={0}
      data-cursor-visible="true"
    />
  )
}
