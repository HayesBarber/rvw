import { useReducer } from 'react'
import DiffPane from '../components/DiffPane.jsx'
import FileFinder from '../components/FileFinder.jsx'
import FileTreePane from '../components/FileTreePane.jsx'
import KeyboardStatus from '../components/KeyboardStatus.jsx'
import KeymapReference from '../components/KeymapReference.jsx'
import { copyRequestMessage } from '../review/comment-copy-request.js'
import { RequestStatus } from '../review/request-state.js'
import { useReviewSession } from '../review/review-session.js'
import {
  ActiveSurface,
  initialWorkspaceState,
  TreeMode,
  workspaceReducer,
} from './workspace.js'
import { useVimController, useVimState } from '../vim/index.js'
import { useApplicationActions } from './use-application-actions.js'
import { useKeyboardConfiguration } from './use-keyboard-configuration.js'

export default function App() {
  const [workspace, dispatchWorkspace] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  )
  const vimController = useVimController()
  const vimState = useVimState()
  const keyboardConfiguration = useKeyboardConfiguration(vimController)
  const configurationDiagnostic = keyboardConfiguration.diagnostic
  const {
    activePath,
    allFilesRequest,
    canCommentOnFile,
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
    openFileFinder,
    openFinderFile: handleFinderOpen,
    overview,
    overviewRequest,
    selectFile,
    changeTreeMode: handleTreeModeChange,
    visibleFiles,
  } = useReviewSession({ workspace, dispatchWorkspace })
  const copyMessage = copyRequestMessage(copyRequest)
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
    navigateFile,
    openFileFinder,
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
              isCursorVisible={workspace.activeSurface === ActiveSurface.FILE_TREE}
              mode={workspace.treeMode}
              onFocusDiffPane={focusDiffPane}
              selectedPath={activePath}
              onSelectFile={handleTreeFileSelect}
              onShowChanges={showChanges}
              onShowFiles={showFiles}
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
            isCursorVisible={workspace.activeSurface === ActiveSurface.DIFF_PANE}
            loading={fileLoading}
            error={fileError}
            comments={comments}
            onCreateComment={handleCreateComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onFocusFileTree={focusFileTree}
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
          onClose={closeFileFinder}
          registerActionAdapter={registerFinderActions}
        />
      )}
      {workspace.keymapReferenceOpen && (
        <KeymapReference
          keymap={keyboardConfiguration.keymap}
          onClose={closeKeymapReference}
        />
      )}
      <KeyboardStatus diagnostic={configurationDiagnostic} vimState={vimState} />
    </div>
  )
}
