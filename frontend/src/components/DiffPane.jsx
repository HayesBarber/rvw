import { useCallback, useEffect, useState } from 'react'

import useVisualSelection from './diff-pane/useVisualSelection.js'
import { ApplicationAction } from '../actions/application-actions.js'
import { createCommentActionAdapter, openFileCommentTarget } from '../actions/comment-actions.js'
import { createDiffCursorActionAdapter } from '../actions/diff-cursor-actions.js'
import {
  createDiffFilePathActionAdapter,
  createDiffViewActionAdapter,
} from '../actions/diff-view-actions.js'
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
  lineNavigation,
  isCursorVisible,
  visualSelectionEnabled,
  loading,
  error,
  comments,
  commentTypes,
  defaultCommentType,
  onCreateComment,
  onEditComment,
  onDeleteComment,
  onDraftStateChange,
  onCopyFilePath,
  onFocusFileTree,
  onToggleRelativeLineNumbers,
  onToggleWrapLines,
  registerActionAdapter,
  relativeLineNumbers,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  wrapLines,
  filePath,
}) {
  const [expandUnchanged, setExpandUnchanged] = useState(false)
  const cursor = useDiffCursor({
    comments,
    fileDiff,
    lineNavigation,
    isCursorVisible,
    relativeLineNumbers,
  })
  const commentReview = useDiffComments({
    comments,
    commentTypes,
    defaultCommentType,
    cursor,
    activeCommentId: cursor.activeCommentId,
    fileDiff,
    onCreateComment,
    onDeleteComment,
    onEditComment,
    onDraftStateChange,
  })
  const visual = useVisualSelection({
    cursor,
    selectLines: commentReview.setSelectedLines,
    onMouseSelect: commentReview.selectLines,
    enabled: visualSelectionEnabled && !loading && !error &&
      Boolean(fileDiff && fileDiff.content.kind !== 'unavailable'),
  })
  const toggleExpandUnchanged = useCallback(() => {
    setExpandUnchanged((expanded) => !expanded)
  }, [])

  useEffect(() => registerActionAdapter({
    [ApplicationAction.VISUAL_LINE]: visual.toggle,
    [ApplicationAction.FOCUS_FILE_TREE]: onFocusFileTree,
    ...createDiffFilePathActionAdapter({ filePath, copyFilePath: onCopyFilePath }),
    ...createDiffViewActionAdapter({
      contentKind: fileDiff?.content.kind,
      prepareLayoutChange: cursor.guardNextLayoutRender,
      toggleExpandUnchanged,
      toggleRelativeLineNumbers: onToggleRelativeLineNumbers,
      toggleWrapLines: onToggleWrapLines,
    }),
    ...createDiffCursorActionAdapter({
      getRows: visual.getRows,
      getPreferredSide: visual.getPreferredSide,
      getCursor: cursor.getCursor,
      getInstance: cursor.getInstance,
      activateCursor: visual.activateCursor,
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
    visual.toggle,
    visual.getRows,
    visual.getPreferredSide,
    visual.activateCursor,
    cursor.centerCursor,
    cursor.getActiveComment,
    cursor.getAddTarget,
    cursor.getCursor,
    cursor.getInstance,
    cursor.guardNextLayoutRender,
    fileDiff,
    filePath,
    onCopyFilePath,
    onFocusFileTree,
    onToggleRelativeLineNumbers,
    onToggleWrapLines,
    registerActionAdapter,
    toggleExpandUnchanged,
  ])

  if (loading) return <PaneStatus>Loading file…</PaneStatus>
  if (error) return <PaneStatus>{error}</PaneStatus>
  if (!fileDiff) return <PaneStatus>Select a file to view it.</PaneStatus>

  if (fileDiff.content.kind === 'unavailable') {
    return <PaneStatus>{unavailableDescriptions[fileDiff.content.reason]}</PaneStatus>
  }

  return (
    <DiffSurface
      expandUnchanged={expandUnchanged}
      fileDiff={fileDiff}
      lineAnnotations={commentReview.lineAnnotations}
      selectedLines={commentReview.selectedLines}
      renderAnnotation={commentReview.renderAnnotation}
      renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
      renderHeaderMetadata={renderHeaderMetadata}
      onBeginComment={commentReview.beginRangeComment}
      onPostRender={cursor.handlePostRender}
      onSelectLines={visual.selectMouseLines}
      wrapLines={wrapLines}
    />
  )
}
