import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getFiles } from './api.js'
import { RequestStatus } from './request-state.js'

export function createLatestRequestTracker() {
  let latestRequest = 0
  return Object.freeze({
    begin() {
      latestRequest += 1
      return latestRequest
    },
    invalidate() {
      latestRequest += 1
    },
    isCurrent(requestId) {
      return requestId === latestRequest
    },
  })
}

export function useRepositoryFiles() {
  const [request, setRequest] = useState({
    status: RequestStatus.IDLE,
    data: [],
    error: null,
  })
  const requestTracker = useRef(createLatestRequestTracker())

  useEffect(() => () => {
    requestTracker.current.invalidate()
  }, [])

  const load = useCallback(() => {
    const requestId = requestTracker.current.begin()
    setRequest((current) => ({
      status: RequestStatus.LOADING,
      data: current.data,
      error: null,
    }))
    getFiles()
      .then((paths) => {
        if (requestTracker.current.isCurrent(requestId)) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: paths,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (requestTracker.current.isCurrent(requestId)) {
          setRequest((current) => ({
            status: RequestStatus.ERROR,
            data: current.data,
            error: error.message,
          }))
        }
      })
  }, [])

  return useMemo(() => ({ ...request, load }), [load, request])
}
