/** Group all session comments without changing the saved comment order. */
export function createCommentGroups(comments) {
  const reviewComments = []
  const files = new Map()

  for (const comment of comments) {
    if (comment.target.kind === 'review') {
      reviewComments.push(comment)
      continue
    }

    const path = comment.target.path
    if (!files.has(path)) files.set(path, [])
    files.get(path).push(comment)
  }

  const groups = []
  if (reviewComments.length > 0) {
    groups.push({ kind: 'review', comments: reviewComments })
  }

  // Use path order that does not depend on the user's locale.
  for (const path of [...files.keys()].sort()) {
    groups.push({ kind: 'file', path, comments: files.get(path) })
  }
  return groups
}
