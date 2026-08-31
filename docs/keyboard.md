# Keyboard controls

rvw uses a Vim-style Normal-mode keymap for navigation and global review actions. Text inputs, comment editors, dialogs, and elements marked to ignore Vim input retain their native keyboard behavior.

## Built-in bindings

| Action identifier | Default keys | Behavior |
| --- | --- | --- |
| `application.close` | `q` | Close rvw through the native application host. In HTTP development mode, this action is a safe no-op. |
| `keymap_reference.open` | `?` | Open a reference showing the bindings currently in effect. |
| `cursor.up` | `k`, `<Up>` | Move the active file-tree, diff, or file-finder cursor up. |
| `cursor.down` | `j`, `<Down>` | Move the active file-tree, diff, or file-finder cursor down. |
| `cursor.page.up` | `<C-u>` | Move the active cursor up by half of its visible viewport. Supports counts. |
| `cursor.page.down` | `<C-d>` | Move the active cursor down by half of its visible viewport. Supports counts. |
| `cursor.first` | `g g` | Move the active cursor to the first item. |
| `cursor.last` | `G` | Move the active cursor to the last item. |
| `cursor.center` | `z z` | Center the active cursor in its viewport without moving it. |
| `file_tree.item.activate` | `<Enter>` | Open the focused file, toggle the focused directory, or open the highlighted finder result. |
| `tree.collapse_or_parent` | `h`, `<Left>` | Collapse a directory or focus its parent. |
| `tree.expand` | `l`, `<Right>` | Expand the focused directory. |
| `tree.size.increase` | `>` | Widen the file-tree pane by one step. Supports counts. |
| `tree.size.decrease` | `<` | Narrow the file-tree pane by one step. Supports counts. |
| `focus.file_tree` | `<leader> o` | Focus the file tree. |
| `focus.diff_pane` | `<leader> o` | Focus the diff pane. |
| `tree_mode.changes` | `c` | Show changed files. |
| `tree_mode.files` | `f` | Show all repository files. |
| `file.open.next` | `] b` | Open the next file in the current tree mode. Supports counts and stops at the last file. |
| `file.open.previous` | `[ b` | Open the previous file in the current tree mode. Supports counts and stops at the first file. |
| `file_finder.open` | `<C-p>`, `<D-p>`, `<leader> f` | Open the file finder. |
| `comments.copy` | `y` | Copy all review comments as Markdown. |
| `comments.add` | `c` | Add a line comment at the active diff cursor. |
| `comments.add_file` | `C` | Add a file-level comment to the open text file. |
| `comments.edit` | `e` | Edit the saved comment at the active diff context. |
| `comments.delete` | `d d` | Delete the saved comment at the active diff context. |

A decimal count before a supported command repeats or scales that command. For example, `20 j` moves the active cursor down 20 items. The footer shows the current mode, count, and any pending multi-key sequence.

The file finder opens with its search input focused. Press `<Esc>` once to move
focus to the result list and enable its Vim bindings without changing the
query, then press `<Esc>` again to close the finder. Outside that transition,
`<Esc>` clears a pending count or multi-key sequence. An unmatched key after a
pending sequence also clears that pending input without running an action.

Press `?` to open the keyboard reference. It is grouped by purpose and reads
from the effective keymap, so valid user replacements and disabled actions are
shown exactly as installed. While the reference is open, workspace commands
are blocked. Press `<Esc>` to close it and restore focus to the prior workspace
context.

## User configuration

rvw reads `~/.config/rvw/config.json` once when the application starts. Create the parent directories if they do not exist, and restart rvw after every configuration change.

The JSON root accepts one optional `keybindings` object. `keybindings` accepts one optional `normal` object. Each key in `normal` must be an action identifier from the table above, and its value must be an array of key sequences. A key sequence is a non-empty array of normalized key strings.

This complete example replaces four actions, disables one action, and leaves every omitted action at its built-in binding:

```json
{
  "keybindings": {
    "normal": {
      "cursor.up": [["w"], ["<Up>"]],
      "cursor.down": [["s"], ["<Down>"]],
      "focus.file_tree": [["<leader>", "t"]],
      "comments.edit": [["c", "e"]],
      "comments.copy": []
    }
  }
}
```

An action present in the file replaces all of that action's defaults; bindings are not appended. An empty array disables the action. An action absent from the file retains all of its defaults. `<leader>` expands to `<Space>`.

## Migration from the provisional V1 keymap

The approved V1 defaults replace every provisional binding listed below:

| Action identifier | Provisional keys | Approved keys |
| --- | --- | --- |
| `tree.size.increase` | `<C-w> >` | `>` |
| `tree.size.decrease` | `<C-w> <` | `<` |
| `focus.file_tree` | `g t` | `<leader> o` when the diff pane is active |
| `focus.diff_pane` | `g d` | `<leader> o` when the file tree is active |
| `tree_mode.changes` | `g c` | `c` in the file tree |
| `tree_mode.files` | `g f` | `f` in the file tree |
| `file_finder.open` | `<C-p>`, `<D-p>` | `<C-p>`, `<D-p>`, or `<leader> f` |
| `comments.delete` | `d c` | `d d` |

The new `keymap_reference.open` action defaults to `?`. User overrides continue to replace defaults action by action, so existing configuration remains authoritative until migrated.

## Key notation

- Printable keys use the character produced by the keyboard, such as `j`, `G`, `/`, or `0`. Letter case is significant.
- Named keys use angle brackets: `<BS>`, `<Del>`, `<Down>`, `<End>`, `<Enter>`, `<Esc>`, `<Home>`, `<Left>`, `<PageDown>`, `<PageUp>`, `<Right>`, `<Space>`, `<Tab>`, and `<Up>`.
- Modified keys use `C` for Control, `M` for Option/Alt, `D` for Command/Meta, and `S` for Shift. Combine modifiers in that order, followed by a lowercase printable key or a named key: `<C-p>`, `<D-p>`, `<C-S-k>`, or `<M-Left>`.
- Multi-key sequences contain one JSON string per key and preserve order: `["g", "d"]`.
- Use `<Space>`, not a literal space. `<leader>` is also accepted as a configurable placeholder for `<Space>`.

## Validation and diagnostics

rvw validates the JSON schema, action identifiers, normalized key notation, duplicate bindings, and ambiguous prefixes before installing the complete keymap. A binding cannot also be a prefix of another binding; for example, binding both `g` and `g g` is ambiguous.

Malformed JSON, invalid fields or actions, unsupported key notation, duplicate bindings, ambiguous prefixes, and file read failures leave the built-in or last valid keymap active. The application footer reports the problem and configuration path while review loading continues. Fix the reported file and restart rvw to try the configuration again.

Both the native macOS application and the HTTP development server load the same startup snapshot and apply the same frontend validation.
