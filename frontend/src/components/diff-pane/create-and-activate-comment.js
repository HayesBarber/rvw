/** Persist a comment and make it the active keyboard-action context immediately. */
export async function createAndActivateComment({
  activate,
  beforeCommit,
  body,
  commentType,
  create,
  target,
}) {
  const comment = await create(body, commentType, target, beforeCommit)
  activate(comment.id)
  return comment
}
