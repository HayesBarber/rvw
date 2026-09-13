import { useCallback, useEffect, useMemo, useState } from 'react'

import { RequestStatus } from './request-state.js'

const idleClearRequest = Object.freeze({
  status: RequestStatus.IDLE,
  data: null,
  error: null,
})

export const CLEAR_MESSAGE_TIMEOUT_MS = 3_000

export function clearRequestMessage(request) {
  if (request.status === RequestStatus.LOADING) return 'Clearing…'
  if (request.status === RequestStatus.ERROR) return request.error
  if (request.status !== RequestStatus.SUCCESS) return ''
  const suffix = request.data.commentCount === 1 ? 'comment' : 'comments'
  return `Cleared ${request.data.commentCount} ${suffix}`
}

export function useClearComments() {
  const [request, setRequest] = useState(idleClearRequest)

  useEffect(() => {
    if (request.status !== RequestStatus.SUCCESS) return undefined

    const timeout = setTimeout(() => {
      setRequest(idleClearRequest)
    }, CLEAR_MESSAGE_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [request.status])

  const start = useCallback(() => {
    setRequest({
      status: RequestStatus.LOADING,
      data: null,
      error: null,
    })
  }, [])

  const succeed = useCallback((result) => {
    setRequest({
      status: RequestStatus.SUCCESS,
      data: result,
      error: null,
    })
  }, [])

  const fail = useCallback((error) => {
    setRequest({
      status: RequestStatus.ERROR,
      data: null,
      error: error.message,
    })
  }, [])

  const reset = useCallback(() => {
    setRequest(idleClearRequest)
  }, [])

  return useMemo(
    () => ({ ...request, start, succeed, fail, reset }),
    [fail, request, reset, start, succeed],
  )
}