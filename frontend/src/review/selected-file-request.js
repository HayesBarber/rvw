import { startFileTiming } from './file-timing.js'
import { useEffect, useMemo, useState } from 'react'

import { createReviewFileCache } from './file-cache.js'
import { RequestStatus } from './request-state.js'

const idleFileRequest = Object.freeze({
  status: RequestStatus.IDLE,
  path: null,
  data: null,
  error: null,
})

const initialRequest = Object.freeze({
  ...idleFileRequest,
  key: null,
})

export function fileRequestKey(diffId, path, changed, generation = 0) {
  if (!path || (changed && !diffId)) return null
  return JSON.stringify([diffId, generation, changed === true, path])
}

export function selectFileRequest(request, key, path) {
  if (!key) return idleFileRequest
  if (request.key !== key) {
    return {
      status: RequestStatus.LOADING,
      path,
      data: null,
      error: null,
    }
  }
  return {
    status: request.status,
    path: request.path,
    data: request.data,
    error: request.error,
  }
}

export function useReviewFile({ diffId, path, changed, generation, cache: providedCache, paths, changedPaths }) {
  const [cache] = useState(() => providedCache ?? createReviewFileCache())
  const [request, setRequest] = useState(initialRequest)
  const key = fileRequestKey(diffId, path, changed, generation)

  useEffect(() => () => cache.invalidate(), [cache, diffId, generation])

  useEffect(() => {
    if (!key) return undefined

    let active = true
    const timing = startFileTiming(path, changed)
    const pendingRequest = cache.load({ diffId, path, changed, generation }, timing)

    pendingRequest
      .then((file) => {
        if (active && file) {
          timing?.attach(file)
          setRequest({
            status: RequestStatus.SUCCESS,
            key,
            path,
            data: file,
            error: null,
          })
        }
      })
      .catch((error) => {
        timing?.finish('error')
        if (active) {
          setRequest({
            status: RequestStatus.ERROR,
            key,
            path,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      active = false
      timing?.finish('superseded')
    }
  }, [cache, changed, diffId, generation, key, path])

  useEffect(() => {
    if (key && paths && changedPaths) {
      cache.warm({ diffId, path, changed, generation }, paths, changedPaths)
    }
    return () => cache.stopWarming()
  }, [cache, key, diffId, path, changed, generation, paths, changedPaths])

  return useMemo(
    () => selectFileRequest(request, key, path),
    [key, path, request],
  )
}
