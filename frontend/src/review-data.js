import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  copyCommentsAsMarkdown,
  createComment,
  deleteComment,
  editComment,
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

export function replaceEditedComment(comments, editedComment) {
  return comments.map((comment) => (
    comment.id === editedComment.id ? editedComment : comment
  ))
}

export function removeDeletedComment(comments, commentId) {
  return comments.filter((comment) => comment.id !== commentId)
}

export function isCurrentCommentFetch(fetchRevision, mutationRevision) {
  return fetchRevision === mutationRevision
}

export function createCommentMutationTracker() {
  let revision = 0
  return Object.freeze({
    captureFetch: () => revision,
    recordMutation: () => { revision += 1 },
    isCurrent: (fetchRevision) => isCurrentCommentFetch(fetchRevision, revision),
  })
}

export async function settleCommentFetch(promise, tracker, handlers) {
  const fetchRevision = tracker.captureFetch()
  try {
    const comments = await promise
    if (tracker.isCurrent(fetchRevision)) handlers.success(comments)
  } catch (error) {
    if (tracker.isCurrent(fetchRevision)) handlers.failure(error)
  }
}

export function useReviewComments() {
  const [request, setRequest] = useState({
    status: RequestStatus.LOADING,
    data: [],
    error: null,
  })
  const mutationTracker = useRef(createCommentMutationTracker())

  useEffect(() => {
    let active = true

    settleCommentFetch(getComments(), mutationTracker.current, {
      success(comments) {
        if (active) {
          setRequest((current) => ({
            status: RequestStatus.SUCCESS,
            data: mergeComments(comments, current.data),
            error: null,
          }))
        }
      },
      failure(error) {
        if (active) {
          setRequest((current) => ({
            status: RequestStatus.ERROR,
            data: current.data,
            error: error.message,
          }))
        }
      },
    })

    return () => {
      active = false
    }
  }, [])

  const create = useCallback(async (body, target, beforeCommit) => {
    const comment = await createComment(body, target)
    beforeCommit?.()
    mutationTracker.current.recordMutation()
    setRequest((current) => ({
      ...current,
      data: current.data.some((existing) => existing.id === comment.id)
        ? current.data
        : [...current.data, comment],
    }))
    return comment
  }, [])

  const edit = useCallback(async (commentId, body, beforeCommit) => {
    const comment = await editComment(commentId, body)
    beforeCommit?.()
    mutationTracker.current.recordMutation()
    setRequest((current) => ({
      ...current,
      data: replaceEditedComment(current.data, comment),
    }))
    return comment
  }, [])

  const remove = useCallback(async (commentId, beforeCommit) => {
    const result = await deleteComment(commentId)
    beforeCommit?.()
    mutationTracker.current.recordMutation()
    setRequest((current) => ({
      ...current,
      data: removeDeletedComment(current.data, result.commentId),
    }))
    return result
  }, [])

  return useMemo(
    () => ({ ...request, create, edit, remove }),
    [create, edit, remove, request],
  )
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
