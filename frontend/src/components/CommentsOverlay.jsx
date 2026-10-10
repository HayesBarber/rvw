import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { commentLocation, createCommentsListActionAdapter, pageCommentSelection, revealSelectedComment } from '../actions/comments-list-actions.js'
import { blockingOverlayActions, OverlayKind } from '../actions/overlay-actions.js'
import { createCommentGroups } from '../review/comment-list.js'
import Overlay from './Overlay.jsx'
import CommentComposer from './diff-pane/CommentComposer.jsx'
import CommentEditor from './diff-pane/CommentEditor.jsx'
import { createAndActivateComment } from './diff-pane/create-and-activate-comment.js'
import { deleteAndSelectComment } from './delete-and-select-comment.js'

function targetLabel(target) {
  if (target.kind === 'review') return 'Review comment'
  if (target.kind === 'file') return 'File comment'
  const lines = target.startLine === target.endLine
    ? `Line ${target.startLine}`
    : `Lines ${target.startLine}–${target.endLine}`
  return `${target.side === 'old' ? 'Old' : 'New'} ${lines.toLowerCase()}`
}

export default function CommentsOverlay({
  comments, status, error, commentTypes, defaultCommentType,
  newCommentDraft, onNewCommentDraftChange, onCreateComment,
  editDrafts = {}, onEditDraftChange, onEditComment, onDeleteComment,
  onClose, onOpenLocation, registerActionAdapter,
}) {
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)
  const selectedIdRef = useRef(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const deletingIdRef = useRef(null)
  const busy = saving || deletingId !== null
  const canCreate = status === 'success' && typeof onCreateComment === 'function'
  const canEdit = status === 'success' && typeof onEditComment === 'function'
  const canDelete = status === 'success' && typeof onDeleteComment === 'function'
  const editingComment = comments.find((comment) => comment.id === editingId)
  const editorOpen = creating || Boolean(editingComment)
  const groups = useMemo(() => createCommentGroups(comments), [comments])
  const orderedComments = useMemo(() => groups.flatMap((group) => group.comments), [groups])
  const selected = orderedComments.find((comment) => comment.id === selectedId)
    ?? orderedComments[0]

  useLayoutEffect(() => {
    selectedIdRef.current = selected?.id ?? null
    const item = document.getElementById(`saved-comment-${selected?.id}`)
    revealSelectedComment(listRef.current, item)
  }, [selected, editorOpen])

  const selectComment = useCallback((id) => {
    setDeleteError(null)
    selectedIdRef.current = id
    setSelectedId(id)
    listRef.current?.focus({ preventScroll: true })
    revealSelectedComment(listRef.current, document.getElementById(`saved-comment-${id}`))
  }, [])
  const getSelectedId = useCallback(() => selectedIdRef.current, [])
  const beginCreate = useCallback(() => {
    if (!canCreate) return false
    setDeleteError(null)
    setEditingId(null)
    setCreating(true)
    return true
  }, [canCreate])
  const beginEdit = useCallback((comment) => {
    if (!canEdit) return false
    setDeleteError(null)
    setSelectedId(comment.id)
    setCreating(false)
    setEditingId(comment.id)
    return true
  }, [canEdit])
  const leaveEditor = useCallback(() => {
    setCreating(false)
    setEditingId(null)
    requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }))
  }, [])
  const createComment = useCallback(async (body, commentType, target) => {
    setSaving(true)
    try {
      const comment = await createAndActivateComment({
        activate: selectComment,
        body, commentType, target,
        create: onCreateComment,
      })
      onNewCommentDraftChange(null)
      return comment
    } finally {
      setSaving(false)
    }
  }, [onCreateComment, onNewCommentDraftChange, selectComment])
  const editComment = useCallback(async (id, body, commentType) => {
    setSaving(true)
    try {
      const comment = await onEditComment(id, body, commentType)
      onEditDraftChange(id, null)
      selectComment(id)
      return comment
    } finally {
      setSaving(false)
    }
  }, [onEditComment, onEditDraftChange, selectComment])
  const deleteComment = useCallback((comment) => {
    if (!canDelete || deletingIdRef.current !== null) return false
    deletingIdRef.current = comment.id
    setDeletingId(comment.id)
    setDeleteError(null)
    deleteAndSelectComment({
      commentId: comment.id,
      remove: onDeleteComment,
      getComments: () => orderedComments,
      getSelectedId,
      discardDraft: (id) => onEditDraftChange(id, null),
      selectComment,
    }).catch((error) => {
      setDeleteError(error.message)
      listRef.current?.focus({ preventScroll: true })
    }).finally(() => {
      deletingIdRef.current = null
      setDeletingId(null)
    })
    return true
  }, [canDelete, onDeleteComment, orderedComments, getSelectedId, onEditDraftChange, selectComment])
  const close = () => {
    if (!busy) onClose()
  }
  const getPageIndex = useCallback((index, direction, count) => {
    const list = listRef.current
    if (!list) return -1
    const centers = [...list.querySelectorAll('[role="option"]')].map((item) => {
      const bounds = item.getBoundingClientRect()
      return bounds.top + bounds.height / 2
    })
    return pageCommentSelection(centers, index, direction, list.clientHeight, count)
  }, [])
  // The factory stores these callbacks. It does not read refs during render.
  // eslint-disable-next-line react-hooks/refs
  const actions = useMemo(() => createCommentsListActionAdapter({
    getComments: () => orderedComments,
    getSelectedId,
    selectComment,
    getPageIndex,
    openLocation: onOpenLocation,
    addReviewComment: beginCreate,
    editComment: beginEdit,
    deleteComment,
  }), [orderedComments, getSelectedId, selectComment, getPageIndex, onOpenLocation, beginCreate, beginEdit, deleteComment])

  return (
    <Overlay
      kind={OverlayKind.COMMENTS}
      modal={false}
      trapFocus
      actions={editorOpen || busy ? blockingOverlayActions : actions}
      registerActionAdapter={registerActionAdapter}
      dialogRef={dialogRef}
      initialFocusRef={listRef}
      navigationRef={listRef}
      onClose={close}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return
        if (editorOpen && event.key === 'Escape') {
          event.preventDefault()
          if (!saving) leaveEditor()
        }
      }}
      labelledBy="comments-title"
      className="comments-dialog"
      backdropClassName="comments-positioner"
    >
      <header className="comments-header">
        <h2 id="comments-title">Comments ({comments.length})</h2>
        <button type="button" disabled={!canCreate || editorOpen || busy} onClick={beginCreate} data-vim-ignore>
          Add review comment
        </button>
        <button type="button" disabled={busy} onClick={close} data-vim-ignore aria-label="Close comments">
          Close
        </button>
      </header>
      {creating && (
        <div className="comments-editor">
          <CommentComposer
            target={{ kind: 'review' }}
            commentTypes={commentTypes}
            defaultCommentType={defaultCommentType}
            draft={newCommentDraft}
            onDraftChange={onNewCommentDraftChange}
            submitLabel="Save comment"
            onCreate={createComment}
            onCancel={leaveEditor}
          />
        </div>
      )}
      {editingComment && (
        <div className="comments-editor">
          <CommentEditor
            key={editingComment.id}
            comment={editingComment}
            commentTypes={commentTypes}
            draft={editDrafts[editingComment.id]}
            onDraftChange={(draft) => onEditDraftChange(editingComment.id, draft)}
            onSave={editComment}
            onCancel={leaveEditor}
          />
        </div>
      )}
      {!editorOpen && <div
        ref={listRef}
        className="comments-list"
        role="listbox"
        aria-label="Saved comments"
        aria-activedescendant={selected ? `saved-comment-${selected.id}` : undefined}
        tabIndex={-1}
      >
        {deletingId !== null && <p className="comments-status" role="status">Deleting comment…</p>}
        {deleteError && <p className="comments-status" role="alert">Unable to delete comment: {deleteError}</p>}
        {status === 'loading' && <p className="comments-status" role="status">Loading comments…</p>}
        {status === 'error' && <p className="comments-status" role="alert">Unable to load comments: {error}</p>}
        {status === 'success' && comments.length === 0 && (
          <p className="comments-status" role="status">No saved comments in this review.</p>
        )}
        {groups.map((group, index) => (
          <section
            key={group.kind === 'review' ? 'review' : group.path}
            role="group"
            aria-labelledby={`comments-group-${index}`}
            className="comments-group"
          >
            <h3 id={`comments-group-${index}`}>
              {group.kind === 'review' ? 'Review comments' : group.path}
            </h3>
            {group.comments.map((comment) => (
              <article
                id={`saved-comment-${comment.id}`}
                key={comment.id}
                role="option"
                aria-selected={selected?.id === comment.id}
                tabIndex={0}
                className="comments-item"
                onFocus={() => { if (!busy) setSelectedId(comment.id) }}
                onClick={() => { if (!busy) setSelectedId(comment.id) }}
              >
                <header>
                  <span>{targetLabel(comment.target)}</span>
                  {comment.commentType && <span className="comment-type-badge">{comment.commentType}</span>}
                  {comment.target.kind !== 'review' && (
                    <a
                      className="comment-location-link"
                      href={`#${encodeURIComponent(comment.target.path)}`}
                      data-vim-ignore
                      aria-disabled={busy || undefined}
                      aria-label={`Open ${targetLabel(comment.target).toLowerCase()} on ${comment.target.path}`}
                      onClick={(event) => {
                        event.preventDefault()
                        if (busy) return
                        onOpenLocation(commentLocation(comment))
                      }}
                    >
                      Open location
                    </a>
                  )}
                  <button
                    type="button"
                    className="comments-item-edit"
                    data-vim-ignore
                    disabled={!canEdit || busy}
                    aria-label={`Edit ${targetLabel(comment.target).toLowerCase()}${comment.target.path ? ` on ${comment.target.path}` : ''}`}
                    onClick={() => beginEdit(comment)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="comments-item-delete"
                    data-vim-ignore
                    disabled={!canDelete || busy}
                    aria-label={`Delete ${targetLabel(comment.target).toLowerCase()}${comment.target.path ? ` on ${comment.target.path}` : ''}`}
                    onClick={() => deleteComment(comment)}
                  >
                    {deletingId === comment.id ? 'Deleting…' : 'Delete'}
                  </button>
                </header>
                <p>{comment.body}</p>
              </article>
            ))}
          </section>
        ))}
      </div>}
    </Overlay>
  )
}
