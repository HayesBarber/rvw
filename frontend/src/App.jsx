import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  copyCommentsAsMarkdown,
  createComment,
  getComments,
  getDiffOverview,
  getFile,
  getFileDiff,
  getFiles,
} from './api.js'
import DiffPane from './components/DiffPane.jsx'
import FileTreePane from './components/FileTreePane.jsx'

export default function App() {
  const [overview, setOverview] = useState(null)
  const [selectedPath, setSelectedPath] = useState(null)
  const [treeMode, setTreeMode] = useState('changes')
  const [allFilesRequest, setAllFilesRequest] = useState({
    status: 'idle',
    paths: [],
    error: null,
  })
  const [overviewError, setOverviewError] = useState(null)
  const [comments, setComments] = useState([])
  const [copyState, setCopyState] = useState({ status: 'idle', message: '' })
  const [fileRequest, setFileRequest] = useState({
    path: null,
    data: null,
    error: null,
  })

  useEffect(() => {
    let active = true

    getDiffOverview()
      .then((nextOverview) => {
        if (!active) return
        setOverview(nextOverview)
        setSelectedPath(nextOverview.initialPath)
      })
      .catch((error) => {
        if (active) setOverviewError(error.message)
      })

    getComments()
      .then((nextComments) => {
        if (active) setComments(nextComments)
      })
      .catch(() => {
        // Comments can still be created if the initial list request fails.
      })

    return () => {
      active = false
    }
  }, [])

  const changedPaths = useMemo(
    () => new Set(overview?.files.map((file) => file.path) ?? []),
    [overview],
  )
  const filesModeEntries = useMemo(() => {
    if (!overview) return []
    const changedByPath = new Map(overview.files.map((file) => [file.path, file]))
    const paths = new Set(allFilesRequest.paths)
    for (const file of overview.files) paths.add(file.path)
    return [...paths]
      .sort((left, right) => left.localeCompare(right))
      .map((path) => changedByPath.get(path) ?? {
        path,
        previousPath: null,
        status: 'unchanged',
        additions: null,
        deletions: null,
      })
  }, [allFilesRequest.paths, overview])
  const visibleFiles = useMemo(
    () => treeMode === 'files' ? filesModeEntries : (overview?.files ?? []),
    [filesModeEntries, overview, treeMode],
  )
  const activePath = useMemo(() => {
    const visiblePaths = new Set(visibleFiles.map((file) => file.path))
    if (selectedPath && visiblePaths.has(selectedPath)) return selectedPath
    if (overview?.initialPath && visiblePaths.has(overview.initialPath)) {
      return overview.initialPath
    }
    return visibleFiles[0]?.path ?? null
  }, [overview, selectedPath, visibleFiles])

  const loadAllFiles = useCallback(() => {
    setAllFilesRequest((current) => ({
      ...current,
      status: 'loading',
      error: null,
    }))
    getFiles()
      .then((paths) => {
        setAllFilesRequest({ status: 'success', paths, error: null })
      })
      .catch((error) => {
        setAllFilesRequest((current) => ({
          ...current,
          status: 'error',
          error: error.message,
        }))
      })
  }, [])

  useEffect(() => {
    if (!overview || !activePath) return

    let active = true

    const request = changedPaths.has(activePath)
      ? getFileDiff(overview.id, activePath)
      : getFile(activePath)

    request
      .then((nextFileDiff) => {
        if (active) {
          setFileRequest({
            path: activePath,
            data: nextFileDiff,
            error: null,
          })
        }
      })
      .catch((error) => {
        if (active) {
          setFileRequest({
            path: activePath,
            data: null,
            error: error.message,
          })
        }
      })

    return () => {
      active = false
    }
  }, [activePath, changedPaths, overview])

  if (overviewError) {
    return <main className="fatal-error">Unable to load review: {overviewError}</main>
  }

  if (!overview) {
    return <main className="fatal-error">Loading review…</main>
  }

  const fileLoading = activePath !== null && fileRequest.path !== activePath
  const fileDiff = !activePath || fileLoading ? null : fileRequest.data
  const fileError = !activePath || fileLoading ? null : fileRequest.error

  async function handleCreateComment(body, target, beforeCommit) {
    const comment = await createComment(body, target)
    beforeCommit?.()
    setComments((current) => (
      current.some((existing) => existing.id === comment.id)
        ? current
        : [...current, comment]
    ))
    setCopyState({ status: 'idle', message: '' })
    return comment
  }

  async function handleCopyComments() {
    setCopyState({ status: 'pending', message: 'Copying…' })
    try {
      const result = await copyCommentsAsMarkdown()
      const suffix = result.commentCount === 1 ? 'comment' : 'comments'
      setCopyState({
        status: 'success',
        message: `Copied ${result.commentCount} ${suffix}`,
      })
    } catch (error) {
      setCopyState({ status: 'error', message: error.message })
    }
  }

  function handleTreeModeChange(nextMode) {
    setTreeMode(nextMode)
    if (nextMode === 'files' && allFilesRequest.status === 'idle') {
      loadAllFiles()
    }
  }

  return (
    <main className="review-shell">
      <section className="pane tree-pane">
        <header className="pane-header">
          <strong>{overview.repository.name}</strong>
          <div className="tree-mode-toggle" role="group" aria-label="File tree mode">
            <button
              type="button"
              aria-pressed={treeMode === 'changes'}
              onClick={() => handleTreeModeChange('changes')}
            >
              Changes
            </button>
            <button
              type="button"
              aria-pressed={treeMode === 'files'}
              onClick={() => handleTreeModeChange('files')}
            >
              Files
            </button>
          </div>
        </header>
        <div className="pane-body">
          {treeMode === 'files' && allFilesRequest.status === 'loading' && (
            <p className="tree-load-status" role="status">Loading files…</p>
          )}
          {treeMode === 'files' && allFilesRequest.status === 'error' && (
            <div className="tree-load-error" role="alert">
              <span>Unable to load files: {allFilesRequest.error}</span>
              <button type="button" onClick={loadAllFiles}>Retry</button>
            </div>
          )}
          {visibleFiles.length === 0 && allFilesRequest.status !== 'loading' ? (
            <p className="tree-load-status">
              {treeMode === 'changes' ? 'No changes to review.' : 'No files found.'}
            </p>
          ) : (
            <FileTreePane
              key={`${treeMode}:${treeMode === 'files' ? allFilesRequest.status : 'ready'}`}
              files={visibleFiles}
              mode={treeMode}
              selectedPath={activePath}
              onSelectFile={setSelectedPath}
            />
          )}
        </div>
      </section>

      <section className="pane diff-pane">
        <header className="pane-header">
          <strong>{activePath ?? 'No file selected'}</strong>
          <div className="review-actions">
            {copyState.message && (
              <span
                className={`copy-status ${copyState.status}`}
                role={copyState.status === 'error' ? 'alert' : 'status'}
              >
                {copyState.message}
              </span>
            )}
            <button
              className="copy-markdown-button"
              type="button"
              disabled={comments.length === 0 || copyState.status === 'pending'}
              title={comments.length === 0 ? 'Add a comment before copying' : undefined}
              onClick={handleCopyComments}
            >
              Copy as Markdown
            </button>
          </div>
        </header>
        <div className="pane-body">
          <DiffPane
            key={activePath ?? 'no-file'}
            fileDiff={fileDiff}
            loading={fileLoading}
            error={fileError}
            comments={comments}
            onCreateComment={handleCreateComment}
          />
        </div>
      </section>
    </main>
  )
}
