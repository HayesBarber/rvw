import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import DiffPane from './components/DiffPane.jsx'
import FileFinder from './components/FileFinder.jsx'
import FileTreePane from './components/FileTreePane.jsx'
import KeyboardStatus from './components/KeyboardStatus.jsx'
import {
  createApplicationDispatcher,
  createSurfaceActionRegistry,
} from './application-dispatch.js'
import { ApplicationAction } from './application-actions.js'
import { loadKeyboardConfiguration } from './keyboard-configuration.js'
import {
  RequestStatus,
  useCopyComments,
  useRepositoryFiles,
  useReviewComments,
  useReviewFile,
  useReviewOverview,
} from './review-data.js'
import {
  ActiveSurface,
  initialWorkspaceState,
  TreeMode,
  workspaceReducer,
} from './workspace.js'
import { useVimController, useVimState } from './vim/index.js'

export default function App() {
  const [workspace, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  )
  const overviewRequest = useReviewOverview()
  const allFilesRequest = useRepositoryFiles()
  const commentsRequest = useReviewComments()
  const copyRequest = useCopyComments()
  const overview = overviewRequest.data
  const vimController = useVimController()
  const vimState = useVimState()
  const [configurationDiagnostic, setConfigurationDiagnostic] = useState(null)
  const fileTreePaneRef = useRef(null)
  const diffPaneRef = useRef(null)
  const [surfaceActions] = useState(createSurfaceActionRegistry)

  useEffect(() => {
    let active = true

    loadKeyboardConfiguration().then(({ bindings, diagnostic }) => {
      if (!active) return
      if (bindings) vimController.setBindings(bindings)
      setConfigurationDiagnostic(diagnostic)
    })

    return () => {
      active = false
    }
  }, [vimController])

  useEffect(() => {
    if (!overview) return
    dispatchWorkspace({
      type: 'review_loaded',
      initialPath: overview.initialPath,
    })
  }, [overview])

  const changedPaths = useMemo(
    () => new Set(overview?.files.map((file) => file.path) ?? []),
    [overview],
  )
  const filesModeEntries = useMemo(() => {
    if (!overview) return []
    const changedByPath = new Map(overview.files.map((file) => [file.path, file]))
    const paths = new Set(allFilesRequest.data)
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
  }, [allFilesRequest.data, overview])
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

  const openFileFinder = useCallback(() => {
    dispatchWorkspace({ type: 'finder_opened' })
    if (allFilesRequest.status === RequestStatus.IDLE) allFilesRequest.load()
  }, [allFilesRequest])

  const fileRequest = useReviewFile({
    diffId: overview?.id ?? null,
    path: activePath,
    changed: changedPaths.has(activePath),
  })

  const fileLoading = fileRequest.status === RequestStatus.LOADING
  const fileDiff = fileRequest.status === RequestStatus.SUCCESS
    ? fileRequest.data
    : null
  const fileError = fileRequest.status === RequestStatus.ERROR
    ? fileRequest.error
    : null
  const comments = commentsRequest.data
  const copyMessage = (() => {
    if (copyRequest.status === RequestStatus.LOADING) return 'Copying…'
    if (copyRequest.status === RequestStatus.ERROR) return copyRequest.error
    if (copyRequest.status !== RequestStatus.SUCCESS) return ''
    const suffix = copyRequest.data.commentCount === 1 ? 'comment' : 'comments'
    return `Copied ${copyRequest.data.commentCount} ${suffix}`
  })()

  async function handleCreateComment(body, target, beforeCommit) {
    const comment = await commentsRequest.create(body, target, beforeCommit)
    copyRequest.reset()
    return comment
  }

  async function handleEditComment(commentId, body, beforeCommit) {
    const comment = await commentsRequest.edit(commentId, body, beforeCommit)
    copyRequest.reset()
    return comment
  }

  async function handleDeleteComment(commentId, beforeCommit) {
    const result = await commentsRequest.remove(commentId, beforeCommit)
    copyRequest.reset()
    return result
  }

  const handleCopyComments = useCallback(() => {
    if (
      commentsRequest.data.length === 0 ||
      copyRequest.status === RequestStatus.LOADING
    ) {
      return false
    }

    copyRequest.copy().catch(() => {
      // The request exposes its error for the existing status message.
    })
    return true
  }, [commentsRequest.data.length, copyRequest])

  const handleTreeModeChange = useCallback((nextMode) => {
    if (!overview) return false
    const nextFiles = nextMode === TreeMode.FILES
      ? filesModeEntries
      : overview.files
    dispatchWorkspace({
      type: 'tree_mode_changed',
      mode: nextMode,
      visiblePaths: nextFiles.map((file) => file.path),
      initialPath: overview.initialPath,
    })
    if (
      nextMode === TreeMode.FILES &&
      allFilesRequest.status === RequestStatus.IDLE
    ) {
      allFilesRequest.load()
    }
    return true
  }, [allFilesRequest, filesModeEntries, overview])

  const focusSurface = useCallback((surface) => {
    const pane = surface === ActiveSurface.FILE_TREE
      ? fileTreePaneRef.current
      : diffPaneRef.current
    if (!pane) return false

    dispatchWorkspace({ type: 'surface_activated', surface })
    pane.focus({ preventScroll: true })
    return true
  }, [])

  const handleTreeFileSelect = useCallback((path) => {
    dispatchWorkspace({
      type: 'file_selected',
      path,
    })
    requestAnimationFrame(() => focusSurface(ActiveSurface.DIFF_PANE))
  }, [focusSurface])

  const registerFileTreeActions = useCallback(
    (adapter) => surfaceActions.register(ActiveSurface.FILE_TREE, adapter),
    [surfaceActions],
  )
  const registerDiffPaneActions = useCallback(
    (adapter) => surfaceActions.register(ActiveSurface.DIFF_PANE, adapter),
    [surfaceActions],
  )

  const globalActions = useMemo(() => ({
    [ApplicationAction.FOCUS_FILE_TREE]: () => (
      focusSurface(ActiveSurface.FILE_TREE)
    ),
    [ApplicationAction.FOCUS_DIFF_PANE]: () => (
      focusSurface(ActiveSurface.DIFF_PANE)
    ),
    [ApplicationAction.SHOW_CHANGES]: () => (
      handleTreeModeChange(TreeMode.CHANGES)
    ),
    [ApplicationAction.SHOW_FILES]: () => (
      handleTreeModeChange(TreeMode.FILES)
    ),
    [ApplicationAction.OPEN_FILE_FINDER]: () => {
      if (!overview) return false
      openFileFinder()
      return true
    },
    [ApplicationAction.COPY_COMMENTS]: handleCopyComments,
  }), [
    focusSurface,
    handleCopyComments,
    handleTreeModeChange,
    openFileFinder,
    overview,
  ])

  useEffect(() => {
    const dispatchApplicationAction = createApplicationDispatcher({
      getActiveSurface: () => workspace.activeSurface,
      getSurfaceActions: surfaceActions.get,
      globalActions,
    })
    return vimController.subscribeCommands((command) => (
      dispatchApplicationAction(command.command, command.count)
    ))
  }, [globalActions, surfaceActions, vimController, workspace.activeSurface])

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

  if (overviewRequest.status === RequestStatus.ERROR) {
    return (
      <div className="application-shell">
        <main className="fatal-error">
          Unable to load review: {overviewRequest.error}
        </main>
        <KeyboardStatus diagnostic={configurationDiagnostic} vimState={vimState} />
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="application-shell">
        <main className="fatal-error">Loading review…</main>
        <KeyboardStatus diagnostic={configurationDiagnostic} vimState={vimState} />
      </div>
    )
  }

  return (
    <div className="application-shell">
      <main
        className="review-shell"
        data-active-surface={workspace.activeSurface}
      >
      <section
        ref={fileTreePaneRef}
        className="pane tree-pane"
        tabIndex={-1}
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
          {workspace.treeMode === TreeMode.FILES && allFilesRequest.status === RequestStatus.LOADING && (
            <p className="tree-load-status" role="status">Loading files…</p>
          )}
          {workspace.treeMode === TreeMode.FILES && allFilesRequest.status === RequestStatus.ERROR && (
            <div className="tree-load-error" role="alert">
              <span>Unable to load files: {allFilesRequest.error}</span>
              <button type="button" onClick={allFilesRequest.load}>Retry</button>
            </div>
          )}
          {visibleFiles.length === 0 && allFilesRequest.status !== RequestStatus.LOADING ? (
            <p className="tree-load-status">
              {workspace.treeMode === TreeMode.CHANGES
                ? 'No changes to review.'
                : 'No files found.'}
            </p>
          ) : (
            <FileTreePane
              key={`${workspace.treeMode}:${workspace.treeMode === TreeMode.FILES ? allFilesRequest.status : 'ready'}`}
              files={visibleFiles}
              mode={workspace.treeMode}
              selectedPath={activePath}
              onSelectFile={handleTreeFileSelect}
              registerActionAdapter={registerFileTreeActions}
            />
          )}
        </div>
      </section>

      <section
        ref={diffPaneRef}
        className="pane diff-pane"
        tabIndex={-1}
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
            {copyMessage && (
              <span
                className={`copy-status ${copyRequest.status}`}
                role={copyRequest.status === RequestStatus.ERROR ? 'alert' : 'status'}
              >
                {copyMessage}
              </span>
            )}
            <button
              className="copy-markdown-button"
              type="button"
              disabled={
                comments.length === 0 ||
                copyRequest.status === RequestStatus.LOADING
              }
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
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            registerActionAdapter={registerDiffPaneActions}
          />
        </div>
      </section>
      </main>
      {workspace.finderOpen && (
        <FileFinder
          files={filesModeEntries}
          status={allFilesRequest.status}
          error={allFilesRequest.error}
          onRetry={allFilesRequest.load}
          onOpen={handleFinderOpen}
          onClose={() => dispatchWorkspace({ type: 'finder_closed' })}
        />
      )}
      <KeyboardStatus diagnostic={configurationDiagnostic} vimState={vimState} />
    </div>
  )
}
