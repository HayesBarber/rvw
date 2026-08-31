import { useEffect, useRef, useState } from 'react'

import { fileTreeWidthFromPointer } from '../app/file-tree-resize.js'

export default function FileTreeDivider({ shellRef, width, onResize }) {
  const activePointer = useRef(null)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return undefined

    const resizeAtPointer = (event) => {
      if (event.pointerId !== activePointer.current) return

      event.preventDefault()
      event.stopPropagation()
      const shell = shellRef.current
      if (!shell) return

      const nextWidth = fileTreeWidthFromPointer(
        event.clientX,
        shell.getBoundingClientRect().left,
      )
      if (nextWidth !== null) onResize(nextWidth)
    }
    const finishResize = (event) => {
      if (event.pointerId !== activePointer.current) return

      event.preventDefault()
      event.stopPropagation()
      activePointer.current = null
      setResizing(false)
    }

    window.addEventListener('pointermove', resizeAtPointer)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    return () => {
      window.removeEventListener('pointermove', resizeAtPointer)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }
  }, [onResize, resizing, shellRef])

  return (
    <div
      className="file-tree-divider"
      data-resizing={resizing || undefined}
      role="separator"
      aria-label="Resize file tree"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      onPointerDown={(event) => {
        if (event.button !== 0 || activePointer.current !== null) return

        event.preventDefault()
        event.stopPropagation()
        activePointer.current = event.pointerId
        setResizing(true)
        const shell = shellRef.current
        if (!shell) return
        const nextWidth = fileTreeWidthFromPointer(
          event.clientX,
          shell.getBoundingClientRect().left,
        )
        if (nextWidth !== null) onResize(nextWidth)
      }}
    />
  )
}
