# Keyboard controls

Rvw uses a Vim-style keymap for navigation and actions.

## Built-in bindings

| Action identifier | Default keys | Behavior |
| --- | --- | --- |
| `application.close` | `q` | Close Rvw through the native application host. In HTTP development mode, this action is a no-op. |
| `keymap_reference.open` | `?` | Open a reference showing the bindings currently in effect. |
| `cursor.up` | `k`, `<Up>` | Move the active file-tree, diff, or file-finder cursor up. |
| `cursor.down` | `j`, `<Down>` | Move the active file-tree, diff, or file-finder cursor down. |
| `cursor.page.up` | `<C-u>` | Move the active cursor up by half of its visible viewport. |
| `cursor.page.down` | `<C-d>` | Move the active cursor down by half of its visible viewport. |
| `cursor.first` | `g g` | Move the active cursor to the first item. |
| `cursor.last` | `G` | Move the active cursor to the last item. |
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
| `diff.wrap.toggle` | `<leader> w` | Toggle text wrapping in the diff view. |
| `comments.copy` | `y` | Copy all review comments as Markdown. |
| `comments.add` | `c` | Add a line comment at the active diff cursor. |
| `comments.add_file` | `C` | Add a file-level comment to the open text file. |
| `comments.edit` | `e` | Edit the comment at the cursor. |
| `comments.delete` | `d d` | Delete the saved comment at the cursor. |

A decimal count before a supported command repeats or scales that command. For example, `20 j` moves the active cursor down 20 items. The footer shows the current mode, count, and any pending multi-key sequence.

The file finder opens with its search input focused. Press `<Esc>` once to move
focus to the result list and enable its Vim bindings without changing the
query, then press `<Esc>` again to close the finder. Outside that transition,
`<Esc>` clears a pending count or multi-key sequence. An unmatched key after a
pending sequence also clears that pending input without running an action.

Press `?` to open the keyboard reference. It is grouped by purpose and reads
from the effective keymap, so valid user replacements and disabled actions are
shown exactly as installed. While the reference is open, workspace commands
are blocked. Use `j` and `k` to scroll the reference. Press `<Esc>` to close it
and restore focus to the prior workspace context.

## User configuration

Rvw reads `~/.config/rvw/config.json` once when the application starts.

The JSON root accepts one optional `keybindings` object and one optional `diff` object. `keybindings` accepts an optional `normal` object and an optional `leader` key. Each key in `normal` must be an action identifier from the table above, and its value must be an array of key sequences. A key sequence is a non-empty array of normalized key strings. The `leader` key selects the concrete key that replaces `<leader>` in `normal` sequences and defaults to `<Space>` when omitted.

`diff` accepts one optional `wrapLines` key, a boolean that selects the starting text wrapping of the diff view. Text wraps by default; set `"wrapLines": false` to start with long lines scrolling horizontally instead. The `diff.wrap.toggle` action flips wrapping for the current session only.

This complete example replaces four actions, disables one action, starts with wrapping disabled, selects `\` as the leader key, and leaves every other action at its default binding:

```json
{
  "keybindings": {
    "leader": "\\",
    "normal": {
      "cursor.up": [["w"], ["<Up>"]],
      "cursor.down": [["s"], ["<Down>"]],
      "focus.file_tree": [["<leader>", "t"]],
      "comments.edit": [["c", "e"]],
      "comments.copy": []
    }
  },
  "diff": {
    "wrapLines": false
  }
}
```

An action present in the file replaces all of that action's defaults; bindings are not appended. An empty array disables the action. An action absent from the file retains all of its defaults. `<leader>` expands to the `keybindings.leader` value, or `<Space>` when `leader` is omitted.

## Key notation

- Printable keys use the character produced by the keyboard, such as `j`, `G`, `/`, or `0`. Letter case is significant.
- Named keys use angle brackets: `<BS>`, `<Del>`, `<Down>`, `<End>`, `<Enter>`, `<Esc>`, `<Home>`, `<Left>`, `<PageDown>`, `<PageUp>`, `<Right>`, `<Space>`, `<Tab>`, and `<Up>`.
- Modified keys use `C` for Control, `M` for Option/Alt, `D` for Command/Meta, and `S` for Shift. Combine modifiers in that order, followed by a lowercase printable key or a named key: `<C-p>`, `<D-p>`, `<C-S-k>`, or `<M-Left>`.
- Multi-key sequences contain one JSON string per key and preserve order: `["g", "d"]`.
- Use `<Space>`, not a literal space. `<leader>` is a placeholder in `keybindings.normal` sequences that expands to the `keybindings.leader` key, or `<Space>` when `leader` is omitted.

## Validation and diagnostics

Rvw validates the JSON schema, action identifiers, normalized key notation, duplicate bindings, and ambiguous prefixes before installing the complete keymap. A binding cannot also be a prefix of another binding; for example, binding both `g` and `g g` is ambiguous.

Malformed JSON, invalid fields or actions, unsupported key notation, duplicate bindings, ambiguous prefixes, and file read failures leave the built-in or last valid keymap active. The application footer reports the problem and configuration path while review loading continues. Fix the reported file and restart Rvw to try the configuration again.

Both the native macOS application and the HTTP development server load the same startup snapshot and apply the same frontend validation.
