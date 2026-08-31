import { useEffect, useMemo, useState } from 'react'

import { getFile, getFileDiff } from './api.js'
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

export function fileRequestKey(diffId, path, changed) {
  if (!path || (changed && !diffId)) return null
  return `${changed ? diffId : 'file'}\u0000${path}`
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

export function useReviewFile({ diffId, path, changed }) {
  const [request, setRequest] = useState(initialRequest)
  const key = fileRequestKey(diffId, path, changed)

  useEffect(() => {
    if (!key) return undefined

    let active = true
    const pendingRequest = changed
      ? getFileDiff(diffId, path)
      : getFile(path)

    pendingRequest
      .then((file) => {
        if (active) {
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
    }
  }, [changed, diffId, key, path])

  return useMemo(
    () => selectFileRequest(request, key, path),
    [key, path, request],
  )
}
