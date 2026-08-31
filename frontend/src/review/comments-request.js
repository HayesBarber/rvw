import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  createComment,
  deleteComment,
  editComment,
  getComments,
} from './api.js'
import { RequestStatus } from './request-state.js'

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
