import { useLayoutEffect } from 'react'
import { blockingOverlayActions } from '../actions/overlay-actions.js'
import { trapOverlayFocus } from './overlay-focus.js'

/** Registers the overlay before keyboard input can reach the workspace. */
export default function Overlay({
  kind,
  actions = blockingOverlayActions,
  registerActionAdapter,
  dialogRef,
  initialFocusRef,
  navigationRef,
  onClose,
  labelledBy,
  className,
  backdropClassName,
  children,
}) {
  useLayoutEffect(() => registerActionAdapter(kind, actions), [
    actions,
    kind,
    registerActionAdapter,
  ])

  useLayoutEffect(() => {
    const previousFocus = document.activeElement
    initialFocusRef.current?.focus()
    return () => previousFocus?.focus()
  }, [initialFocusRef])

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    trapOverlayFocus(event, dialogRef.current, navigationRef?.current)
  }

  return (
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-vim-capture
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>
  )
}
