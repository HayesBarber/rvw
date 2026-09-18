import { prepareFile } from './prepare-file.js'
import { activateFileLoad, attachFileLoad, beginFileLoad, cancelFileLoad, fileLoadStage, receivedFileLoad } from './file-load-performance.js'
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

export function fileRequestKey(diffId, path, changed, generation = 0) {
  if (!path || (changed && !diffId)) return null
  return `${generation}\u0000${changed ? diffId : 'file'}\u0000${path}`
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

export function useReviewFile({ diffId, path, changed, generation }) {
  const [request, setRequest] = useState(initialRequest)
  const key = fileRequestKey(diffId, path, changed, generation)

  const trace = useMemo(() => beginFileLoad(key, path), [key, path])

  useEffect(() => {
    if (!key) return undefined

    let active = true
    activateFileLoad(trace)
    fileLoadStage(trace, 'request_schedule', trace?.start)
    const pendingRequest = changed
      ? getFileDiff(diffId, path, trace)
      : getFile(path, trace)

    pendingRequest
      .then((file) => {
        if (active) {
          receivedFileLoad(trace)
          file = prepareFile(file, trace)
          attachFileLoad(file, trace)
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
          fileLoadStage(trace, 'request_failed', trace?.start)
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
      cancelFileLoad(trace)
    }
  }, [changed, diffId, generation, key, path, trace])

  return useMemo(
    () => selectFileRequest(request, key, path),
    [key, path, request],
  )
}
