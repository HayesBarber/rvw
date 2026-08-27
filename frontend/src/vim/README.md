# Vim input scaffold

The scaffold keeps browser input, Vim state, and application behavior separate:

```text
KeyboardEvent -> keyboard.js -> VimController -> semantic command -> app adapter
                                    |
                                    +-> observable Vim state
```

- `keyboard.js` is the only DOM boundary. It normalizes keys, protects editable
  controls, and consumes only events handled by the machine.
- `machine.js` owns modes, counts, pending key sequences, bindings, and command
  dispatch. Its transition function is pure.
- `react.jsx` and `context.js` expose an optional provider and hooks around the
  controller.
- `index.js` is the public module surface.

The provider is not mounted yet, and there is intentionally no product keymap.
When the first navigation behavior is ready, define bindings at module scope and
mount the provider around the app:

```jsx
const bindings = [
  { mode: VimMode.NORMAL, keys: ['j'], command: 'file.next' },
  { mode: VimMode.NORMAL, keys: ['g', 'g'], command: 'file.first' },
]

<VimProvider bindings={bindings} onCommand={dispatchAppCommand}>
  <App />
</VimProvider>
```

The app adapter should translate semantic commands into selection, scrolling,
comment editing, or other product actions. Those concerns should not enter the
state machine.
