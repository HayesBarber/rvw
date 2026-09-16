import { useLayoutEffect, useRef, useState } from 'react'

import {
  CommentKeyboardAction,
  commentKeyboardAction,
  cycleCommentType,
} from './comment-keyboard.js'
import CommentTypeSelect from './CommentTypeSelect.jsx'
import { scrollCommentIntoView } from './scroll-comment-into-view.js'

export default function CommentEditor({ comment, commentTypes, onCancel, onSave }) {
  const [body, setBody] = useState(comment.body)
  const [commentType, setCommentType] = useState(comment.commentType ?? null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)
  const textareaRef = useRef(null)
  const inputId = `edit-comment-${comment.id}`

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    textarea?.focus({ preventScroll: true })
    textarea?.select()

    if (!textarea) return
    const scrollContainer = textarea.closest('.diff-scroll')
    if (!scrollContainer) return

    // An edit form opened near the bottom edge is clipped like a new comment;
    // scroll it into view once the diff renderer has settled.
    const frame = requestAnimationFrame(() => {
      scrollCommentIntoView(scrollContainer, formRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const nextBody = body.trim()
    if (!nextBody || saving) return

    setSaving(true)
    setError(null)
    try {
      await onSave(comment.id, nextBody, commentType)
      onCancel()
    } catch (nextError) {
      setError(nextError.message)
      setSaving(false)
    }
  }

  function handleKeyDown(event) {
    const action = commentKeyboardAction(event, saving, commentTypes.length > 0)
    if (action === CommentKeyboardAction.CANCEL) {
      event.preventDefault()
      onCancel()
    } else if (action === CommentKeyboardAction.SUBMIT) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    } else if (
      action === CommentKeyboardAction.CYCLE_NEXT_TYPE ||
      action === CommentKeyboardAction.CYCLE_PREVIOUS_TYPE
    ) {
      event.preventDefault()
      setCommentType((current) => cycleCommentType(
        current,
        commentTypes,
        action === CommentKeyboardAction.CYCLE_NEXT_TYPE ? 1 : -1,
      ))
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
        aria-keyshortcuts="Tab Shift+Tab"
        value={body}
        disabled={saving}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <CommentTypeSelect
        id={`${inputId}-type`}
        types={commentTypes}
        value={commentType}
        disabled={saving}
        onChange={setCommentType}
      />
      {error && <p className="comment-error" role="alert">{error}</p>}
      <div className="comment-actions">
        <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || body.trim().length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
