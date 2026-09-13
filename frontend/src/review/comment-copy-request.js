import { useCallback, useMemo } from 'react'

import { copyCommentsAsMarkdown } from './api.js'
import { transientRequestMessage, useTransientRequest } from './transient-request.js'

export const copyRequestMessage = (request) => transientRequestMessage(request, {
  inProgress: 'Copying…',
  completed: 'Copied',
})

export function useCopyComments() {
  const transient = useTransientRequest()

  const copy = useCallback(async () => {
    transient.start()
    try {
      const result = await copyCommentsAsMarkdown()
      transient.succeed(result)
      return result
    } catch (error) {
      transient.fail(error)
      throw error
    }
  }, [transient])

  return useMemo(
    () => ({ ...transient, copy }),
    [copy, transient],
  )
}
