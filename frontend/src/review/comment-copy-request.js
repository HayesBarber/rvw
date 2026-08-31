import { useCallback, useMemo, useState } from 'react'

import { copyCommentsAsMarkdown } from './api.js'
import { RequestStatus } from './request-state.js'

const idleCopyRequest = Object.freeze({
  status: RequestStatus.IDLE,
  data: null,
  error: null,
})

export function copyRequestMessage(request) {
  if (request.status === RequestStatus.LOADING) return 'Copying…'
  if (request.status === RequestStatus.ERROR) return request.error
  if (request.status !== RequestStatus.SUCCESS) return ''
  const suffix = request.data.commentCount === 1 ? 'comment' : 'comments'
  return `Copied ${request.data.commentCount} ${suffix}`
}

export function useCopyComments() {
  const [request, setRequest] = useState(idleCopyRequest)

  const copy = useCallback(async () => {
    setRequest({
      status: RequestStatus.LOADING,
      data: null,
      error: null,
    })
    try {
      const result = await copyCommentsAsMarkdown()
      setRequest({
        status: RequestStatus.SUCCESS,
        data: result,
        error: null,
      })
      return result
    } catch (error) {
      setRequest({
        status: RequestStatus.ERROR,
        data: null,
        error: error.message,
      })
      throw error
    }
  }, [])

  const reset = useCallback(() => {
    setRequest(idleCopyRequest)
  }, [])

  return useMemo(
    () => ({ ...request, copy, reset }),
    [copy, request, reset],
  )
}
