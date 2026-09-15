/** Persist a comment and make it the active keyboard-action context immediately. */
export async function createAndActivateComment({
  activate,
  beforeCommit,
  body,
  create,
  target,
}) {
  const comment = await create(body, target, beforeCommit)
  activate(comment.id)
  return comment
}
