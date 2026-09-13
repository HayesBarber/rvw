# Issue #148: Edit/Delete file-level comments via keybindings

## Goal

Make file-level comments (`target.kind === 'file'`) navigable via the diff cursor
so that `e` (edit) and `dd` (delete) work, fixing GitHub issue #148.

## Root cause

`e`/`dd` act on `getActiveComment()`, which is set by `commentAtCursor()` during
cursor activation. The cursor only ever lands on real line rows
(`lineNumber >= 1`), and `commentAtCursor` only matches `target.kind === 'line'`.
So a file comment is unreachable by keyboard. (Mouse works: clicking a
`SavedComment` calls `setActiveCommentId`.)

## Approach

Add a synthetic first cursor row for file-level comments, represented as
`{ lineNumber: 0, side: 'additions' }`.

### 1. `frontend/src/actions/diff-cursor-actions.js`

- `createDiffCursorRows(instance)` → take a second argument `{ includeFileComment }`.
  When true, prepend `{ index: -1, additions: 0, fileCommentRow: true }`
  (index `-1` sorts first; `cursorForRow`, `rowIndexForCursor`,
  `reconcileDiffCursor`, and `moveDiffCursor` then work with no changes).
  Mirror in `createFileRows` for the `'file'` view.
- `syncDiffCursorPresentation`: if `cursor.lineNumber === 0`, call
  `instance.setEditorActiveLine(null)`. Passing `0` throws inside
  `@pierre/diffs` (`getIndexesFromSelection` → `getLineIndex(0)` is undefined).
  Return `true` so it reads as handled.
- `moveDiffCursorByPage`: if the current row is the file-comment row
  (`!current && row.fileCommentRow`), synthesize `center: 0` (it sits at content
  top) so `C-d`/`C-u` still navigate; keep the existing `null` behavior for
  other unpositioned rows.
- `scrollDiffCursorIntoView`: for `lineNumber === 0`, find the `.diff-scroll`
  container (`node.closest`) and the `.saved-comment[data-comment-kind="file"]`
  element, then reuse `scrollCommentIntoView` (from
  `scroll-comment-into-view.js`) to reveal it.
- `centerDiffCursor`: for line 0, delegate to the scroll-into-view path above.
- Note: special-casing keys off `lineNumber === 0` explicitly — test mocks
  return positions for line 0, so position-based checks alone will not trigger.

### 2. `frontend/src/actions/comment-actions.js`

- `commentAtCursor`: when `cursor.lineNumber === 0`, return the first comment
  with `target.kind === 'file' && target.path === path`.
- `commentTargetAtCursor`: unchanged — line `<= 0` already returns `null`, so
  pressing `c` at the file row creates nothing (correct).

### 3. `frontend/src/components/diff-pane/useDiffCursor.js`

- `handlePostRender`: compute
  `includeFileComment = commentsRef.current.some(c => c.target.kind === 'file' && c.target.path === pathRef.current)`
  and pass to `createDiffCursorRows(instance, { includeFileComment })`.
- `activateCursor` / `activateRangeCommentContext` already call
  `commentAtCursor`, so they pick up the file comment automatically once the
  cursor can land on line 0.

### 4. Visual highlight for the active file comment

`setEditorActiveLine(0)` is impossible, so the file-comment card needs its own
active indicator. Use the React-driven approach (not imperative class toggling,
which React re-renders would wipe out).

- `useDiffCursor`:
  - Add `activeCommentId` React state alongside `activeCommentIdRef`; route every
    write through one helper that updates both, only calling `setState` when the
    value actually changes (avoids re-render churn between comment-less rows).
  - `activateCursor`, `activateRangeCommentContext`, and `setActiveCommentId`
    all go through the helper.
  - Return `activeCommentId` in the memoized object and its dep array.
- `DiffPane`: pass `activeCommentId` into `useDiffComments`.
- `useDiffComments.renderAnnotation`: pass `active={comment.id === activeCommentId}`
  to `SavedComment`; add to the callback's dependency array.
- `SavedComment`: accept an `active` prop; set `data-active=""` on the
  `<article>` when active.
- `index.css`: apply the highlight to any active comment card (line comments
  already get the diff-line highlight, so this is just additive), e.g.
  `.saved-comment[data-active] {
    outline: 2px solid #69b1ff; outline-offset: 1px; }`

### 5. Tests

- `frontend/src/actions/diff-cursor-actions.test.js`:
  - file row prepend (diff + file views);
  - navigation to/from the row (`moveDiffCursor`);
  - `moveDiffCursorByPage` from the file row (mock `getLinePosition(0)` as
    undefined to exercise the center-0 fallback);
  - `scrollDiffCursorIntoView` at line 0 with DOM mocks;
  - `syncDiffCursorPresentation` at line 0 → `setEditorActiveLine(null)`;
  - `reconcileDiffCursor` preserving the file cursor.
- `frontend/src/actions/comment-actions.test.js`:
  - `commentAtCursor` returns the file comment at line 0;
  - `commentTargetAtCursor` at line 0 → `null`.
- Visual highlight:
  - `useDiffCursor` exposes reactive `activeCommentId` that updates on cursor
    activation and is stable across comment-less rows;
  - `SavedComment` sets `data-active` for the active comment.

## Behavior

- With a file comment present, `gg` lands on it; `k`/`j` move between it and
  line 1; the card is visibly highlighted; `e` opens the editor and `dd` deletes
  — no keymap changes needed.
- No file-level comment → rows unchanged, zero behavior shift.

## Known limitations (accepted for MVP)

- **Multiple file comments**: `commentAtCursor` matches only the first; the
  cursor lands on a single row. Fine for now — file comments are not
  distinguished from one another in the UI today anyway.