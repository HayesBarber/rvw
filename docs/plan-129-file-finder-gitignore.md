# Plan: gitignore-aware file finder (issue #129)

Status: Ready for implementation

## Behavior

- `file_finder.open` (existing `OPEN_FILE_FINDER`) becomes the new default and
  **respects `.gitignore`**: it lists tracked files that exist on disk plus
  untracked files that git does not ignore (i.e. everything git considers part
  of the working set).
- `file_finder.open.all` (new `OPEN_FILE_FINDER_ALL`) lists **all files**
  (today's behavior), bound to `<leader>F`.
- The header "Find file" button and `<C-p>` keep the gitignore-aware mode.
- Scope is limited to the file finder. The file-tree "Show files" mode
  (`TreeMode.FILES`) is unchanged.

## Provider refactor: split `FileProvider` into content + tree providers

Today `FileProvider` (`src/provider/file/interface.zig`) exposes both content
(`getFile`) and path listing (`getFiles`). We decompose it into two interfaces
so `FileTreeProvider` can have two implementations (respecting / not respecting
`.gitignore`), and the content provider stops owning path enumeration.

### New layout

Two provider families under `src/provider/` — content access stays in `file/`,
path enumeration moves to a new `filetree/`:

```
src/provider/file/           content access
  interface.zig              FileProvider               getFile(path) -> FileContent (loadFile alias)
  filesystem.zig             FilesystemFileProvider     filesystem file reads (getFile moved here)

src/provider/filetree/       path enumeration
  interface.zig              FileTreeProvider           getFiles() -> []const []const u8 (listFiles alias)
  walk.zig                   WalkFileTreeProvider       all files (walker moved here)
  gitignore.zig              GitignoreFileTreeProvider  respects .gitignore
```

New module `src/provider/filetree.zig` exports the interface and both
implementations; `src/provider/provider.zig` gains `pub const filetree`. The
existing `src/provider/file.zig` keeps exporting `FileProvider`.

- **`FileProvider`** vtable shrinks to `getFile` only. `FilesystemFileProvider`
  owns the root dir, the read mutex, size/UTF-8/binary classification, and
  `validRequestPath`.
- **`WalkFileTreeProvider`**: the current `enumerateFiles` logic (skip `.git`,
  include only `.file`/`.sym_link`, UTF-8 validate, `/`-normalize, sort) moves
  verbatim into a self-contained provider (own arena + dir handle).
- **`GitignoreFileTreeProvider`**: at init runs
  `git -C <path> ls-files --cached --others --exclude-standard -z --` (via the
  shared git process module below, capped by `maximum_metadata_size`), then
  stat-filters each NUL-delimited entry through its own dir handle, keeping only
  existing `.file`/`.sym_link` entries (this also prunes deleted-but-tracked
  index entries). Paths are normalized, sorted, and duplicated into its arena.
  On git failure it falls back to a self-contained walk (reusing the shared
  enumerate helper) so the finder never breaks. This list is display-only;
  content reads never validate against it.
- **`FilesystemFileProvider`** takes an injected `FileTreeProvider` (the
  all-files one) at init and snapshots its path list for `getFile` validation
  (`findPath`) — one walk, one shared security invariant, no duplicate
  enumeration.

### Wiring (`src/bindings/cabi.zig`, `src/dev_server.zig`)

```
var all_tree     = WalkFileTreeProvider.init(allocator, io, path)
var visible_tree = GitignoreFileTreeProvider.init(allocator, io, path)
var content      = FilesystemFileProvider.init(allocator, io, path, all_tree.interface())
Core.init(..., content.interface(), all_tree.interface(), visible_tree.interface(), ...)
```

## Backend plumbing

- `src/app/model.zig` — `Request` gains a new bare variant
  `get_files_not_ignored`, and `operationName` handles it. `Response` reuses the
  existing `files` shape.
- `src/provider/git/process.zig` (new shared module) — move `process.run`, its
  error mapping (`GitNotFound` / `GitOutputTooLarge` / `GitCommandFailed`), and
  the output-size limits out of `src/provider/diff/git/`. The diff provider's
  `process.zig` becomes a re-export so existing diff code is untouched; the
  `GitignoreFileTreeProvider` imports the shared module directly.
- `src/app/json_protocol.zig` — `decodeRequestValue` accepts `"get_files_not_ignored"`.
- `src/app/core.zig` — Core holds three providers:
  - `file_provider` (content),
  - `all_files_tree_provider`,
  - `visible_files_tree_provider`.
  Dispatch: `get_files` -> all-tree, `get_files_not_ignored` -> visible-tree,
  `get_file` -> content provider. The Core test stub vtable is split into a
  `FileProvider` vtable (`getFile`) and a `FileTreeProvider` vtable (`getFiles`).
- `src/transport/http.zig` — new route `GET /api/files/not-ignored` dispatching
  `.get_files_not_ignored`.
- macOS Swift — no changes. `NativeRequestRouter` forwards every message except
  `application_close` to the core; `decodeRequestValue` accepts the new type.

## Frontend

- `src/actions/application-actions.js`
  - Add `OPEN_FILE_FINDER_ALL: 'file_finder.open.all'` (GLOBAL / APPLICATION
    scope, description).
  - `defaultNormalKeymap[OPEN_FILE_FINDER_ALL] = [['<leader>', 'F']]`.
- `src/review/api.js` — `getFilesNotIgnored()` fetches `/api/files/not-ignored`
  with native message `{ type: 'get_files_not_ignored' }`.
- `src/review/repository-files-request.js` — refactor into a factory
  `createRepositoryFilesHook(fetchPaths)`; export existing `useRepositoryFiles`
  and new `useNotIgnoredFiles`.
- `src/app/workspace.js` — add `finderMode` (`null` initially). `finder_opened`
  carries a `mode` (`'visible'` | `'all'`), defaulting to `'visible'` so existing
  call sites/tests keep working; `finder_closed` / `finder_file_opened` reset it.
- `src/review/review-session.js` — add `useNotIgnoredFiles()`.
  - `openFileFinder()` dispatches mode `'visible'` and lazily loads the
    not-ignored request.
  - `openFileFinderAll()` dispatches mode `'all'` and lazily loads
    `allFilesRequest`.
  - Expose not-ignored merged entries via
    `createFilesModeEntries(overview, notIgnoredPaths)` so changed files remain
    findable in both modes.
- `src/app/use-application-actions.js` — wire `OPEN_FILE_FINDER_ALL` to
  `openFileFinderAll()`.
- `src/app/App.jsx` — pass the finder `files` / `status` / `error` / `onRetry`
  based on `workspace.finderMode`: `'visible'` -> not-ignored request + entries;
  `'all'` -> existing `filesModeEntries` + `allFilesRequest`.
- `src/components/FileFinder.jsx` — show a distinct title for `open.all`
  (e.g. "Find any file including ignored") so the mode is visibly different from
  the default gitignore-aware finder.

## Tests

Zig:
- Split and extend the two `filesystem.zig` tests:
  - walk-tree: symlink / `.git` skip, contents ordered;
  - content: classified reads (binary, invalid UTF-8, too large, symlink) and
    unsafe path rejection;
  - gitignore-tree: ignored untracked files excluded, tracked files listed even
    when gitignored, deleted-tracked entries pruned, and walk fallback on a
    non-git `TmpDir`.
- `core.zig`: route both `get_files` variants through the two tree stubs.

Frontend:
- `application-actions.test.js`: assert the new `<leader>F` binding.
- `workspace.test.js`: `finder_opened` mode handling; bare `{ type: 'finder_opened' }`
  keeps working via the default.
- `api.test.js` and `repository-files-request.test.js`: cover
  `getFilesNotIgnored` / the factory hook.
- `application-dispatch.test.js`: `OPEN_FILE_FINDER_ALL` routes to the global
  action.

## Verification

- `zig build test` — runs backend Zig tests and the frontend `npm test` suite
  (the build's `test` step already depends on both).
- frontend lint (eslint)
