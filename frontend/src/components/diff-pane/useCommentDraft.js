import { useState } from 'react'

/** Supply draft and onDraftChange to keep text when the editor unmounts. */
export default function useCommentDraft(initialBody, initialCommentType, draft, onDraftChange) {
  const [localDraft, setLocalDraft] = useState(() => ({
    body: initialBody,
    commentType: initialCommentType ?? null,
  }))
  const current = draft ?? localDraft

  function update(nextDraft) {
    setLocalDraft(nextDraft)
    onDraftChange?.(nextDraft)
  }

  return {
    body: current.body,
    commentType: current.commentType,
    setBody: (body) => update({ ...current, body }),
    setCommentType: (commentType) => update({ ...current, commentType }),
  }
}
