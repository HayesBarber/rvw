/**
 * @typedef {'modified' | 'added' | 'deleted' | 'unchanged'} FileStatus
 */

/**
 * @typedef {Object} FileSummary
 * @property {string} path Canonical repository-relative path.
 * @property {FileStatus} status
 * @property {number} additions
 * @property {number} deletions
 * @property {number} commentCount
 */

/**
 * @typedef {Object} ReviewOverview
 * @property {{ id: string, repository: { name: string }, source: { kind: 'working-tree', base: string } }} review
 * @property {string} initialPath
 * @property {FileSummary[]} files
 * @property {ReviewComment[]} comments
 */

/**
 * @typedef {Object} FileContents
 * @property {string} name
 * @property {string} contents
 * @property {string} [lang]
 */

/**
 * @typedef {{ kind: 'file', path: string } | { kind: 'line', path: string, side: 'old' | 'new', startLine: number, endLine: number }} CommentTarget
 */

/**
 * @typedef {Object} ReviewComment
 * @property {string} id
 * @property {string} body
 * @property {CommentTarget} target
 */

/**
 * @typedef {Object} FileReview
 * @property {string} path
 * @property {FileStatus} status
 * @property {{ kind: 'diff', oldFile: FileContents | null, newFile: FileContents | null } | { kind: 'file', file: FileContents }} content
 */

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  })

  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`The rvw service returned an invalid response (${response.status})`)
  }

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `The rvw service returned ${response.status}`)
  }

  return body
}

/**
 * Loads metadata and file summaries for the active review.
 * @returns {Promise<ReviewOverview>}
 */
export async function getReviewOverview() {
  return getJson('/api/reviews/active')
}

/**
 * Loads display content for one canonical file path.
 * @param {string} reviewId
 * @param {string} path
 * @returns {Promise<FileReview>}
 */
export async function getFileReview(reviewId, path) {
  return getJson(
    `/api/reviews/${encodeURIComponent(reviewId)}/files?path=${encodeURIComponent(path)}`,
  )
}
