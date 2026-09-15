import { useCallback, useEffect, useReducer, useRef } from 'react'
import DiffPane from '../components/DiffPane.jsx'
import FileFinder from '../components/FileFinder.jsx'
import FileTreeDivider from '../components/FileTreeDivider.jsx'
import FileTreePane from '../components/FileTreePane.jsx'
import KeyboardStatus from '../components/KeyboardStatus.jsx'
import KeymapReference from '../components/KeymapReference.jsx'
import { clearRequestMessage } from '../review/comment-clear-request.js'
import { copyRequestMessage } from '../review/comment-copy-request.js'
import {
  filePathCopyRequestMessage,
  useCopyFilePath,
} from '../review/file-path-copy-request.js'
import { RequestStatus } from '../review/request-state.js'
import { useReviewSession } from '../review/review-session.js'
import {
  ActiveSurface,
  FinderMode,
  initialWorkspaceState,
  TreeMode,
  workspaceReducer,
} from './workspace.js'
import { useVimController, useVimState } from '../vim/index.js'
import { useApplicationActions } from './use-application-actions.js'
import { useConfiguration } from './use-configuration.js'

export default function App() {
  const [workspace, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  )
  const reviewShellRef = useRef(null)
  const resizeFileTree = useCallback((width) => {
    dispatchWorkspace({ type: 'file_tree_width_set', width })
  }, [])
  const toggleWrapLines = useCallback(() => {
    dispatchWorkspace({ type: 'wrap_lines_toggled' })
  }, [])
  const toggleRelativeLineNumbers = useCallback(() => {
    dispatchWorkspace({ type: 'relative_line_numbers_toggled' })
  }, [])
  const vimController = useVimController()
  const vimState = useVimState()
  const keyboardConfiguration = useConfiguration(vimController)
  const configurationDiagnostic = keyboardConfiguration.diagnostic
  useEffect(() => {
    dispatchWorkspace({
      type: 'wrap_lines_set',
      wrapLines: keyboardConfiguration.wrapLines,
    })
  }, [keyboardConfiguration.wrapLines])
  useEffect(() => {
    dispatchWorkspace({
      type: 'relative_line_numbers_set',
      relativeLineNumbers: keyboardConfiguration.relativeLineNumbers,
    })
  }, [keyboardConfiguration.relativeLineNumbers])
  const {
    activePath,
    allFilesRequest,
    canCommentOnFile,
    clearComments: handleClearComments,
    clearRequest,
    closeFileFinder,
    comments,
    copyComments: handleCopyComments,
    copyRequest,
    createReviewComment: handleCreateComment,
    deleteReviewComment: handleDeleteComment,
    editReviewComment: handleEditComment,
    fileDiff,
    fileError,
    fileLoading,
    filesModeEntries,
    navigateFile,
    notIgnoredFilesEntries,
    notIgnoredFilesRequest,
    openFileFinder,
    openFileFinderAll,
    openFinderFile: handleFinderOpen,
    overview,
    overviewRequest,
    selectFile,
    changeTreeMode: handleTreeModeChange,
    visibleFiles,
  } = useReviewSession({ workspace, dispatchWorkspace })
  const copyMessage = copyRequestMessage(copyRequest)
  const filePathCopyRequest = useCopyFilePath()
  const filePathCopyMessage = filePathCopyRequestMessage(filePathCopyRequest)
  const clearMessage = clearRequestMessage(clearRequest)
  const closeKeymapReference = () => {
    dispatchWorkspace({ type: 'keymap_reference_closed' })
  }
  const openKeymapReference = () => {
    dispatchWorkspace({ type: 'keymap_reference_opened' })
  }
  const {
    activateSurface,
    addFileComment: handleAddFileComment,
    diffPaneRef,
    fileTreePaneRef,
    focusDiffPane,
    focusFileTree,
    registerDiffPaneActions,
    registerFileTreeActions,
    registerFinderActions,
    selectTreeFile: handleTreeFileSelect,
    showChanges,
    showFiles,
  } = useApplicationActions({
    workspace,
    dispatchWorkspace,
    vimController,
    reviewAvailable: Boolean(overview),
    changeTreeMode: handleTreeModeChange,
    copyComments: handleCopyComments,
    clearComments: handleClearComments,
    navigateFile,
    openFileFinder,
    openFileFinderAll,
    openKeymapReference,
    selectFile,
  })

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
        ref={reviewShellRef}
        className="review-shell"
        data-active-surface={workspace.activeSurface}
        style={{ '--file-tree-width': `${workspace.fileTreeWidth}px` }}
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
          {visibleFiles.length === 0 && allFilesRequest.status !== RequestStatus.LOADING && (
            <p className="tree-load-status">
              {workspace.treeMode === TreeMode.CHANGES
                ? 'No changes to review.'
                : 'No files found.'}
            </p>
          )}
          <FileTreePane
            key={`${workspace.treeMode}:${workspace.treeMode === TreeMode.FILES ? allFilesRequest.status : 'ready'}`}
            files={visibleFiles}
            isCursorVisible={workspace.activeSurface === ActiveSurface.FILE_TREE}
            mode={workspace.treeMode}
            onFocusDiffPane={focusDiffPane}
            onCopyFilePath={filePathCopyRequest.copy}
            selectedPath={activePath}
            onSelectFile={handleTreeFileSelect}
            onShowChanges={showChanges}
            onShowFiles={showFiles}
            registerActionAdapter={registerFileTreeActions}
          />
        </div>
      </section>

      <FileTreeDivider
        shellRef={reviewShellRef}
        width={workspace.fileTreeWidth}
        onResize={resizeFileTree}
      />

      <section
        ref={diffPaneRef}
        className="pane diff-pane"
        tabIndex={-1}
        onPointerDown={() => activateSurface(ActiveSurface.DIFF_PANE)}
        onFocusCapture={() => activateSurface(ActiveSurface.DIFF_PANE)}
      >
        <header className="pane-header">
          <div className="file-path-heading">
            <strong>{activePath ?? 'No file selected'}</strong>
            <button
              className="file-path-copy-button"
              type="button"
              disabled={!activePath || filePathCopyRequest.status === RequestStatus.LOADING}
              title="Copy repository-relative path"
              aria-label="Copy repository-relative path"
              onClick={() => filePathCopyRequest.copy(activePath, 'relative')}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M5 1.75A1.75 1.75 0 0 1 6.75 0h7.5A1.75 1.75 0 0 1 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11H13V9.5h1.25a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5a.25.25 0 0 0-.25.25V3H5V1.75Z" />
                <path d="M1.75 5h7.5A1.75 1.75 0 0 1 11 6.75v7.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5A1.75 1.75 0 0 1 1.75 5Zm0 1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z" />
              </svg>
            </button>
            {filePathCopyMessage && (
              <span
                className={`file-path-copy-status ${filePathCopyRequest.status}`}
                role={filePathCopyRequest.status === RequestStatus.ERROR ? 'alert' : 'status'}
              >
                {filePathCopyMessage}
              </span>
            )}
          </div>
          <div className="review-actions">
            <button
              className="file-comment-button"
              type="button"
              disabled={!canCommentOnFile}
              onClick={handleAddFileComment}
            >
              Comment on file
            </button>
            <button
              className="file-finder-button"
              type="button"
              aria-keyshortcuts="Meta+P Control+P"
              title="Find file"
              onClick={openFileFinder}
            >
              Find file
            </button>
            {clearMessage && (
              <span
                className={`clear-status ${clearRequest.status}`}
                role={clearRequest.status === RequestStatus.ERROR ? 'alert' : 'status'}
              >
                {clearMessage}
              </span>
            )}
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
            filePath={activePath}
            isCursorVisible={workspace.activeSurface === ActiveSurface.DIFF_PANE}
            loading={fileLoading}
            error={fileError}
            comments={comments}
            onCreateComment={handleCreateComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onCopyFilePath={filePathCopyRequest.copy}
            onFocusFileTree={focusFileTree}
            onToggleRelativeLineNumbers={toggleRelativeLineNumbers}
            onToggleWrapLines={toggleWrapLines}
            relativeLineNumbers={workspace.relativeLineNumbers}
            registerActionAdapter={registerDiffPaneActions}
            wrapLines={workspace.wrapLines}
          />
        </div>
      </section>
      </main>
      {workspace.finderOpen && (
        <FileFinder
          files={workspace.finderMode === FinderMode.ALL
            ? filesModeEntries
            : notIgnoredFilesEntries}
          status={workspace.finderMode === FinderMode.ALL
            ? allFilesRequest.status
            : notIgnoredFilesRequest.status}
          error={workspace.finderMode === FinderMode.ALL
            ? allFilesRequest.error
            : notIgnoredFilesRequest.error}
          onRetry={workspace.finderMode === FinderMode.ALL
            ? allFilesRequest.load
            : notIgnoredFilesRequest.load}
          title={workspace.finderMode === FinderMode.ALL
            ? 'Find any file including ignored'
            : 'Find a file'}
          onOpen={handleFinderOpen}
          onClose={closeFileFinder}
          registerActionAdapter={registerFinderActions}
        />
      )}
      {workspace.keymapReferenceOpen && (
        <KeymapReference
          keymap={keyboardConfiguration.keymap}
          leader={keyboardConfiguration.leader}
          onClose={closeKeymapReference}
        />
      )}
      <KeyboardStatus diagnostic={configurationDiagnostic} vimState={vimState} />
    </div>
  )
}
