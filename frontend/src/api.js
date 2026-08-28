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

async function getJson(url, nativeRequest) {
  const native = window.webkit?.messageHandlers?.native
  if (native) return native.postMessage(nativeRequest)

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
 * Loads metadata and file summaries for the active diff.
 * @returns {Promise<DiffOverview>}
 */
export async function getDiffOverview() {
  return getJson('/api/diffs/active', { type: 'get_diff_overview' })
}

/**
 * Loads display content for one canonical file path.
 * @param {string} diffId
 * @param {string} path
 * @returns {Promise<FileDiff>}
 */
export async function getFileDiff(diffId, path) {
  return getJson(
    `/api/diffs/${encodeURIComponent(diffId)}/files?path=${encodeURIComponent(path)}`,
    { type: 'get_file_diff', diffId, path },
  )
}
