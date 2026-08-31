import { useEffect, useState } from 'react'

import { loadKeyboardConfiguration } from './keyboard-configuration.js'

export function useKeyboardConfiguration(vimController) {
  const [diagnostic, setDiagnostic] = useState(null)

  useEffect(() => {
    let active = true

    loadKeyboardConfiguration().then((configuration) => {
      if (!active) return
      if (configuration.bindings) {
        vimController.setBindings(configuration.bindings)
      }
      setDiagnostic(configuration.diagnostic)
    })

    return () => {
      active = false
    }
  }, [vimController])

  return diagnostic
}
