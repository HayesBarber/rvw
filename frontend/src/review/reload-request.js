import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { reloadReview } from './api.js'
import { RequestStatus } from './request-state.js'
import { MESSAGE_TIMEOUT_MS } from './transient-request.js'

const idleRequest = Object.freeze({
  status: RequestStatus.IDLE,
  data: null,
  error: null,
})

export function reloadRequestMessage(request) {
  if (request.status === RequestStatus.LOADING) return 'Reloading…'
  if (request.status === RequestStatus.ERROR) return request.error
  if (request.status === RequestStatus.SUCCESS) return 'Review reloaded'
  return ''
}

export function useReloadReview({ hasUnsavedDraft, onReloaded }) {
  const [request, setRequest] = useState(idleRequest)
  const pending = useRef(false)

  useEffect(() => {
    if (request.status !== RequestStatus.SUCCESS) return undefined
    const timeout = setTimeout(() => setRequest(idleRequest), MESSAGE_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [request.status])

  const reload = useCallback(() => {
    if (pending.current) return true
    if (hasUnsavedDraft) {
      setRequest({
        status: RequestStatus.ERROR,
        data: null,
        error: 'Finish or cancel the comment draft before reloading.',
      })
      return true
    }

    pending.current = true
    setRequest({ status: RequestStatus.LOADING, data: null, error: null })
    reloadReview().then(async (result) => {
      await onReloaded(result)
      setRequest({ status: RequestStatus.SUCCESS, data: result, error: null })
    }).catch((error) => {
      setRequest({ status: RequestStatus.ERROR, data: null, error: error.message })
    }).finally(() => {
      pending.current = false
    })
    return true
  }, [hasUnsavedDraft, onReloaded])

  return useMemo(() => ({ ...request, reload }), [reload, request])
}
