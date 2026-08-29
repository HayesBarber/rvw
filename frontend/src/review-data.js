import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  copyCommentsAsMarkdown,
  createComment,
  getComments,
  getDiffOverview,
  getFile,
  getFileDiff,
  getFiles,
} from './api.js'

export const RequestStatus = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
})

const loadingRequest = Object.freeze({
  status: RequestStatus.LOADING,
  data: null,
  error: null,
})

export function useReviewOverview() {
  const [request, setRequest] = useState(loadingRequest)

  useEffect(() => {
    let active = true

    getDiffOverview()
      .then((overview) => {
        if (active) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: overview,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (active) {
          setRequest({
            status: RequestStatus.ERROR,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  return request
}

export function useRepositoryFiles() {
  const [request, setRequest] = useState({
    status: RequestStatus.IDLE,
    data: [],
    error: null,
  })
  const latestRequest = useRef(0)

  useEffect(() => () => {
    latestRequest.current += 1
  }, [])

  const load = useCallback(() => {
    const requestId = ++latestRequest.current
    setRequest((current) => ({
      status: RequestStatus.LOADING,
      data: current.data,
      error: null,
    }))
    getFiles()
      .then((paths) => {
        if (requestId === latestRequest.current) {
          setRequest({
            status: RequestStatus.SUCCESS,
            data: paths,
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

  return useMemo(() => ({ ...request, load }), [load, request])
}

function fileRequestKey(diffId, path, changed) {
  if (!path || (changed && !diffId)) return null
  return `${changed ? diffId : 'file'}\u0000${path}`
}

export function useReviewFile({ diffId, path, changed }) {
  const [request, setRequest] = useState({
    status: RequestStatus.IDLE,
    key: null,
    path: null,
    data: null,
    error: null,
  })
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

  return useMemo(() => {
    if (!key) {
      return {
        status: RequestStatus.IDLE,
        path: null,
        data: null,
        error: null,
      }
    }
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
  }, [key, path, request])
}

function mergeComments(serverComments, currentComments) {
  const comments = [...serverComments]
  const ids = new Set(serverComments.map((comment) => comment.id))
  for (const comment of currentComments) {
    if (!ids.has(comment.id)) comments.push(comment)
  }
  return comments
}

export function useReviewComments() {
  const [request, setRequest] = useState({
    status: RequestStatus.LOADING,
    data: [],
    error: null,
  })

  useEffect(() => {
    let active = true

    getComments()
      .then((comments) => {
        if (active) {
          setRequest((current) => ({
            status: RequestStatus.SUCCESS,
            data: mergeComments(comments, current.data),
            error: null,
          }))
        }
      })
      .catch((error) => {
        if (active) {
          setRequest((current) => ({
            status: RequestStatus.ERROR,
            data: current.data,
            error: error.message,
          }))
        }
      })

    return () => {
      active = false
    }
  }, [])

  const create = useCallback(async (body, target, beforeCommit) => {
    const comment = await createComment(body, target)
    beforeCommit?.()
    setRequest((current) => ({
      ...current,
      data: current.data.some((existing) => existing.id === comment.id)
        ? current.data
        : [...current.data, comment],
    }))
    return comment
  }, [])

  return useMemo(() => ({ ...request, create }), [create, request])
}

export function useCopyComments() {
  const [request, setRequest] = useState({
    status: RequestStatus.IDLE,
    data: null,
    error: null,
  })

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
    setRequest({
      status: RequestStatus.IDLE,
      data: null,
      error: null,
    })
  }, [])

  return useMemo(
    () => ({ ...request, copy, reset }),
    [copy, request, reset],
  )
}
