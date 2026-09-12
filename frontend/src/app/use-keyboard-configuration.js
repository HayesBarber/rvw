import { useEffect, useState } from 'react'

import { loadKeyboardConfiguration } from './keyboard-configuration.js'
import {
  DEFAULT_LEADER_KEY,
  defaultNormalKeymap,
} from '../actions/application-actions.js'

export function useKeyboardConfiguration(vimController) {
  const [state, setState] = useState({
    diagnostic: null,
    keymap: defaultNormalKeymap,
    leader: DEFAULT_LEADER_KEY,
  })

  useEffect(() => {
    let active = true

    loadKeyboardConfiguration().then((configuration) => {
      if (!active) return
      if (configuration.bindings) {
        vimController.setBindings(configuration.bindings)
      }
      setState((current) => ({
        diagnostic: configuration.diagnostic,
        keymap: configuration.keymap ?? current.keymap,
        leader: configuration.leader ?? current.leader,
      }))
    })

    return () => {
      active = false
    }
  }, [vimController])

  return state
}
