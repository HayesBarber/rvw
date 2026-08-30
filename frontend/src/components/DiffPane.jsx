import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { File, MultiFileDiff, Virtualizer } from '@pierre/diffs/react'
import {
  centerDiffCursor,
  createDiffCursorActionAdapter,
  createDiffCursorRows,
  reconcileDiffCursor,
  scrollDiffCursorIntoView,
} from '../actions/diff-cursor-actions.js'
import {
  commentAtCursor,
  commentTargetAtCursor,
  createCommentActionAdapter,
} from '../actions/comment-actions.js'
import PaneStatus from './PaneStatus.jsx'

const diffCursorCSS = `
  [data-line][data-editor-active-line],
  [data-column-number][data-editor-active-line] {
    --diffs-editor-active-line-source-mix: 68%;
  }

  [data-line][data-editor-active-line] {
    box-shadow: inset 0 1px color-mix(in lab, var(--diffs-modified-base) 45%, transparent),
      inset 0 -1px color-mix(in lab, var(--diffs-modified-base) 45%, transparent);
  }
`
const baseOptions = {
  diffStyle: 'split',
  enableGutterUtility: true,
  enableLineSelection: true,
  lineHoverHighlight: 'line',
  unsafeCSS: diffCursorCSS,
}

function normalizeRange(path, range, isDiff) {
  const startSide = range.side ?? range.endSide ?? 'additions'
  const endSide = range.endSide ?? startSide
  const crossesSides = isDiff && startSide !== endSide
  const startLine = crossesSides ? range.end : Math.min(range.start, range.end)
  const endLine = crossesSides ? range.end : Math.max(range.start, range.end)
  const side = endSide

  return {
    annotationSide: side,
    selection: isDiff
      ? { start: startLine, end: endLine, side, endSide: side }
      : { start: startLine, end: endLine },
    target: {
      kind: 'line',
      path,
      side: side === 'deletions' ? 'old' : 'new',
      startLine,
      endLine,
    },
  }
}

function targetLabel(target) {
  const side = target.side === 'old' ? 'old' : 'new'
  const lines = target.startLine === target.endLine
    ? `line ${target.startLine}`
    : `lines ${target.startLine}–${target.endLine}`
  return `Comment on ${side} ${lines}`
}

function CommentComposer({ target, onCancel, onCreate }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)
  const textareaRef = useRef(null)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const scrollContainer = textarea.closest('.diff-scroll')
    const scrollPosition = scrollContainer
      ? { left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop }
      : null

    textarea.focus({ preventScroll: true })

    // WebKit can still move an overflow container when focus enters content
    // rendered through a shadow-root slot, despite preventScroll.
    if (scrollContainer && scrollPosition) {
      scrollContainer.scrollLeft = scrollPosition.left
      scrollContainer.scrollTop = scrollPosition.top
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const nextBody = body.trim()
    if (!nextBody || saving) return

    setSaving(true)
    setError(null)
    try {
      await onCreate(nextBody, target)
      onCancel()
    } catch (nextError) {
      setError(nextError.message)
      setSaving(false)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  return (
    <form
      ref={formRef}
      className="comment-composer"
      data-vim-ignore
      onSubmit={handleSubmit}
    >
      <label className="comment-target" htmlFor="comment-body">
        {targetLabel(target)}
      </label>
      <textarea
        ref={textareaRef}
        id="comment-body"
        rows="4"
        value={body}
        placeholder="Leave a comment"
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions">
        <span>⌘↵ to submit</span>
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving || body.trim().length === 0}>
          {saving ? 'Saving…' : 'Comment'}
        </button>
      </div>
    </form>
  )
}

function CommentEditor({ comment, onCancel, onSave }) {
  const [body, setBody] = useState(comment.body)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)
  const textareaRef = useRef(null)
  const inputId = `edit-comment-${comment.id}`

  useLayoutEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })
    textareaRef.current?.select()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const nextBody = body.trim()
    if (!nextBody || saving) return

    setSaving(true)
    setError(null)
    try {
      await onSave(comment.id, nextBody)
      onCancel()
    } catch (nextError) {
      setError(nextError.message)
      setSaving(false)
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      onCancel()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  return (
    <form
      ref={formRef}
      className="comment-composer comment-editor"
      data-vim-ignore
      onSubmit={handleSubmit}
    >
      <label className="comment-target" htmlFor={inputId}>Edit comment</label>
      <textarea
        ref={textareaRef}
        id={inputId}
        rows="4"
        value={body}
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions">
        <span>⌘↵ to save</span>
        <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || body.trim().length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function DeleteConfirmation({ comment, onCancel, onDelete }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const cancelRef = useRef(null)

  useLayoutEffect(() => {
    cancelRef.current?.focus({ preventScroll: true })
  }, [])

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(comment.id)
    } catch (nextError) {
      setError(nextError.message)
      setDeleting(false)
    }
  }

  return (
    <div
      className="comment-delete-confirmation"
      role="alertdialog"
      aria-label="Confirm comment deletion"
      data-vim-ignore
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !deleting) {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <p>Permanently delete this comment?</p>
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions">
        <button
          ref={cancelRef}
          type="button"
          disabled={deleting}
          onClick={onCancel}
        >
          Keep comment
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={deleting}
          onClick={confirmDelete}
        >
          {deleting ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </div>
  )
}

function SavedComment({
  comment,
  editing,
  confirmingDelete,
  onActivate,
  onBeginDelete,
  onBeginEdit,
  onCancelDelete,
  onCancelEdit,
  onDelete,
  onEdit,
}) {
  const editButtonRef = useRef(null)
  const deleteButtonRef = useRef(null)
  const wasEditingRef = useRef(editing)
  const wasConfirmingDeleteRef = useRef(confirmingDelete)
  const lineLabel = comment.target.kind === 'line'
    ? (comment.target.startLine === comment.target.endLine
        ? `Line ${comment.target.startLine}`
        : `Lines ${comment.target.startLine}–${comment.target.endLine}`)
    : 'File comment'

  useLayoutEffect(() => {
    if (wasEditingRef.current && !editing) {
      editButtonRef.current?.focus({ preventScroll: true })
    }
    wasEditingRef.current = editing
  }, [editing])

  useLayoutEffect(() => {
    if (wasConfirmingDeleteRef.current && !confirmingDelete) {
      deleteButtonRef.current?.focus({ preventScroll: true })
    }
    wasConfirmingDeleteRef.current = confirmingDelete
  }, [confirmingDelete])

  return (
    <article
      className="saved-comment"
      tabIndex={0}
      onFocus={() => onActivate(comment.id)}
      onPointerDown={() => onActivate(comment.id)}
    >
      <header>
        <span>{lineLabel}</span>
        {!editing && !confirmingDelete && (
          <span className="saved-comment-actions">
            <button
              ref={editButtonRef}
              type="button"
              aria-label={`Edit comment on ${lineLabel}`}
              onClick={() => onBeginEdit(comment)}
            >
              Edit
            </button>
            <button
              ref={deleteButtonRef}
              type="button"
              aria-label={`Delete comment on ${lineLabel}`}
              onClick={() => onBeginDelete(comment)}
            >
              Delete
            </button>
          </span>
        )}
      </header>
      {editing ? (
        <CommentEditor comment={comment} onCancel={onCancelEdit} onSave={onEdit} />
      ) : (
        <p>{comment.body}</p>
      )}
      {confirmingDelete && (
        <DeleteConfirmation
          comment={comment}
          onCancel={onCancelDelete}
          onDelete={onDelete}
        />
      )}
    </article>
  )
}

function commentAnnotation(comment, isDiff, fallbackSide) {
  const lineNumber = comment.target.kind === 'line' ? comment.target.endLine : 0
  const metadata = { kind: 'comment', comment }
  if (!isDiff) return { lineNumber, metadata }

  const side = comment.target.kind === 'line'
    ? (comment.target.side === 'old' ? 'deletions' : 'additions')
    : fallbackSide
  return { lineNumber, side, metadata }
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
  const [draft, setDraft] = useState(null)
  const [selectedLines, setSelectedLines] = useState(null)
  const renderedFileRef = useRef(null)
  const renderInstanceRef = useRef(null)
  const cursorRowsRef = useRef([])
  const cursorRef = useRef(null)
  const scrollGuardRef = useRef(null)
  const activeCommentIdRef = useRef(null)
  const commentsRef = useRef(comments)
  const pathRef = useRef(fileDiff?.path ?? null)
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [deletingCommentId, setDeletingCommentId] = useState(null)

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
    activeCommentIdRef.current = commentAtCursor(
      commentsRef.current,
      pathRef.current,
      cursor,
    )?.id ?? null
    instance.setEditorActiveLine(cursor.lineNumber, { side: cursor.side })
    if (scroll) scrollDiffCursorIntoView(instance, node, cursor)
    return true
  }, [])

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
      finishScrollGuard()
      renderedFileRef.current = null
      renderInstanceRef.current = null
      cursorRowsRef.current = []
      return
    }

    renderedFileRef.current = node
    renderInstanceRef.current = instance
    const rows = createDiffCursorRows(instance)
    const cursor = reconcileDiffCursor(rows, cursorRef.current)
    cursorRowsRef.current = rows
    cursorRef.current = cursor
    if (cursor) activateCursor(cursor, false)
    finishScrollGuard()
  }, [activateCursor, finishScrollGuard])

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

  const isDiff = fileDiff?.content.kind === 'diff'
  const activateRangeCommentContext = useCallback((range) => {
    if (!fileDiff || !range) {
      activeCommentIdRef.current = null
      return
    }
    const normalized = normalizeRange(fileDiff.path, range, isDiff)
    const cursor = {
      lineNumber: normalized.target.endLine,
      side: normalized.annotationSide,
    }
    cursorRef.current = cursor
    activeCommentIdRef.current = commentAtCursor(
      commentsRef.current,
      fileDiff.path,
      cursor,
    )?.id ?? null
  }, [fileDiff, isDiff])

  const selectLines = useCallback((range) => {
    setSelectedLines(range)
    activateRangeCommentContext(range)
  }, [activateRangeCommentContext])

  const beginComment = useCallback((range) => {
    if (!fileDiff || !range) return
    const nextDraft = normalizeRange(fileDiff.path, range, isDiff)
    guardNextAnnotationRender()
    activateRangeCommentContext(range)
    setSelectedLines(nextDraft.selection)
    setDraft(nextDraft)
  }, [activateRangeCommentContext, fileDiff, guardNextAnnotationRender, isDiff])

  const beginCursorComment = useCallback((target) => {
    guardNextAnnotationRender()
    setDraft({
      annotationSide: target.side === 'old' ? 'deletions' : 'additions',
      target,
    })
  }, [guardNextAnnotationRender])

  const cancelComment = useCallback(() => {
    guardNextAnnotationRender()
    setDraft(null)
    setSelectedLines(null)
  }, [guardNextAnnotationRender])

  const createComment = useCallback((body, target) => (
    onCreateComment(body, target, guardNextAnnotationRender)
  ), [guardNextAnnotationRender, onCreateComment])

  const editComment = useCallback((commentId, body) => (
    onEditComment(commentId, body, guardNextAnnotationRender)
  ), [guardNextAnnotationRender, onEditComment])

  const deleteComment = useCallback((commentId) => (
    onDeleteComment(commentId, guardNextAnnotationRender)
  ), [guardNextAnnotationRender, onDeleteComment])

  const activateComment = useCallback((commentId) => {
    activeCommentIdRef.current = commentId
  }, [])

  const activeComment = useCallback(() => {
    return commentsRef.current.find(
      (comment) => comment.id === activeCommentIdRef.current,
    ) ?? null
  }, [])

  const beginEditComment = useCallback((comment) => {
    guardNextAnnotationRender()
    activeCommentIdRef.current = comment.id
    setDeletingCommentId(null)
    setEditingCommentId(comment.id)
  }, [guardNextAnnotationRender])

  const beginDeleteComment = useCallback((comment) => {
    guardNextAnnotationRender()
    activeCommentIdRef.current = comment.id
    setEditingCommentId(null)
    setDeletingCommentId(comment.id)
  }, [guardNextAnnotationRender])

  const cancelEditComment = useCallback(() => {
    guardNextAnnotationRender()
    setEditingCommentId(null)
  }, [guardNextAnnotationRender])

  const cancelDeleteComment = useCallback(() => {
    guardNextAnnotationRender()
    setDeletingCommentId(null)
  }, [guardNextAnnotationRender])

  useEffect(() => registerActionAdapter({
    ...createDiffCursorActionAdapter({
      getRows: () => cursorRowsRef.current,
      getCursor: () => cursorRef.current,
      activateCursor,
      centerCursor,
    }),
    ...createCommentActionAdapter({
      getAddTarget: () => commentTargetAtCursor(
        pathRef.current,
        cursorRef.current,
        cursorRowsRef.current,
      ),
      beginAdd: beginCursorComment,
      getComment: activeComment,
      beginEdit: beginEditComment,
      beginDelete: beginDeleteComment,
    }),
  }), [
    activateCursor,
    activeComment,
    beginCursorComment,
    beginDeleteComment,
    beginEditComment,
    centerCursor,
    registerActionAdapter,
  ])

  const options = useMemo(() => ({
    ...baseOptions,
    onGutterUtilityClick: beginComment,
    onLineSelected: selectLines,
    onLineSelectionChange: selectLines,
    onLineSelectionEnd: selectLines,
    onPostRender: handlePostRender,
  }), [beginComment, handlePostRender, selectLines])

  const lineAnnotations = useMemo(() => {
    if (!fileDiff) return []
    const fallbackSide = fileDiff.content.kind === 'diff' && !fileDiff.content.newFile
      ? 'deletions'
      : 'additions'
    const nextAnnotations = comments
      .filter((comment) => comment.target.path === fileDiff.path)
      .map((comment) => commentAnnotation(comment, isDiff, fallbackSide))

    if (draft) {
      const annotation = {
        lineNumber: draft.target.endLine,
        metadata: { kind: 'draft', draft },
      }
      nextAnnotations.push(isDiff
        ? { ...annotation, side: draft.annotationSide }
        : annotation)
    }
    return nextAnnotations
  }, [comments, draft, fileDiff, isDiff])

  const renderAnnotation = useCallback((annotation) => {
    if (annotation.metadata.kind === 'draft') {
      const { target } = annotation.metadata.draft
      return (
        <CommentComposer
          key={`${target.side}:${target.startLine}:${target.endLine}`}
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
        editing={editingCommentId === comment.id}
        confirmingDelete={deletingCommentId === comment.id}
        onActivate={activateComment}
        onBeginDelete={beginDeleteComment}
        onBeginEdit={beginEditComment}
        onCancelDelete={cancelDeleteComment}
        onCancelEdit={cancelEditComment}
        onDelete={deleteComment}
        onEdit={editComment}
      />
    )
  }, [
    activateComment,
    beginDeleteComment,
    beginEditComment,
    cancelComment,
    cancelDeleteComment,
    cancelEditComment,
    createComment,
    deleteComment,
    deletingCommentId,
    editComment,
    editingCommentId,
  ])

  if (loading) {
    return <PaneStatus>Loading file…</PaneStatus>
  }

  if (error) {
    return <PaneStatus>{error}</PaneStatus>
  }

  if (!fileDiff) {
    return <PaneStatus>Select a file to view it.</PaneStatus>
  }

  if (fileDiff.content.kind === 'unavailable') {
    const descriptions = {
      binary: 'Binary file contents cannot be displayed.',
      'invalid-utf8': 'This file is not valid UTF-8 text.',
      'too-large': 'This file is larger than the 512 KiB review limit.',
      symlink: 'Symbolic link changes cannot be displayed.',
      submodule: 'Submodule changes cannot be displayed.',
    }
    return <PaneStatus>{descriptions[fileDiff.content.reason]}</PaneStatus>
  }

  return (
    <Virtualizer className="diff-scroll">
      {fileDiff.content.kind === 'diff' ? (
        <MultiFileDiff
          oldFile={fileDiff.content.oldFile}
          newFile={fileDiff.content.newFile}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      ) : (
        <File
          file={fileDiff.content.file}
          lineAnnotations={lineAnnotations}
          selectedLines={selectedLines}
          renderAnnotation={renderAnnotation}
          options={options}
        />
      )}
    </Virtualizer>
  )
}
