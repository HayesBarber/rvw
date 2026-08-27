import { useEffect, useState } from 'react'
import { VimContext } from './context.js'
import { attachVimKeyboardCapture } from './keyboard.js'
import { VimController, VimMode } from './machine.js'

const emptyBindings = Object.freeze([])

/**
 * Provides Vim state and keyboard capture.
 */
export function VimProvider({
  bindings = emptyBindings,
  children,
  initialMode = VimMode.NORMAL,
  keyboardTarget,
  onCommand,
}) {
  const [controller] = useState(
    () => new VimController({ bindings, initialMode }),
  )

  useEffect(() => {
    controller.setBindings(bindings)
  }, [bindings, controller])

  useEffect(() => {
    if (!onCommand) return undefined
    return controller.subscribeCommands(onCommand)
  }, [controller, onCommand])

  useEffect(() => {
    const target = keyboardTarget ??
      (typeof document === 'undefined' ? null : document)
    if (!target) return undefined
    return attachVimKeyboardCapture({ target, dispatch: controller.dispatch })
  }, [controller, keyboardTarget])

  return <VimContext value={controller}>{children}</VimContext>
}
