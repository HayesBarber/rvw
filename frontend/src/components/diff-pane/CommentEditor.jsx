import { useLayoutEffect, useRef, useState } from 'react'

import {
  CommentKeyboardAction,
  commentKeyboardAction,
} from './comment-keyboard.js'

export default function CommentEditor({ comment, onCancel, onSave }) {
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
    const action = commentKeyboardAction(event, saving)
    if (action === CommentKeyboardAction.CANCEL) {
      event.preventDefault()
      onCancel()
    } else if (action === CommentKeyboardAction.SUBMIT) {
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
        <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || body.trim().length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
