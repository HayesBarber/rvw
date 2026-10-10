import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { commentLocation, createCommentsListActionAdapter, pageCommentSelection, revealSelectedComment } from '../actions/comments-list-actions.js'
import { blockingOverlayActions, OverlayKind } from '../actions/overlay-actions.js'
import { createCommentGroups } from '../review/comment-list.js'
import Overlay from './Overlay.jsx'
import CommentComposer from './diff-pane/CommentComposer.jsx'
import CommentEditor from './diff-pane/CommentEditor.jsx'
import { createAndActivateComment } from './diff-pane/create-and-activate-comment.js'

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
  editDrafts = {}, onEditDraftChange, onEditComment,
  onClose, onOpenLocation, registerActionAdapter,
}) {
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)
  const selectedIdRef = useRef(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const canCreate = status === 'success' && typeof onCreateComment === 'function'
  const canEdit = status === 'success' && typeof onEditComment === 'function'
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
    selectedIdRef.current = id
    setSelectedId(id)
    listRef.current?.focus({ preventScroll: true })
    revealSelectedComment(listRef.current, document.getElementById(`saved-comment-${id}`))
  }, [])
  const getSelectedId = useCallback(() => selectedIdRef.current, [])
  const beginCreate = useCallback(() => {
    if (!canCreate) return false
    setEditingId(null)
    setCreating(true)
    return true
  }, [canCreate])
  const beginEdit = useCallback((comment) => {
    if (!canEdit) return false
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
  const close = () => {
    if (!saving) onClose()
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
  }), [orderedComments, getSelectedId, selectComment, getPageIndex, onOpenLocation, beginCreate, beginEdit])

  return (
    <Overlay
      kind={OverlayKind.COMMENTS}
      modal={false}
      trapFocus
      actions={editorOpen ? blockingOverlayActions : actions}
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
        <button type="button" disabled={!canCreate || editorOpen} onClick={beginCreate} data-vim-ignore>
          Add review comment
        </button>
        <button type="button" disabled={saving} onClick={close} data-vim-ignore aria-label="Close comments">
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
                onFocus={() => setSelectedId(comment.id)}
                onClick={() => setSelectedId(comment.id)}
              >
                <header>
                  <span>{targetLabel(comment.target)}</span>
                  {comment.commentType && <span className="comment-type-badge">{comment.commentType}</span>}
                  {comment.target.kind !== 'review' && (
                    <a
                      className="comment-location-link"
                      href={`#${encodeURIComponent(comment.target.path)}`}
                      data-vim-ignore
                      aria-label={`Open ${targetLabel(comment.target).toLowerCase()} on ${comment.target.path}`}
                      onClick={(event) => {
                        event.preventDefault()
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
                    disabled={!canEdit}
                    aria-label={`Edit ${targetLabel(comment.target).toLowerCase()}${comment.target.path ? ` on ${comment.target.path}` : ''}`}
                    onClick={() => beginEdit(comment)}
                  >
                    Edit
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
