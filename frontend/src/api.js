/**
 * @typedef {'modified' | 'added' | 'deleted' | 'renamed' | 'unchanged'} FileStatus
 */

/**
 * @typedef {Object} FileSummary
 * @property {string} path Canonical repository-relative path.
 * @property {string | null} previousPath
 * @property {FileStatus} status
 * @property {number | null} additions
 * @property {number | null} deletions
 */

/**
 * @typedef {Object} DiffOverview
 * @property {string} id
 * @property {{ name: string }} repository
 * @property {{ kind: 'working-tree', base: string } | { kind: 'commit-range', base: string, head: string }} source
 * @property {string | null} initialPath
 * @property {FileSummary[]} files
 */

/**
 * @typedef {Object} FileContents
 * @property {string} name
 * @property {string} contents
 * @property {string} [lang]
 */

/**
 * @typedef {Object} FileDiff
 * @property {string} path
 * @property {string | null} previousPath
 * @property {FileStatus} status
 * @property {{ kind: 'diff', oldFile: FileContents | null, newFile: FileContents | null } | { kind: 'file', file: FileContents } | { kind: 'unavailable', reason: 'binary' | 'invalid-utf8' | 'too-large' | 'symlink' | 'submodule' }} content
 */

async function requestJson(url, nativeRequest, options = {}) {
  const native = window.webkit?.messageHandlers?.native
  if (native) return native.postMessage(nativeRequest)

  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
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
 * Loads metadata and file summaries for the active diff.
 * @returns {Promise<DiffOverview>}
 */
export async function getDiffOverview() {
  return requestJson('/api/diffs/active', { type: 'get_diff_overview' })
}

/**
 * Loads display content for one canonical file path.
 * @param {string} diffId
 * @param {string} path
 * @returns {Promise<FileDiff>}
 */
export async function getFileDiff(diffId, path) {
  return requestJson(
    `/api/diffs/${encodeURIComponent(diffId)}/files?path=${encodeURIComponent(path)}`,
    { type: 'get_file_diff', diffId, path },
  )
}

/**
 * @typedef {Object} Comment
 * @property {string} id
 * @property {string} body
 * @property {{ kind: 'file', path: string } | { kind: 'line', path: string, side: 'old' | 'new', startLine: number, endLine: number }} target
 */

/**
 * Loads every comment for the active review.
 * @returns {Promise<Comment[]>}
 */
export async function getComments() {
  return requestJson('/api/comments', { type: 'get_comments' })
}

/**
 * Creates a comment for the active review.
 * @param {string} body
 * @param {Comment['target']} target
 * @returns {Promise<Comment>}
 */
export async function createComment(body, target) {
  const request = { type: 'create_comment', body, target }
  return requestJson('/api/comments', request, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}
