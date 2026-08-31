import { useLayoutEffect, useRef, useState } from 'react'

import { commentTargetLabel } from './comment-annotations.js'
import {
  CommentKeyboardAction,
  commentKeyboardAction,
} from './comment-keyboard.js'

export default function CommentComposer({ target, onCancel, onCreate }) {
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
      className="comment-composer"
      data-vim-ignore
      onSubmit={handleSubmit}
    >
      <label className="comment-target" htmlFor="comment-body">
        {commentTargetLabel(target)}
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
