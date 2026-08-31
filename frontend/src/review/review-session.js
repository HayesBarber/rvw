import { useCallback, useEffect, useMemo } from 'react'

import { TreeMode } from '../app/workspace.js'
import { openFileCommentTarget } from '../actions/comment-actions.js'
import { useCopyComments } from './comment-copy-request.js'
import { useReviewComments } from './comments-request.js'
import { useReviewOverview } from './overview-request.js'
import { useRepositoryFiles } from './repository-files-request.js'
import { RequestStatus } from './request-state.js'
import { useReviewFile } from './selected-file-request.js'

export function createFilesModeEntries(overview, repositoryPaths) {
  if (!overview) return []
  const changedByPath = new Map(overview.files.map((file) => [file.path, file]))
  const paths = new Set(repositoryPaths)
  for (const file of overview.files) paths.add(file.path)
  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => changedByPath.get(path) ?? {
      path,
      previousPath: null,
      status: 'unchanged',
      additions: null,
      deletions: null,
    })
}

export function selectVisibleFiles(overview, filesModeEntries, treeMode) {
  return treeMode === TreeMode.FILES
    ? filesModeEntries
    : (overview?.files ?? [])
}

export function selectActivePath(visibleFiles, selectedPath, initialPath) {
  const visiblePaths = new Set(visibleFiles.map((file) => file.path))
  if (selectedPath && visiblePaths.has(selectedPath)) return selectedPath
  if (initialPath && visiblePaths.has(initialPath)) return initialPath
  return visibleFiles[0]?.path ?? null
}

export function useReviewSession({ workspace, dispatchWorkspace }) {
  const overviewRequest = useReviewOverview()
  const allFilesRequest = useRepositoryFiles()
  const commentsRequest = useReviewComments()
  const copyRequest = useCopyComments()
  const overview = overviewRequest.data

  useEffect(() => {
    if (!overview) return
    dispatchWorkspace({
      type: 'review_loaded',
      initialPath: overview.initialPath,
    })
  }, [dispatchWorkspace, overview])

  const changedPaths = useMemo(
    () => new Set(overview?.files.map((file) => file.path) ?? []),
    [overview],
  )
  const filesModeEntries = useMemo(
    () => createFilesModeEntries(overview, allFilesRequest.data),
    [allFilesRequest.data, overview],
  )
  const visibleFiles = useMemo(
    () => selectVisibleFiles(overview, filesModeEntries, workspace.treeMode),
    [filesModeEntries, overview, workspace.treeMode],
  )
  const activePath = useMemo(
    () => selectActivePath(
      visibleFiles,
      workspace.selectedPath,
      overview?.initialPath,
    ),
    [overview, visibleFiles, workspace.selectedPath],
  )
  const fileRequest = useReviewFile({
    diffId: overview?.id ?? null,
    path: activePath,
    changed: changedPaths.has(activePath),
  })

  const openFileFinder = useCallback(() => {
    dispatchWorkspace({ type: 'finder_opened' })
    if (allFilesRequest.status === RequestStatus.IDLE) allFilesRequest.load()
  }, [allFilesRequest, dispatchWorkspace])

  const changeTreeMode = useCallback((nextMode) => {
    if (!overview) return false
    const nextFiles = nextMode === TreeMode.FILES
      ? filesModeEntries
      : overview.files
    dispatchWorkspace({
      type: 'tree_mode_changed',
      mode: nextMode,
      visiblePaths: nextFiles.map((file) => file.path),
      initialPath: overview.initialPath,
    })
    if (
      nextMode === TreeMode.FILES &&
      allFilesRequest.status === RequestStatus.IDLE
    ) {
      allFilesRequest.load()
    }
    return true
  }, [allFilesRequest, dispatchWorkspace, filesModeEntries, overview])

  const selectFile = useCallback((path) => {
    dispatchWorkspace({ type: 'file_selected', path })
  }, [dispatchWorkspace])

  const openFinderFile = useCallback((path) => {
    dispatchWorkspace({
      type: 'finder_file_opened',
      path,
      changed: changedPaths.has(path),
    })
  }, [changedPaths, dispatchWorkspace])

  const closeFileFinder = useCallback(() => {
    dispatchWorkspace({ type: 'finder_closed' })
  }, [dispatchWorkspace])

  const createReviewComment = useCallback(async (body, target, beforeCommit) => {
    const comment = await commentsRequest.create(body, target, beforeCommit)
    copyRequest.reset()
    return comment
  }, [commentsRequest, copyRequest])

  const editReviewComment = useCallback(async (commentId, body, beforeCommit) => {
    const comment = await commentsRequest.edit(commentId, body, beforeCommit)
    copyRequest.reset()
    return comment
  }, [commentsRequest, copyRequest])

  const deleteReviewComment = useCallback(async (commentId, beforeCommit) => {
    const result = await commentsRequest.remove(commentId, beforeCommit)
    copyRequest.reset()
    return result
  }, [commentsRequest, copyRequest])

  const copyComments = useCallback(() => {
    if (
      commentsRequest.data.length === 0 ||
      copyRequest.status === RequestStatus.LOADING
    ) {
      return false
    }

    copyRequest.copy().catch(() => {
      // The request exposes its error for the existing status message.
    })
    return true
  }, [commentsRequest.data.length, copyRequest])

  return {
    activePath,
    allFilesRequest,
    canCommentOnFile: Boolean(openFileCommentTarget(fileRequest.data)),
    closeFileFinder,
    comments: commentsRequest.data,
    copyComments,
    copyRequest,
    createReviewComment,
    deleteReviewComment,
    editReviewComment,
    fileError: fileRequest.status === RequestStatus.ERROR
      ? fileRequest.error
      : null,
    fileLoading: fileRequest.status === RequestStatus.LOADING,
    fileDiff: fileRequest.status === RequestStatus.SUCCESS
      ? fileRequest.data
      : null,
    filesModeEntries,
    openFileFinder,
    openFinderFile,
    overview,
    overviewRequest,
    selectFile,
    changeTreeMode,
    visibleFiles,
  }
}
