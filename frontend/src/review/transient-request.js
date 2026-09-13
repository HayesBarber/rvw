import { useCallback, useEffect, useMemo, useState } from 'react'

import { RequestStatus } from './request-state.js'

export const MESSAGE_TIMEOUT_MS = 3_000

export const idleTransientRequest = Object.freeze({
  status: RequestStatus.IDLE,
  data: null,
  error: null,
})

export function transientRequestMessage(request, { inProgress, completed }) {
  if (request.status === RequestStatus.LOADING) return inProgress
  if (request.status === RequestStatus.ERROR) return request.error
  if (request.status !== RequestStatus.SUCCESS) return ''
  const suffix = request.data.commentCount === 1 ? 'comment' : 'comments'
  return `${completed} ${request.data.commentCount} ${suffix}`
}

export function useTransientRequest() {
  const [request, setRequest] = useState(idleTransientRequest)

  useEffect(() => {
    if (request.status !== RequestStatus.SUCCESS) return undefined

    const timeout = setTimeout(() => {
      setRequest(idleTransientRequest)
    }, MESSAGE_TIMEOUT_MS)
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
    setRequest(idleTransientRequest)
  }, [])

  return useMemo(
    () => ({ ...request, start, succeed, fail, reset }),
    [fail, request, reset, start, succeed],
  )
}
