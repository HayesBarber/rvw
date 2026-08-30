import { useEffect } from 'react'

import { createCommentActionAdapter, openFileCommentTarget } from '../actions/comment-actions.js'
import { createDiffCursorActionAdapter } from '../actions/diff-cursor-actions.js'
import DiffSurface from './diff-pane/DiffSurface.jsx'
import useDiffComments from './diff-pane/useDiffComments.jsx'
import useDiffCursor from './diff-pane/useDiffCursor.js'
import PaneStatus from './PaneStatus.jsx'

const unavailableDescriptions = {
  binary: 'Binary file contents cannot be displayed.',
  'invalid-utf8': 'This file is not valid UTF-8 text.',
  'too-large': 'This file is larger than the 512 KiB review limit.',
  symlink: 'Symbolic link changes cannot be displayed.',
  submodule: 'Submodule changes cannot be displayed.',
}

export default function DiffPane({
  fileDiff,
  loading,
  error,
  comments,
  onCreateComment,
  onEditComment,
  onDeleteComment,
  registerActionAdapter,
}) {
  const cursor = useDiffCursor({ comments, fileDiff })
  const commentReview = useDiffComments({
    comments,
    cursor,
    fileDiff,
    onCreateComment,
    onDeleteComment,
    onEditComment,
  })

  useEffect(() => registerActionAdapter({
    ...createDiffCursorActionAdapter({
      getRows: cursor.getRows,
      getCursor: cursor.getCursor,
      getInstance: cursor.getInstance,
      activateCursor: cursor.activateCursor,
      centerCursor: cursor.centerCursor,
    }),
    ...createCommentActionAdapter({
      getAddTarget: cursor.getAddTarget,
      beginAdd: commentReview.beginCursorComment,
      getAddFileTarget: () => openFileCommentTarget(fileDiff),
      beginAddFile: commentReview.beginFileComment,
      getComment: cursor.getActiveComment,
      beginEdit: commentReview.beginEditComment,
      deleteComment: commentReview.deleteCommentImmediately,
    }),
  }), [
    commentReview.beginCursorComment,
    commentReview.beginEditComment,
    commentReview.beginFileComment,
    commentReview.deleteCommentImmediately,
    cursor.activateCursor,
    cursor.centerCursor,
    cursor.getActiveComment,
    cursor.getAddTarget,
    cursor.getCursor,
    cursor.getInstance,
    cursor.getRows,
    fileDiff,
    registerActionAdapter,
  ])

  if (loading) return <PaneStatus>Loading file…</PaneStatus>
  if (error) return <PaneStatus>{error}</PaneStatus>
  if (!fileDiff) return <PaneStatus>Select a file to view it.</PaneStatus>

  if (fileDiff.content.kind === 'unavailable') {
    return <PaneStatus>{unavailableDescriptions[fileDiff.content.reason]}</PaneStatus>
  }

  return (
    <DiffSurface
      fileDiff={fileDiff}
      lineAnnotations={commentReview.lineAnnotations}
      selectedLines={commentReview.selectedLines}
      renderAnnotation={commentReview.renderAnnotation}
      onBeginComment={commentReview.beginRangeComment}
      onPostRender={cursor.handlePostRender}
      onSelectLines={commentReview.selectLines}
    />
  )
}
