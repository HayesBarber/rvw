import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  centerDiffCursor,
  captureDiffLayoutAnchor,
  createDiffCursorRows,
  reconcileDiffCursor,
  restoreDiffLayoutAnchor,
  scrollDiffCursorIntoView,
  syncDiffCursorPresentation,
} from '../../actions/diff-cursor-actions.js'
import {
  commentAtCursor,
  commentTargetAtCursor,
} from '../../actions/comment-actions.js'
import { normalizeCommentRange } from './comment-annotations.js'
import { createInitialFilePosition } from './initial-file-position.js'

export default function useDiffCursor({ comments, fileDiff, isCursorVisible }) {
  const renderedFileRef = useRef(null)
  const renderInstanceRef = useRef(null)
  const cursorInstanceRef = useRef(null)
  const cursorRowsRef = useRef([])
  const cursorRef = useRef(null)
  const scrollGuardRef = useRef(null)
  const layoutAnchorRef = useRef(null)
  const [activeCommentId, setActiveCommentIdState] = useState(null)
  const activeCommentIdRef = useRef(null)
  const commentsRef = useRef(comments)
  const pathRef = useRef(fileDiff?.path ?? null)
  const cursorVisibleRef = useRef(isCursorVisible)
  const [initialPosition] = useState(createInitialFilePosition)

  const updateActiveCommentId = useCallback((commentId) => {
    activeCommentIdRef.current = commentId
    setActiveCommentIdState((previous) => (
      previous === commentId ? previous : commentId
    ))
  }, [])

  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  useEffect(() => {
    pathRef.current = fileDiff?.path ?? null
    activeCommentIdRef.current = null
  }, [fileDiff?.path])

  const activateCursor = useCallback((cursor, scroll = true) => {
    const instance = renderInstanceRef.current
    const node = renderedFileRef.current
    if (!instance || !node || !cursor) return false

    cursorRef.current = cursor
    updateActiveCommentId(commentAtCursor(
      commentsRef.current,
      pathRef.current,
      cursor,
    )?.id ?? null)
    syncDiffCursorPresentation(instance, cursor, cursorVisibleRef.current)
    if (scroll) scrollDiffCursorIntoView(instance, node, cursor)
    return true
  }, [updateActiveCommentId])

  useLayoutEffect(() => {
    cursorVisibleRef.current = isCursorVisible
    syncDiffCursorPresentation(
      renderInstanceRef.current,
      cursorRef.current,
      isCursorVisible,
    )
  }, [isCursorVisible])

  const centerCursor = useCallback((cursor) => centerDiffCursor(
    renderInstanceRef.current,
    renderedFileRef.current,
    cursor,
  ), [])

  const finishScrollGuard = useCallback(() => {
    const guard = scrollGuardRef.current
    if (!guard) return

    // Force WebKit to resolve the rebuilt layout while the old height is
    // still pinned, then restore the exact viewport before releasing it.
    guard.pre.offsetHeight
    guard.scrollContainer.scrollLeft = guard.left
    guard.scrollContainer.scrollTop = guard.top
    guard.pre.style.minHeight = guard.previousMinHeight
    scrollGuardRef.current = null
  }, [])

  const handlePostRender = useCallback((node, instance, phase) => {
    if (phase === 'unmount') {
      initialPosition.unmounted(instance)
      if (renderInstanceRef.current !== instance) return
      finishScrollGuard()
      renderedFileRef.current = null
      renderInstanceRef.current = null
      cursorRowsRef.current = []
      return
    }

    if (!initialPosition.rendered(node, instance)) return
    if (cursorInstanceRef.current !== instance) {
      cursorRef.current = null
      cursorInstanceRef.current = instance
    }
    renderedFileRef.current = node
    renderInstanceRef.current = instance
    const includeFileComment = commentsRef.current.some((comment) => (
      comment.target.kind === 'file' &&
      comment.target.path === pathRef.current
    ))
    const rows = createDiffCursorRows(instance, { includeFileComment })
    const cursor = reconcileDiffCursor(rows, cursorRef.current)
    cursorRowsRef.current = rows
    cursorRef.current = cursor
    syncDiffCursorPresentation(instance, cursor, cursorVisibleRef.current)
    restoreDiffLayoutAnchor(
      layoutAnchorRef.current,
      instance,
      node,
      cursor,
    )
    layoutAnchorRef.current = null
    finishScrollGuard()
  }, [finishScrollGuard, initialPosition])

  const guardNextLayoutRender = useCallback(() => {
    if (layoutAnchorRef.current) return
    layoutAnchorRef.current = captureDiffLayoutAnchor(
      renderInstanceRef.current,
      renderedFileRef.current,
      cursorRef.current,
    )
  }, [])

  const guardNextAnnotationRender = useCallback(() => {
    if (scrollGuardRef.current) return

    const node = renderedFileRef.current
    const pre = node?.shadowRoot?.querySelector('pre')
    const scrollContainer = node?.closest('.diff-scroll')
    const height = pre?.offsetHeight ?? 0
    if (!pre || !scrollContainer || height === 0) return

    scrollGuardRef.current = {
      left: scrollContainer.scrollLeft,
      top: scrollContainer.scrollTop,
      pre,
      previousMinHeight: pre.style.minHeight,
      scrollContainer,
    }
    pre.style.minHeight = `${height}px`
  }, [])

  const activateRangeCommentContext = useCallback((range) => {
    if (!fileDiff || !range) {
      updateActiveCommentId(null)
      return
    }

    const normalized = normalizeCommentRange(
      fileDiff.path,
      range,
      fileDiff.content.kind === 'diff',
    )
    const cursor = {
      lineNumber: normalized.target.endLine,
      side: normalized.annotationSide,
    }
    cursorRef.current = cursor
    updateActiveCommentId(commentAtCursor(
      commentsRef.current,
      fileDiff.path,
      cursor,
    )?.id ?? null)
  }, [fileDiff, updateActiveCommentId])

  const getActiveComment = useCallback(() => commentsRef.current.find(
    (comment) => comment.id === activeCommentIdRef.current,
  ) ?? null, [])

  const getAddTarget = useCallback(() => commentTargetAtCursor(
    pathRef.current,
    cursorRef.current,
    cursorRowsRef.current,
  ), [])

  const setActiveCommentId = useCallback((commentId) => {
    updateActiveCommentId(commentId)
  }, [updateActiveCommentId])

  const getCursor = useCallback(() => cursorRef.current, [])
  const getInstance = useCallback(() => renderInstanceRef.current, [])
  const getRows = useCallback(() => cursorRowsRef.current, [])

  return useMemo(() => ({
    activeCommentId,
    activateCursor,
    activateRangeCommentContext,
    centerCursor,
    getActiveComment,
    getAddTarget,
    getCursor,
    getInstance,
    getRows,
    guardNextLayoutRender,
    guardNextAnnotationRender,
    handlePostRender,
    setActiveCommentId,
  }), [
    activeCommentId,
    activateCursor,
    activateRangeCommentContext,
    centerCursor,
    getActiveComment,
    getAddTarget,
    getCursor,
    getInstance,
    getRows,
    guardNextLayoutRender,
    guardNextAnnotationRender,
    handlePostRender,
    setActiveCommentId,
  ])
}
