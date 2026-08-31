import { useCallback, useMemo, useRef, useState } from 'react'

import CommentComposer from './CommentComposer.jsx'
import SavedComment from './SavedComment.jsx'
import {
  createCommentAnnotations,
  normalizeCommentRange,
} from './comment-annotations.js'

export default function useDiffComments({
  comments,
  cursor,
  fileDiff,
  onCreateComment,
  onDeleteComment,
  onEditComment,
}) {
  const [draft, setDraft] = useState(null)
  const [selectedLines, setSelectedLines] = useState(null)
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [deletingCommentId, setDeletingCommentId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const commentReturnFocusRef = useRef(null)
  const deletingCommentIdRef = useRef(null)

  const selectLines = useCallback((range) => {
    setSelectedLines(range)
    cursor.activateRangeCommentContext(range)
  }, [cursor])

  const beginRangeComment = useCallback((range) => {
    if (!fileDiff || !range) return

    commentReturnFocusRef.current = document.activeElement
    const nextDraft = normalizeCommentRange(
      fileDiff.path,
      range,
      fileDiff.content.kind === 'diff',
    )
    cursor.guardNextAnnotationRender()
    cursor.activateRangeCommentContext(range)
    setSelectedLines(nextDraft.selection)
    setDraft(nextDraft)
  }, [cursor, fileDiff])

  const beginCursorComment = useCallback((target) => {
    commentReturnFocusRef.current = document.activeElement
    cursor.guardNextAnnotationRender()
    setDraft({
      annotationSide: target.side === 'old' ? 'deletions' : 'additions',
      target,
    })
  }, [cursor])

  const beginFileComment = useCallback((target) => {
    commentReturnFocusRef.current = document.activeElement
    cursor.guardNextAnnotationRender()
    setSelectedLines(null)
    setDraft({ target })
  }, [cursor])

  const cancelComment = useCallback(() => {
    const returnFocus = commentReturnFocusRef.current
    commentReturnFocusRef.current = null
    cursor.guardNextAnnotationRender()
    setDraft(null)
    setSelectedLines(null)
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    })
  }, [cursor])

  const createComment = useCallback((body, target) => (
    onCreateComment(body, target, cursor.guardNextAnnotationRender)
  ), [cursor, onCreateComment])

  const editComment = useCallback((commentId, body) => (
    onEditComment(commentId, body, cursor.guardNextAnnotationRender)
  ), [cursor, onEditComment])

  const deleteComment = useCallback((commentId) => (
    onDeleteComment(commentId, cursor.guardNextAnnotationRender)
  ), [cursor, onDeleteComment])

  const activateComment = useCallback((commentId) => {
    cursor.setActiveCommentId(commentId)
  }, [cursor])

  const beginEditComment = useCallback((comment) => {
    cursor.guardNextAnnotationRender()
    cursor.setActiveCommentId(comment.id)
    setDeleteError(null)
    setEditingCommentId(comment.id)
  }, [cursor])

  const deleteCommentImmediately = useCallback(async (comment) => {
    if (deletingCommentIdRef.current) return

    cursor.guardNextAnnotationRender()
    cursor.setActiveCommentId(comment.id)
    deletingCommentIdRef.current = comment.id
    setEditingCommentId(null)
    setDeletingCommentId(comment.id)
    setDeleteError(null)
    try {
      await deleteComment(comment.id)
    } catch (nextError) {
      setDeleteError({ commentId: comment.id, message: nextError.message })
    } finally {
      deletingCommentIdRef.current = null
      setDeletingCommentId(null)
    }
  }, [cursor, deleteComment])

  const cancelEditComment = useCallback(() => {
    cursor.guardNextAnnotationRender()
    setEditingCommentId(null)
  }, [cursor])

  const lineAnnotations = useMemo(() => createCommentAnnotations(
    fileDiff,
    comments,
    draft,
  ), [comments, draft, fileDiff])

  const renderAnnotation = useCallback((annotation) => {
    if (annotation.metadata.kind === 'draft') {
      const { target } = annotation.metadata.draft
      return (
        <CommentComposer
          key={target.kind === 'file'
            ? `file:${target.path}`
            : `${target.side}:${target.startLine}:${target.endLine}`}
          target={target}
          onCancel={cancelComment}
          onCreate={createComment}
        />
      )
    }

    const { comment } = annotation.metadata
    return (
      <SavedComment
        comment={comment}
        deleteError={deleteError?.commentId === comment.id ? deleteError.message : null}
        deleting={deletingCommentId === comment.id}
        editing={editingCommentId === comment.id}
        onActivate={activateComment}
        onBeginEdit={beginEditComment}
        onCancelEdit={cancelEditComment}
        onDelete={deleteCommentImmediately}
        onEdit={editComment}
      />
    )
  }, [
    activateComment,
    beginEditComment,
    cancelComment,
    cancelEditComment,
    createComment,
    deleteCommentImmediately,
    deleteError,
    deletingCommentId,
    editComment,
    editingCommentId,
  ])

  return useMemo(() => ({
    beginCursorComment,
    beginEditComment,
    beginFileComment,
    beginRangeComment,
    deleteCommentImmediately,
    lineAnnotations,
    renderAnnotation,
    selectedLines,
    selectLines,
  }), [
    beginCursorComment,
    beginEditComment,
    beginFileComment,
    beginRangeComment,
    deleteCommentImmediately,
    lineAnnotations,
    renderAnnotation,
    selectedLines,
    selectLines,
  ])
}
