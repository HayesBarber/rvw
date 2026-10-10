/** Select the next comment, or the previous comment at the end of the list. */
export function commentSelectionAfterDeletion(comments, deletedId, selectedId) {
  const remaining = comments.filter((comment) => comment.id !== deletedId)
  if (remaining.some((comment) => comment.id === selectedId)) return selectedId
  const index = Math.max(0, comments.findIndex((comment) => comment.id === deletedId))
  return remaining[Math.min(index, remaining.length - 1)]?.id ?? null
}

/** Keep selection and edit drafts until the service confirms deletion. */
export async function deleteAndSelectComment({
  commentId, remove, getComments, getSelectedId, discardDraft, selectComment,
}) {
  const nextId = commentSelectionAfterDeletion(getComments(), commentId, getSelectedId())
  await remove(commentId)
  discardDraft(commentId)
  selectComment(nextId)
}
