import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createCommandLine } from '../actions/command-line.js'
import CommandLine from '../components/CommandLine.jsx'
import ApplicationFooter from '../components/ApplicationFooter.jsx'
import DiffPane from '../components/DiffPane.jsx'
import FileFinder from '../components/FileFinder.jsx'
import CodebaseSearch from '../components/CodebaseSearch.jsx'
import { ApplicationAction } from '../actions/application-actions.js'
import {
  FileHeaderActions,
  FilePathCopyControl,
} from '../components/FileHeaderControls.jsx'
import FileTreeDivider from '../components/FileTreeDivider.jsx'
import FileTreePane from '../components/FileTreePane.jsx'
import KeymapReference from '../components/KeymapReference.jsx'
import { clearRequestMessage } from '../review/comment-clear-request.js'
import { copyRequestMessage } from '../review/comment-copy-request.js'
import { useCopyFilePath } from '../review/file-path-copy-request.js'
import { RequestStatus } from '../review/request-state.js'
import { reloadRequestMessage } from '../review/reload-request.js'
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
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false)
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
  const [commandState, setCommandState] = useState({ open: false, error: null })
  const [commandLine] = useState(() => createCommandLine({
    getFocus: () => document.activeElement,
    setMode: (mode) => vimController.dispatch({ type: 'set_mode', mode }),
    onChange: setCommandState,
  }))
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
    reloadRequest,
    selectFile,
    changeTreeMode: handleTreeModeChange,
    visibleFiles,
  } = useReviewSession({ workspace, dispatchWorkspace, hasUnsavedDraft })
  const copyMessage = copyRequestMessage(copyRequest)
  const filePathCopyRequest = useCopyFilePath()
  const clearMessage = clearRequestMessage(clearRequest)
  const reloadMessage = reloadRequestMessage(reloadRequest)
  const reloadMessageIsError = reloadRequest.status === RequestStatus.ERROR
  const closeKeymapReference = () => {
    dispatchWorkspace({ type: 'keymap_reference_closed' })
  }
  const openKeymapReference = () => {
    dispatchWorkspace({ type: 'keymap_reference_opened' })
  }
  const {
    activateSurface,
    dispatchApplicationAction,
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
    commandLine,
    reviewAvailable: Boolean(overview),
    reloadReview: reloadRequest.reload,
    changeTreeMode: handleTreeModeChange,
    copyComments: handleCopyComments,
    clearComments: handleClearComments,
    navigateFile,
    openFileFinder,
    openFileFinderAll,
    openKeymapReference,
    selectFile,
  })
  const renderFilePathCopyControl = useCallback(() => (
    <FilePathCopyControl
      path={activePath}
      request={filePathCopyRequest}
      onCopy={filePathCopyRequest.copy}
    />
  ), [activePath, filePathCopyRequest])
  const renderFileHeaderActions = useCallback(() => (
    <FileHeaderActions
      canCommentOnFile={canCommentOnFile}
      onCommentOnFile={handleAddFileComment}
    />
  ), [canCommentOnFile, handleAddFileComment])

  if (overviewRequest.status === RequestStatus.ERROR && !overview) {
    return (
      <div className="application-shell">
        <main className="fatal-error">
          Unable to load review: {overviewRequest.error}
        </main>
        <ApplicationFooter diagnostic={configurationDiagnostic} vimState={vimState} />
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="application-shell">
        <main className="fatal-error">Loading review…</main>
        <ApplicationFooter diagnostic={configurationDiagnostic} vimState={vimState} />
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
          <div className="tree-navigation-actions">
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
            <button
              className="file-finder-button"
              type="button"
              aria-keyshortcuts="Meta+P Control+P"
              title="Find file"
              aria-label="Find file"
              onClick={openFileFinder}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="M6.75 1a5.75 5.75 0 1 0 3.58 10.25l3.71 3.71a.75.75 0 1 0 1.06-1.06l-3.7-3.71A5.75 5.75 0 0 0 6.75 1Zm-4.25 5.75a4.25 4.25 0 1 1 8.5 0 4.25 4.25 0 0 1-8.5 0Z" />
              </svg>
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
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) &&
              !event.relatedTarget?.closest('[data-command-line]')) {
            vimController.dispatch({ type: 'set_mode', mode: 'normal' })
          }
        }}
        tabIndex={-1}
        onPointerDown={() => activateSurface(ActiveSurface.DIFF_PANE)}
        onFocusCapture={() => activateSurface(ActiveSurface.DIFF_PANE)}
      >
        <div className="pane-body">
          <DiffPane
            key={activePath ?? 'no-file'}
            fileDiff={fileDiff}
            filePath={activePath}
            isCursorVisible={workspace.activeSurface === ActiveSurface.DIFF_PANE}
            visualSelectionEnabled={workspace.activeSurface === ActiveSurface.DIFF_PANE &&
              !workspace.finderOpen && !workspace.searchMode && !workspace.keymapReferenceOpen}
            loading={fileLoading}
            error={fileError}
            comments={comments}
            commentTypes={keyboardConfiguration.commentTypes}
            defaultCommentType={keyboardConfiguration.defaultCommentType}
            onCreateComment={handleCreateComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onDraftStateChange={setHasUnsavedDraft}
            onCopyFilePath={filePathCopyRequest.copy}
            onFocusFileTree={focusFileTree}
            onToggleRelativeLineNumbers={toggleRelativeLineNumbers}
            onToggleWrapLines={toggleWrapLines}
            relativeLineNumbers={workspace.relativeLineNumbers}
            registerActionAdapter={registerDiffPaneActions}
            renderHeaderFilenameSuffix={renderFilePathCopyControl}
            renderHeaderMetadata={renderFileHeaderActions}
            wrapLines={workspace.wrapLines}
          />
        </div>
      </section>
      </main>
      {workspace.searchMode && (
        <CodebaseSearch
          initialMode={workspace.searchMode}
          onClose={() => dispatchWorkspace({ type: 'search_closed' })}
          registerActionAdapter={registerFinderActions}
        />
      )}
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
      <ApplicationFooter
        commandLine={commandState.open && (
          <CommandLine
            controller={commandLine}
            aliases={keyboardConfiguration.commandAliases}
            dispatch={dispatchApplicationAction}
            error={commandState.error}
          />
        )}
        clearMessage={clearMessage}
        clearStatus={clearRequest.status}
        commentsCount={comments.length}
        copyMessage={copyMessage}
        copyRequest={copyRequest}
        diagnostic={configurationDiagnostic}
        onCopyComments={handleCopyComments}
        onReload={reloadRequest.reload}
        onSearchText={() => dispatchApplicationAction(ApplicationAction.OPEN_CODEBASE_SEARCH)}
        reloadDisabled={hasUnsavedDraft || reloadRequest.status === RequestStatus.LOADING}
        reloadMessage={reloadMessage}
        reloadMessageIsError={reloadMessageIsError}
        reloadStatus={reloadRequest.status}
        repositoryName={overview.repository.name}
        source={overview.source}
        vimState={vimState}
      />
    </div>
  )
}
