# Keyboard controls

Rvw uses a Vim-style keymap for navigation and actions.

## Built-in bindings

| Action identifier | Default keys | Behavior |
| --- | --- | --- |
| `application.close` | `q` | Close Rvw. |
| `review.reload` | `<leader> r` | Reload repository files and changes while preserving saved comments and session display settings. Reload is blocked while a comment draft or editor is open. |
| `command_line.open` | `:` | Open the footer command input. |
| `keymap_reference.open` | `?` | Open a reference showing the bindings currently in effect. |
| `cursor.up` | `k`, `<Up>` | Move the active file-tree, diff, or file-finder cursor up. |
| `cursor.down` | `j`, `<Down>` | Move the active file-tree, diff, or file-finder cursor down. |
| `cursor.page.up` | `<C-u>` | Move the active cursor up by half of its visible viewport. |
| `cursor.page.down` | `<C-d>` | Move the active cursor down by half of its visible viewport. |
| `cursor.first` | `g g` | Move the active cursor to the first item. |
| `cursor.last` | `G` | Move the active cursor to the last item. |
| `diff.visual_line` | `V` | Enter linewise Visual selection at the active code row. |
| `diff.side.switch` | `<leader> s` | Switch diff side on the same visual row. If the opposite side is empty, keep the cursor in place. |
| `cursor.center` | `z z` | Center the active cursor in its viewport without moving it. |
| `file_tree.item.activate` | `<Enter>` | Open the focused file, toggle the focused directory, or open the highlighted finder result. |
| `tree.collapse_or_parent` | `h`, `<Left>` | Collapse a directory or focus its parent. |
| `tree.expand` | `l`, `<Right>` | Expand the focused directory. |
| `tree.size.increase` | `>` | Widen the file-tree pane by one step. |
| `tree.size.decrease` | `<` | Narrow the file-tree pane by one step. |
| `focus.file_tree` | `<leader> o` | Focus the file tree. |
| `focus.diff_pane` | `<leader> o` | Focus the diff pane. |
| `tree_mode.changes` | `c` | Show changed files. |
| `tree_mode.files` | `f` | Show all repository files. |
| `file.open.next` | `] b` | Open the next file in the current tree mode. |
| `file.open.previous` | `[ b` | Open the previous file in the current tree mode. |
| `file_finder.open` | `<C-p>`, `<D-p>`, `<leader> f` | Open the file finder. It respects `.gitignore`: tracked files plus untracked files git does not ignore. |
| `file_finder.open.all` | `<leader> F` | Open the file finder listing every file, including git-ignored ones. |
| `codebase_search.open` | `<leader> /` | Codebase text search across the opened directory, including unchanged files, with ignore rules applied. |
| `codebase_search.open.all` | `<leader> ?` | Codebase text search across the opened directory, including unchanged and ignored files. |
| `diff.expand.toggle` | `<leader> e` | Expand all unchanged regions in the active diff; repeat to restore collapsed context. |
| `diff.relative_line_numbers.toggle` | `<leader> n` | Toggle relative line numbers in the active diff or full-file text view. |
| `diff.wrap.toggle` | `<leader> w` | Toggle text wrapping in the active diff or full-file text view. |
| `file.path.copy_relative` | `<leader> y` | Copy the active file's canonical repository-relative path. In the file tree this uses the highlighted file; in the diff pane it uses the open file. |
| `file.path.copy_absolute` | `<leader> Y` | Copy the active file's absolute filesystem path. In the file tree this uses the highlighted file; in the diff pane it uses the open file. |
| `comments.copy` | `y` | Copy all review comments as Markdown. |
| `comments.add` | `c` | Add a line comment at the active diff cursor. |
| `comments.add_file` | `C` | Add a file-level comment to the open text file. |
| `comments.edit` | `e` | Edit the comment at the cursor. |
| `comments.delete` | `d d` | Delete the saved comment at the cursor. |
| `comments.clear` | `d a` | Clear all review comments in the current session. |

A decimal count before a supported command repeats or scales that command. For example, `20 j` moves the active cursor down 20 items. The footer shows the current mode, count, and any pending multi-key sequence.

Press `?` to show the current bindings. Press `<Esc>` to close the reference.

Press `V` in the diff pane to select lines, then press `c` to add a range comment.
Visual-mode bindings are fixed. You can change the entry key with `diff.visual_line`.

## User configuration

Rvw reads `~/.config/rvw/config.json` once when the application starts.

The JSON root accepts optional `keybindings`, `diff`, `comments`, and `commandLine` objects.

Use `keybindings.normal` to change bindings. Each key must be an action identifier
from the table above. Each value must be an array of key sequences.
A sequence is a non-empty array of key strings. Set `keybindings.leader` to change
the `<leader>` key. The default is `<Space>`.

Use `diff.wrapLines` and `diff.relativeLineNumbers` to set the initial display.
Both values must be booleans. Text wraps by default, and line numbers are absolute.
Set `"wrapLines": false` to scroll long lines horizontally.
Set `"relativeLineNumbers": true` to show each code row's distance from the cursor.
The cursor row shows its source line number.
The toggle actions change these settings for the current session, including files opened later.
The `diff.expand.toggle` action changes only the open diff. Each new file starts with collapsed context.

Use `comments.types` to set an ordered list of comment types.
The default types are `ISSUE`, `QUESTION`, and `NITPICK`. An empty list disables comment types.
Names must be unique, non-blank strings with no line breaks.
Set `comments.defaultType` to `null` (the default) or a name from the list.
In the comment editor, use `Tab`, `Shift+Tab`, or the dropdown to change the type.

Press `:` in Normal mode to enter an action name or alias, then press `<Enter>` to run it.
Names are case-sensitive. Press `<Esc>` to cancel.
Use `commandLine.aliases` to map aliases to action identifiers from the table above.
Alias names must be non-empty, contain no whitespace, and differ from all action identifiers.
Configure the opening key with `command_line.open`.

This example changes bindings for four actions and disables the `comments.copy` binding.
It also sets the leader key, display options, comment types, and command aliases:

```json
{
  "keybindings": {
    "leader": "\\",
    "normal": {
      "cursor.up": [["w"], ["<Up>"]],
      "cursor.down": [["s"], ["<Down>"]],
      "focus.file_tree": [["<leader>", "t"]],
      "comments.edit": [["<leader>", "c"]],
      "comments.copy": []
    }
  },
  "diff": {
    "relativeLineNumbers": true,
    "wrapLines": false
  },
  "comments": {
    "types": ["ISSUE", "QUESTION", "NITPICK"],
    "defaultType": null
  },
  "commandLine": {
    "aliases": {
      "clear": "comments.clear",
      "reload": "review.reload"
    }
  }
}
```

A configured action replaces all its default bindings. An empty array disables its
keyboard binding, but its action name remains available in the command line.
Actions absent from the file keep their default bindings.

A binding cannot also be a prefix of another binding. For example, do not bind
both `g` and `g g`.

## Key notation

- Printable keys use the character produced by the keyboard, such as `j`, `G`, `/`, or `0`. Letter case is significant.
- Named keys use angle brackets: `<BS>`, `<Del>`, `<Down>`, `<End>`, `<Enter>`, `<Esc>`, `<Home>`, `<Left>`, `<PageDown>`, `<PageUp>`, `<Right>`, `<Space>`, `<Tab>`, and `<Up>`.
- Modified keys use `C` for Control, `M` for Option/Alt, `D` for Command/Meta, and `S` for Shift. Combine modifiers in that order, followed by a lowercase printable key or a named key: `<C-p>`, `<D-p>`, `<C-S-k>`, or `<M-Left>`.
- Multi-key sequences contain one JSON string per key and preserve order: `["g", "d"]`.
- Use `<Space>`, not a literal space. `<leader>` is a placeholder in `keybindings.normal` sequences that expands to the `keybindings.leader` key, or `<Space>` when `leader` is omitted.

## Codebase text search

The text-search API requires a local [ripgrep](https://github.com/BurntSushi/ripgrep)
installation. Rvw does not bundle ripgrep. On macOS, install it with:

```bash
brew install ripgrep
```

Rvw finds `rg` on its process `PATH`. To select an executable explicitly, set
`RVW_RIPGREP` to its absolute path before you start Rvw. This also works when the
GUI does not inherit your shell's `PATH`:

```bash
RVW_RIPGREP=/opt/homebrew/bin/rg rvw .
```

The selected file must be executable. Search reports an error if Rvw cannot find or run it.
Other review operations do not require ripgrep.

