import { useCallback, useEffect, useState } from 'react'
import { createVisualSelection } from '../../actions/visual-selection.js'
import { useVimController, VimMode } from '../../vim/index.js'

export default function useVisualSelection({ cursor, selectLines, onMouseSelect, enabled }) {
  const controller = useVimController()
  const [selection] = useState(createVisualSelection)
  const clear = useCallback(() => {
    if (selection.side === undefined) return
    selection.clear()
    selectLines(null)
  }, [selectLines, selection])

  useEffect(() => controller.subscribe(() => {
    if (controller.getSnapshot().mode !== VimMode.VISUAL) clear()
  }), [clear, controller])

  useEffect(() => {
    if (!enabled) {
      clear()
      controller.dispatch({ type: 'set_mode', mode: VimMode.NORMAL })
    }
  }, [clear, controller, enabled])

  useEffect(() => () => {
    controller.dispatch({ type: 'set_mode', mode: VimMode.NORMAL })
  }, [controller])

  const toggle = useCallback(() => {
    if (controller.getSnapshot().mode === VimMode.VISUAL) {
      controller.dispatch({ type: 'set_mode', mode: VimMode.NORMAL })
      return true
    }
    if (!enabled) return false
    const range = selection.begin(cursor.getRows(), cursor.getCursor())
    if (!range) return false
    controller.dispatch({ type: 'set_mode', mode: VimMode.VISUAL })
    selectLines(range)
    return true
  }, [controller, cursor, enabled, selectLines, selection])

  const getRows = useCallback(() => selection.rows(cursor.getRows()), [cursor, selection])
  const getPreferredSide = useCallback(() => selection.side, [selection])
  const activateCursor = useCallback((next) => {
    if (!cursor.activateCursor(next)) return false
    const range = selection.extend(next)
    if (range) selectLines(range)
    return true
  }, [cursor, selectLines, selection])

  const selectMouseLines = useCallback((range) => {
    controller.dispatch({ type: 'set_mode', mode: VimMode.NORMAL })
    onMouseSelect(range)
  }, [controller, onMouseSelect])

  return { toggle, getRows, getPreferredSide, activateCursor, selectMouseLines }
}
