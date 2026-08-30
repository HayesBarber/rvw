# Keyboard controls

rvw uses a Vim-style Normal-mode keymap for navigation and global review actions. Text inputs, comment editors, dialogs, and elements marked to ignore Vim input retain their native keyboard behavior.

## Built-in bindings

| Action identifier | Default keys | Behavior |
| --- | --- | --- |
| `cursor.up` | `k`, `<Up>` | Move the active file-tree or diff cursor up. |
| `cursor.down` | `j`, `<Down>` | Move the active file-tree or diff cursor down. |
| `cursor.first` | `g g` | Move the active cursor to the first item. |
| `cursor.last` | `G` | Move the active cursor to the last item. |
| `cursor.center` | `z z` | Center the active cursor in its viewport without moving it. |
| `file_tree.item.activate` | `<Enter>` | Open the focused file or toggle the focused directory. |
| `tree.collapse_or_parent` | `h`, `<Left>` | Collapse a directory or focus its parent. |
| `tree.expand` | `l`, `<Right>` | Expand the focused directory. |
| `tree.size.increase` | `<C-w> >` | Widen the file-tree pane by one step. Supports counts. |
| `tree.size.decrease` | `<C-w> <` | Narrow the file-tree pane by one step. Supports counts. |
| `focus.file_tree` | `g t` | Focus the file tree. |
| `focus.diff_pane` | `g d` | Focus the diff pane. |
| `tree_mode.changes` | `g c` | Show changed files. |
| `tree_mode.files` | `g f` | Show all repository files. |
| `file_finder.open` | `<C-p>`, `<D-p>` | Open the file finder. |
| `comments.copy` | `y` | Copy all review comments as Markdown. |
| `comments.add` | `c` | Add a line comment at the active diff cursor. |
| `comments.edit` | `e` | Edit the saved comment at the active diff context. |
| `comments.delete` | `d c` | Open deletion confirmation for the saved comment at the active diff context. |

A decimal count before a supported command repeats or scales that command. For example, `20 j` moves the active cursor down 20 items. The footer shows the current mode, count, and any pending multi-key sequence.

`<Esc>` clears a pending count or multi-key sequence. An unmatched key after a pending sequence also clears that pending input without running an action.

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
