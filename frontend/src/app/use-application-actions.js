import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  APPLICATION_DISPATCH_COMMAND,
  ApplicationAction,
} from '../actions/application-actions.js'
import {
  createApplicationDispatcher,
  createSurfaceActionRegistry,
} from '../actions/application-dispatch.js'
import { openCodebaseSearch, openCodebaseSearchAll } from '../actions/codebase-search-actions.js'
import { closeApplication } from '../review/api.js'
import { ActiveSurface, TreeMode } from './workspace.js'

const blockingOverlayActions = Object.freeze({})

export function useApplicationActions({
  workspace,
  dispatchWorkspace,
  vimController,
  reviewAvailable,
  reloadReview,
  changeTreeMode,
  copyComments,
  clearComments,
  navigateFile,
  openFileFinder,
  openFileFinderAll,
  openKeymapReference,
  commandLine,
  selectFile,
}) {
  const fileTreePaneRef = useRef(null)
  const diffPaneRef = useRef(null)
  const finderActionsRef = useRef(null)
  const [surfaceActions] = useState(createSurfaceActionRegistry)

  const activateSurface = useCallback((surface) => {
    dispatchWorkspace({ type: 'surface_activated', surface })
  }, [dispatchWorkspace])

  const focusSurface = useCallback((surface) => {
    const pane = surface === ActiveSurface.FILE_TREE
      ? fileTreePaneRef.current
      : diffPaneRef.current
    if (!pane) return false

    activateSurface(surface)
    pane.focus({ preventScroll: true })
    return true
  }, [activateSurface])

  const selectTreeFile = useCallback((path) => {
    selectFile(path)
    requestAnimationFrame(() => focusSurface(ActiveSurface.DIFF_PANE))
  }, [focusSurface, selectFile])

  const focusFileTree = useCallback(
    () => focusSurface(ActiveSurface.FILE_TREE),
    [focusSurface],
  )
  const focusDiffPane = useCallback(
    () => focusSurface(ActiveSurface.DIFF_PANE),
    [focusSurface],
  )
  const showChanges = useCallback(
    () => changeTreeMode(TreeMode.CHANGES),
    [changeTreeMode],
  )
  const showFiles = useCallback(
    () => changeTreeMode(TreeMode.FILES),
    [changeTreeMode],
  )

  const registerFileTreeActions = useCallback(
    (adapter) => surfaceActions.register(ActiveSurface.FILE_TREE, adapter),
    [surfaceActions],
  )
  const registerDiffPaneActions = useCallback(
    (adapter) => surfaceActions.register(ActiveSurface.DIFF_PANE, adapter),
    [surfaceActions],
  )
  const registerFinderActions = useCallback((adapter) => {
    finderActionsRef.current = adapter
    return () => {
      if (finderActionsRef.current === adapter) finderActionsRef.current = null
    }
  }, [])

  const addFileComment = useCallback(() => {
    const action = surfaceActions
      .get(ActiveSurface.DIFF_PANE)?.[ApplicationAction.ADD_FILE_COMMENT]
    return typeof action === 'function' && action()
  }, [surfaceActions])

  const globalActions = useMemo(() => ({
    [ApplicationAction.OPEN_COMMAND_LINE]: () => reviewAvailable && commandLine.open(),
    [ApplicationAction.CLOSE_APPLICATION]: closeApplication,
    [ApplicationAction.RELOAD_REVIEW]: reloadReview,
    [ApplicationAction.TREE_SIZE_INCREASE]: (count) => {
      dispatchWorkspace({ type: 'file_tree_resized', steps: count })
      return true
    },
    [ApplicationAction.TREE_SIZE_DECREASE]: (count) => {
      dispatchWorkspace({ type: 'file_tree_resized', steps: -count })
      return true
    },
    [ApplicationAction.OPEN_NEXT_FILE]: (count) => navigateFile(1, count),
    [ApplicationAction.OPEN_PREVIOUS_FILE]: (count) => navigateFile(-1, count),
    [ApplicationAction.OPEN_FILE_FINDER]: () => {
      if (!reviewAvailable) return false
      openFileFinder()
      return true
    },
    [ApplicationAction.OPEN_FILE_FINDER_ALL]: () => {
      if (!reviewAvailable) return false
      openFileFinderAll()
      return true
    },
    [ApplicationAction.OPEN_CODEBASE_SEARCH]: () => {
      if (!reviewAvailable) return false
      return openCodebaseSearch()
    },
    [ApplicationAction.OPEN_CODEBASE_SEARCH_ALL]: () => {
      if (!reviewAvailable) return false
      return openCodebaseSearchAll()
    },
    [ApplicationAction.OPEN_KEYMAP_REFERENCE]: () => {
      if (!reviewAvailable) return false
      openKeymapReference()
      return true
    },
    [ApplicationAction.COPY_COMMENTS]: copyComments,
    [ApplicationAction.CLEAR_COMMENTS]: clearComments,
  }), [
    clearComments,
    commandLine,
    copyComments,
    dispatchWorkspace,
    navigateFile,
    openFileFinder,
    openFileFinderAll,
    openKeymapReference,
    reviewAvailable,
    reloadReview,
  ])

  const dispatchApplicationAction = useMemo(() => createApplicationDispatcher({
    getActiveSurface: () => workspace.activeSurface,
    getSurfaceActions: surfaceActions.get,
    getOverlayActions: () => {
      if (workspace.keymapReferenceOpen) return blockingOverlayActions
      return workspace.finderOpen ? finderActionsRef.current : null
    },
    globalActions,
  }), [
    globalActions,
    surfaceActions,
    workspace.activeSurface,
    workspace.finderOpen,
    workspace.keymapReferenceOpen,
  ])

  useEffect(() => {
    return vimController.subscribeCommands((command) => {
      if (command.command !== APPLICATION_DISPATCH_COMMAND) return false
      return dispatchApplicationAction(command.args.actions, command.count)
    })
  }, [dispatchApplicationAction, vimController])

  return {
    dispatchApplicationAction,
    activateSurface,
    addFileComment,
    diffPaneRef,
    fileTreePaneRef,
    focusDiffPane,
    focusFileTree,
    registerDiffPaneActions,
    registerFileTreeActions,
    registerFinderActions,
    selectTreeFile,
    showChanges,
    showFiles,
  }
}
