import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ActiveSurface,
  FILE_TREE_WIDTH,
  TreeMode,
  initialWorkspaceState,
  workspaceReducer,
} from './workspace.js'

test('initial active surface is the diff pane', () => {
  assert.equal(initialWorkspaceState.activeSurface, ActiveSurface.DIFF_PANE)
})

test('file-tree width starts at the existing layout width', () => {
  assert.equal(initialWorkspaceState.fileTreeWidth, 320)
  assert.equal(initialWorkspaceState.fileTreeWidth, FILE_TREE_WIDTH.INITIAL)
})

test('file-tree Vim resize scales by counts with only a defensive upper bound', () => {
  assert.equal(FILE_TREE_WIDTH.VIM_MAX, 17_000)

  const widened = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_resized',
    steps: 2,
  })
  assert.equal(widened.fileTreeWidth, 400)

  const large = workspaceReducer(widened, {
    type: 'file_tree_resized',
    steps: 100,
  })
  assert.equal(large.fileTreeWidth, 4400)

  const defensiveMaximum = workspaceReducer(large, {
    type: 'file_tree_resized',
    steps: 1000,
  })
  assert.equal(defensiveMaximum.fileTreeWidth, FILE_TREE_WIDTH.VIM_MAX)
  assert.equal(workspaceReducer(defensiveMaximum, {
    type: 'file_tree_resized',
    steps: 1,
  }), defensiveMaximum)

  const decreased = workspaceReducer(defensiveMaximum, {
    type: 'file_tree_resized',
    steps: -400,
  })
  assert.equal(decreased.fileTreeWidth, 1000)
  const physicalMinimum = workspaceReducer(decreased, {
    type: 'file_tree_resized',
    steps: -100,
  })
  assert.equal(physicalMinimum.fileTreeWidth, 0)
  assert.equal(workspaceReducer(physicalMinimum, {
    type: 'file_tree_resized',
    steps: -1,
  }), physicalMinimum)
})

test('pointer resize stores continuous widths without an artificial maximum', () => {
  const resized = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_width_set',
    width: 517.25,
  })
  assert.equal(resized.fileTreeWidth, 517.25)

  const unbounded = workspaceReducer(resized, {
    type: 'file_tree_width_set',
    width: 5000,
  })
  assert.equal(unbounded.fileTreeWidth, 5000)

  const zero = workspaceReducer(unbounded, {
    type: 'file_tree_width_set',
    width: -25,
  })
  assert.equal(zero.fileTreeWidth, 0)
})

test('invalid pointer widths are a safe no-op', () => {
  for (const width of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '320']) {
    assert.equal(workspaceReducer(initialWorkspaceState, {
      type: 'file_tree_width_set',
      width,
    }), initialWorkspaceState)
  }
})

test('finder mode defaults to visible and resets when closed or opened', () => {
  const bare = workspaceReducer(initialWorkspaceState, { type: 'finder_opened' })
  assert.equal(bare.finderOpen, true)
  assert.equal(bare.finderMode, 'visible')

  const all = workspaceReducer(bare, {
    type: 'finder_opened',
    mode: 'all',
  })
  assert.equal(all.finderOpen, true)
  assert.equal(all.finderMode, 'all')

  const reopenedVisible = workspaceReducer(all, {
    type: 'finder_opened',
    mode: 'visible',
  })
  assert.equal(reopenedVisible.finderMode, 'visible')

  const closed = workspaceReducer(reopenedVisible, { type: 'finder_closed' })
  assert.equal(closed.finderOpen, false)
  assert.equal(closed.finderMode, null)

  const opened = workspaceReducer(closed, {
    type: 'finder_opened',
    mode: 'all',
  })
  const openedFile = workspaceReducer(opened, {
    type: 'finder_file_opened',
    path: 'README.md',
    changed: false,
  })
  assert.equal(openedFile.finderOpen, false)
  assert.equal(openedFile.finderMode, null)
})

test('file-tree width survives normal workspace transitions', () => {
  const resized = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_resized',
    steps: 2,
  })
  const transitions = [
    {
      type: 'tree_mode_changed',
      mode: TreeMode.FILES,
      visiblePaths: ['src/main.zig'],
      initialPath: 'src/main.zig',
    },
    { type: 'file_selected', path: 'src/main.zig' },
    { type: 'finder_opened' },
    {
      type: 'finder_file_opened',
      path: 'README.md',
      changed: false,
    },
    { type: 'surface_activated', surface: ActiveSurface.FILE_TREE },
    { type: 'review_loaded', initialPath: 'build.zig' },
  ]

  const finalState = transitions.reduce(workspaceReducer, resized)
  assert.equal(finalState.fileTreeWidth, 400)
})

test('invalid resize steps are a safe no-op', () => {
  for (const steps of [undefined, Number.NaN, 1.5, '2']) {
    assert.equal(workspaceReducer(initialWorkspaceState, {
      type: 'file_tree_resized',
      steps,
    }), initialWorkspaceState)
  }
})

test('workspace transitions keep a single authoritative active surface', () => {
  const diffActive = workspaceReducer(initialWorkspaceState, {
    type: 'surface_activated',
    surface: ActiveSurface.DIFF_PANE,
  })
  assert.equal(diffActive.activeSurface, ActiveSurface.DIFF_PANE)
  assert.equal(workspaceReducer(diffActive, {
    type: 'surface_activated',
    surface: ActiveSurface.DIFF_PANE,
  }), diffActive)

  const treeActive = workspaceReducer(diffActive, {
    type: 'surface_activated',
    surface: ActiveSurface.FILE_TREE,
  })
  assert.equal(treeActive.activeSurface, ActiveSurface.FILE_TREE)

  const finderSelection = workspaceReducer(treeActive, {
    type: 'finder_file_opened',
    path: 'src/main.zig',
    changed: true,
  })
  assert.equal(finderSelection.activeSurface, ActiveSurface.DIFF_PANE)
  assert.equal(finderSelection.selectedPath, 'src/main.zig')
})

test('file selection preserves the active tree mode and surface', () => {
  const filesModeDiffActive = {
    ...initialWorkspaceState,
    treeMode: TreeMode.FILES,
    activeSurface: ActiveSurface.DIFF_PANE,
    selectedPath: 'README.md',
  }

  const selected = workspaceReducer(filesModeDiffActive, {
    type: 'file_selected',
    path: 'src/main.zig',
  })

  assert.equal(selected.selectedPath, 'src/main.zig')
  assert.equal(selected.treeMode, TreeMode.FILES)
  assert.equal(selected.activeSurface, ActiveSurface.DIFF_PANE)
})

test('text wrapping starts enabled and toggles at runtime', () => {
  assert.equal(initialWorkspaceState.wrapLines, true)

  const toggled = workspaceReducer(initialWorkspaceState, {
    type: 'wrap_lines_toggled',
  })
  assert.equal(toggled.wrapLines, false)
  assert.equal(workspaceReducer(toggled, {
    type: 'wrap_lines_toggled',
  }).wrapLines, true)
})

test('configured wrapLines applies the startup default only for real booleans', () => {
  for (const wrapLines of [true, false]) {
    const configured = workspaceReducer(initialWorkspaceState, {
      type: 'wrap_lines_set',
      wrapLines,
    })
    assert.equal(configured.wrapLines, wrapLines)
  }

  for (const value of [undefined, null, 1, 'yes']) {
    assert.equal(workspaceReducer(initialWorkspaceState, {
      type: 'wrap_lines_set',
      wrapLines: value,
    }), initialWorkspaceState)
  }
})

test('relative line numbers start absolute, toggle, and accept boolean configuration', () => {
  assert.equal(initialWorkspaceState.relativeLineNumbers, false)
  const toggled = workspaceReducer(initialWorkspaceState, {
    type: 'relative_line_numbers_toggled',
  })
  assert.equal(toggled.relativeLineNumbers, true)

  const configured = workspaceReducer(toggled, {
    type: 'relative_line_numbers_set',
    relativeLineNumbers: false,
  })
  assert.equal(configured.relativeLineNumbers, false)
  for (const value of [undefined, null, 1, 'yes']) {
    assert.equal(workspaceReducer(configured, {
      type: 'relative_line_numbers_set',
      relativeLineNumbers: value,
    }), configured)
  }
})

test('keyboard reference visibility is idempotent and preserves workspace context', () => {
  const opened = workspaceReducer(initialWorkspaceState, {
    type: 'keymap_reference_opened',
  })
  assert.equal(opened.keymapReferenceOpen, true)
  assert.equal(opened.activeSurface, initialWorkspaceState.activeSurface)
  assert.equal(workspaceReducer(opened, {
    type: 'keymap_reference_opened',
  }), opened)

  const closed = workspaceReducer(opened, { type: 'keymap_reference_closed' })
  assert.equal(closed.keymapReferenceOpen, false)
  assert.equal(closed.activeSurface, initialWorkspaceState.activeSurface)
  assert.equal(workspaceReducer(closed, {
    type: 'keymap_reference_closed',
  }), closed)
})

const openHistoryFiles = (...paths) => paths.reduce((state, path) => workspaceReducer(state, {
  type: 'file_selected', path,
}), initialWorkspaceState)

test('opening and closing comments preserves the complete workspace context', () => {
  const state = {
    ...initialWorkspaceState,
    selectedPath: 'src/main.zig',
    lineNavigation: { path: 'src/main.zig', lineNumber: 12 },
    treeMode: TreeMode.FILES,
    activeSurface: ActiveSurface.FILE_TREE,
    fileHistory: ['README.md', 'src/main.zig'],
    fileHistoryIndex: 1,
  }
  const opened = workspaceReducer(state, { type: 'comments_opened' })
  assert.deepEqual(opened, { ...state, commentsOpen: true })
  assert.equal(workspaceReducer(opened, { type: 'comments_opened' }), opened)
  const closed = workspaceReducer(opened, { type: 'comments_closed' })
  assert.deepEqual(closed, state)
  assert.equal(workspaceReducer(closed, { type: 'comments_closed' }), closed)
})
const moveHistory = (state, direction, extra = {}) => workspaceReducer(state, {
  type: 'file_history_moved', direction, changedPaths: ['A', 'B', 'C', 'D'], ...extra,
})

test('history follows opens, traverses without appending, and stops at boundaries', () => {
  const opened = openHistoryFiles('A', 'B', 'C')
  assert.deepEqual(opened.fileHistory, ['A', 'B', 'C'])
  assert.equal(moveHistory(opened, 1), opened)
  const back = moveHistory(opened, -1)
  assert.equal(back.selectedPath, 'B')
  assert.deepEqual(back.fileHistory, opened.fileHistory)
  const first = moveHistory(back, -1)
  assert.equal(first.selectedPath, 'A')
  assert.equal(moveHistory(first, -1), first)
  assert.equal(moveHistory(moveHistory(first, 1), 1).selectedPath, 'C')
  assert.equal(moveHistory(opened, -1, { count: 20 }).selectedPath, 'A')
})

test('history branches only for a different file, including finder and search opens', () => {
  const back = moveHistory(openHistoryFiles('A', 'B', 'C'), -1)
  const duplicate = workspaceReducer(back, { type: 'finder_file_opened', path: 'B', changed: true })
  assert.deepEqual(duplicate.fileHistory, ['A', 'B', 'C'])
  const branch = workspaceReducer(duplicate, {
    type: 'search_result_opened', path: 'D', changed: false, lineNumber: 12,
  })
  assert.deepEqual(branch.fileHistory, ['A', 'B', 'D'])
  assert.equal(moveHistory(branch, 1), branch)
  assert.equal(moveHistory(branch, -1).lineNavigation, null)
})

test('history skips missing and failed files and can leave an unavailable current file', () => {
  const opened = openHistoryFiles('A', 'B', 'C', 'D')
  const missing = workspaceReducer(opened, { type: 'file_unavailable', path: 'C' })
  const back = moveHistory(missing, -1)
  assert.equal(back.selectedPath, 'B')
  assert.equal(moveHistory(back, 1).selectedPath, 'D')
  assert.equal(moveHistory(opened, -1, { availablePaths: ['A', 'D'] }).selectedPath, 'A')
  const failedCurrent = workspaceReducer(opened, { type: 'file_unavailable', path: 'D' })
  assert.equal(moveHistory(failedCurrent, -1).selectedPath, 'C')
  assert.deepEqual(workspaceReducer(missing, { type: 'file_availability_reset' }).unavailablePaths, [])
})

test('history restores unchanged files in Files mode and resets for a new session', () => {
  const opened = openHistoryFiles('unchanged', 'A')
  assert.equal(moveHistory(opened, -1).treeMode, TreeMode.FILES)
  const reset = workspaceReducer(opened, { type: 'review_loaded', initialPath: 'new' })
  assert.deepEqual(reset.fileHistory, ['new'])
  assert.equal(reset.fileHistoryIndex, 0)
  assert.equal(moveHistory(reset, -1), reset)
  const empty = workspaceReducer(reset, { type: 'review_loaded', initialPath: null })
  assert.deepEqual(empty.fileHistory, [])
  assert.equal(empty.fileHistoryIndex, -1)
})
