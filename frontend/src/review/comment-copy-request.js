import { useCallback, useMemo } from 'react'

import { copyCommentsAsMarkdown } from './api.js'
import { RequestStatus } from './request-state.js'
import { transientRequestMessage, useTransientRequest } from './transient-request.js'

export const copyRequestMessage = (request) => transientRequestMessage(request, {
  inProgress: 'Copying…',
  completed: 'Copied',
})

export function copyRequestButtonLabel(request) {
  if (request.status === RequestStatus.LOADING) return 'Copying…'
  if (request.status === RequestStatus.SUCCESS) return 'Copied'
  return 'Copy as Markdown'
}

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
