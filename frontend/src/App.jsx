import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
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
import FileFinder from './components/FileFinder.jsx'
import FileTreePane from './components/FileTreePane.jsx'
import {
  ActiveSurface,
  initialWorkspaceState,
  TreeMode,
  workspaceReducer,
} from './workspace.js'

export default function App() {
  const [overview, setOverview] = useState(null)
  const [workspace, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  )
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
        dispatchWorkspace({
          type: 'review_loaded',
          initialPath: nextOverview.initialPath,
        })
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
    () => workspace.treeMode === TreeMode.FILES
      ? filesModeEntries
      : (overview?.files ?? []),
    [filesModeEntries, overview, workspace.treeMode],
  )
  const activePath = useMemo(() => {
    const visiblePaths = new Set(visibleFiles.map((file) => file.path))
    if (workspace.selectedPath && visiblePaths.has(workspace.selectedPath)) {
      return workspace.selectedPath
    }
    if (overview?.initialPath && visiblePaths.has(overview.initialPath)) {
      return overview.initialPath
    }
    return visibleFiles[0]?.path ?? null
  }, [overview, visibleFiles, workspace.selectedPath])

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

  const openFileFinder = useCallback(() => {
    dispatchWorkspace({ type: 'finder_opened' })
    if (allFilesRequest.status === 'idle') loadAllFiles()
  }, [allFilesRequest.status, loadAllFiles])

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openFileFinder()
      }
    }

    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [openFileFinder])

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
    const nextFiles = nextMode === TreeMode.FILES
      ? filesModeEntries
      : overview.files
    dispatchWorkspace({
      type: 'tree_mode_changed',
      mode: nextMode,
      visiblePaths: nextFiles.map((file) => file.path),
      initialPath: overview.initialPath,
    })
    if (nextMode === TreeMode.FILES && allFilesRequest.status === 'idle') {
      loadAllFiles()
    }
  }

  function handleFinderOpen(path) {
    dispatchWorkspace({
      type: 'finder_file_opened',
      path,
      changed: changedPaths.has(path),
    })
  }

  const activateSurface = (surface) => {
    dispatchWorkspace({ type: 'surface_activated', surface })
  }

  return (
    <>
      <main
        className="review-shell"
        data-active-surface={workspace.activeSurface}
      >
      <section
        className="pane tree-pane"
        onPointerDown={() => activateSurface(ActiveSurface.FILE_TREE)}
        onFocusCapture={() => activateSurface(ActiveSurface.FILE_TREE)}
      >
        <header className="pane-header">
          <strong>{overview.repository.name}</strong>
          <div className="tree-mode-toggle" role="group" aria-label="File tree mode">
            <button
              type="button"
              aria-pressed={workspace.treeMode === TreeMode.CHANGES}
              onClick={() => handleTreeModeChange(TreeMode.CHANGES)}
            >
              Changes
            </button>
            <button
              type="button"
              aria-pressed={workspace.treeMode === TreeMode.FILES}
              onClick={() => handleTreeModeChange(TreeMode.FILES)}
            >
              Files
            </button>
          </div>
        </header>
        <div className="pane-body">
          {workspace.treeMode === TreeMode.FILES && allFilesRequest.status === 'loading' && (
            <p className="tree-load-status" role="status">Loading files…</p>
          )}
          {workspace.treeMode === TreeMode.FILES && allFilesRequest.status === 'error' && (
            <div className="tree-load-error" role="alert">
              <span>Unable to load files: {allFilesRequest.error}</span>
              <button type="button" onClick={loadAllFiles}>Retry</button>
            </div>
          )}
          {visibleFiles.length === 0 && allFilesRequest.status !== 'loading' ? (
            <p className="tree-load-status">
              {workspace.treeMode === TreeMode.CHANGES
                ? 'No changes to review.'
                : 'No files found.'}
            </p>
          ) : (
            <FileTreePane
              key={`${workspace.treeMode}:${workspace.treeMode === TreeMode.FILES ? allFilesRequest.status : 'ready'}:${activePath ?? 'none'}`}
              files={visibleFiles}
              mode={workspace.treeMode}
              selectedPath={activePath}
              onSelectFile={(path) => dispatchWorkspace({
                type: 'file_selected',
                path,
              })}
            />
          )}
        </div>
      </section>

      <section
        className="pane diff-pane"
        onPointerDown={() => activateSurface(ActiveSurface.DIFF_PANE)}
        onFocusCapture={() => activateSurface(ActiveSurface.DIFF_PANE)}
      >
        <header className="pane-header">
          <strong>{activePath ?? 'No file selected'}</strong>
          <div className="review-actions">
            <button
              className="file-finder-button"
              type="button"
              aria-keyshortcuts="Meta+P Control+P"
              title="Find file (⌘P / Ctrl+P)"
              onClick={openFileFinder}
            >
              Find file
            </button>
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
      {workspace.finderOpen && (
        <FileFinder
          files={filesModeEntries}
          status={allFilesRequest.status}
          error={allFilesRequest.error}
          onRetry={loadAllFiles}
          onOpen={handleFinderOpen}
          onClose={() => dispatchWorkspace({ type: 'finder_closed' })}
        />
      )}
    </>
  )
}
