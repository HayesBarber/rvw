import { useLayoutEffect, useRef } from 'react'
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
  nativeDialog = false,
  modal = true,
  trapFocus = modal,
  onKeyDown,
  children,
}) {
  const registrationRef = useRef(null)
  useLayoutEffect(() => {
    const registration = registerActionAdapter(kind)
    registrationRef.current = registration
    return () => registration.unregister()
  }, [kind, registerActionAdapter])

  useLayoutEffect(() => {
    registrationRef.current.update(actions)
  }, [actions, kind, registerActionAdapter])

  useLayoutEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    if (nativeDialog) dialog.showModal()
    initialFocusRef.current?.focus({ preventScroll: true })
    return () => {
      if (nativeDialog) dialog.close()
      previousFocus?.focus({ preventScroll: true })
    }
  }, [dialogRef, initialFocusRef, nativeDialog])

  function handleKeyDown(event) {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      if (nativeDialog && event.repeat) return
      onClose()
      return
    }
    if (trapFocus) trapOverlayFocus(event, dialogRef.current, navigationRef?.current)
  }

  if (nativeDialog) {
    return (
      <dialog
        ref={dialogRef}
        className={className}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-vim-capture
        onKeyDown={handleKeyDown}
        onCancel={(event) => {
          event.preventDefault()
          onClose()
        }}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return
          const bounds = event.currentTarget.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
        }}
      >
        {children}
      </dialog>
    )
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
        aria-modal={modal ? 'true' : undefined}
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
