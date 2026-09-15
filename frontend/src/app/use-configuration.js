import { useEffect, useState } from 'react'

import {
  DEFAULT_RELATIVE_LINE_NUMBERS,
  DEFAULT_WRAP_LINES,
  loadConfiguration,
} from './configuration.js'
import {
  DEFAULT_LEADER_KEY,
  defaultNormalKeymap,
} from '../actions/application-actions.js'

export function useConfiguration(vimController) {
  const [state, setState] = useState({
    diagnostic: null,
    keymap: defaultNormalKeymap,
    leader: DEFAULT_LEADER_KEY,
    relativeLineNumbers: DEFAULT_RELATIVE_LINE_NUMBERS,
    wrapLines: DEFAULT_WRAP_LINES,
  })

  useEffect(() => {
    let active = true

    loadConfiguration().then((configuration) => {
      if (!active) return
      if (configuration.bindings) {
        vimController.setBindings(configuration.bindings)
      }
      setState((current) => ({
        diagnostic: configuration.diagnostic,
        keymap: configuration.keymap ?? current.keymap,
        leader: configuration.leader ?? current.leader,
        relativeLineNumbers: configuration.relativeLineNumbers ?? current.relativeLineNumbers,
        wrapLines: configuration.wrapLines ?? current.wrapLines,
      }))
    })

    return () => {
      active = false
    }
  }, [vimController])

  return state
}
