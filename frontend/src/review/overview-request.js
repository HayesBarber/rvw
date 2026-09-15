import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { measureOverviewRequest } from './log.js'
import { getDiffOverview } from './api.js'
import { RequestStatus } from './request-state.js'

const loadingOverview = Object.freeze({
  status: RequestStatus.LOADING,
  data: null,
  error: null,
})

export function useReviewOverview() {
  const [request, setRequest] = useState(loadingOverview)
  const latestRequest = useRef(0)

  const load = useCallback(() => {
    const requestId = ++latestRequest.current
    setRequest((current) => ({
      status: RequestStatus.LOADING,
      data: current.data,
      error: null,
    }))
    return measureOverviewRequest(getDiffOverview)
      .then((overview) => {
        if (requestId === latestRequest.current) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: overview,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (requestId === latestRequest.current) {
          setRequest((current) => ({
            status: RequestStatus.ERROR,
            data: current.data,
            error: error.message,
          }))
        }
      })
  }, [])

  useEffect(() => {
    const requestId = ++latestRequest.current
    measureOverviewRequest(getDiffOverview)
      .then((overview) => {
        if (requestId === latestRequest.current) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: overview,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (requestId === latestRequest.current) {
          setRequest({
            status: RequestStatus.ERROR,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      latestRequest.current += 1
    }
  }, [])

  return useMemo(() => ({ ...request, load }), [load, request])
}
