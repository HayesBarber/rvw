/** Shared review transport for native and development environments. */

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
 * @typedef {Object} ConfigurationDiagnostic
 * @property {'malformed_json' | 'invalid_schema' | 'file_read_failure'} code
 * @property {string} message
 * @property {string} path
 */

/**
 * Loads the startup snapshot of optional user configuration and its diagnostic.
 * @returns {Promise<{ configuration: Object, diagnostic: ConfigurationDiagnostic | null }>}
 */
export async function getConfiguration() {
  return requestJson('/api/configuration', { type: 'get_configuration' })
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
 * Lists every file exposed by the repository FileProvider.
 * @returns {Promise<string[]>}
 */
export async function getFiles() {
  return requestJson('/api/files', { type: 'get_files' })
}

/**
 * Loads one unchanged repository file in the same display shape as a diff.
 * @param {string} path
 * @returns {Promise<FileDiff>}
 */
export async function getFile(path) {
  return requestJson(
    `/api/files/content?path=${encodeURIComponent(path)}`,
    { type: 'get_file', path },
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

/**
 * Replaces only the body of an existing comment.
 * @param {string} commentId
 * @param {string} body
 * @returns {Promise<Comment>}
 */
export async function editComment(commentId, body) {
  const request = { type: 'edit_comment', commentId, body }
  return requestJson(`/api/comments/${encodeURIComponent(commentId)}`, request, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

/**
 * Permanently deletes an existing comment.
 * @param {string} commentId
 * @returns {Promise<{ commentId: string }>}
 */
export async function deleteComment(commentId) {
  const request = { type: 'delete_comment', commentId }
  return requestJson(`/api/comments/${encodeURIComponent(commentId)}`, request, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

/**
 * Copies every current review comment as structured Markdown.
 * @returns {Promise<{ commentCount: number }>}
 */
export async function copyCommentsAsMarkdown() {
  const request = { type: 'copy_comments_as_markdown' }
  return requestJson('/api/comments/copy-markdown', request, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

/**
 * @typedef {'debug' | 'info' | 'warning' | 'error'} LogLevel
 */

/**
 * Sends a structured frontend event to the shared application logger. The
 * backend owns the timestamp, source, and destination.
 * @param {LogLevel} level
 * @param {string} message
 * @param {{ context?: Object, metrics?: Object }} [details]
 * @returns {Promise<void>}
 */
export async function logEvent(level, message, details = {}) {
  const request = {
    type: 'log',
    level,
    message,
    ...(details.context === undefined ? {} : { context: details.context }),
    ...(details.metrics === undefined ? {} : { metrics: details.metrics }),
  }
  await requestJson('/api/logs', request, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}
