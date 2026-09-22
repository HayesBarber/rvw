# Workspace state evaluation (#152)

Decision: **defer adoption**. Keep the reducer and request hooks for v1. The
isolated prototype shows that Zustand can provide narrow subscriptions without
changing workspace transitions, but does not yet demonstrate enough simplification
or rendering benefit to justify production integration. This evaluation blocks no
v1 feature.

## Current ownership and update flows

| Owner | State and flow |
| --- | --- |
| `app/workspace.js`, instantiated by `App.jsx` | Requested path, tree mode/width, finder mode/open state, keymap overlay, active surface, wrapping and relative numbers. UI and action handlers dispatch reducer events. |
| `app/use-configuration.js` | Validated configuration snapshot, diagnostics, keymap and comment settings. Installs Vim bindings; App effects initialize the two mutable workspace display settings when their configuration values change. |
| `review/review-session.js` | Reload generation and one-time initialization refs; derives visible files, changed paths, active path and navigation order. Coordinates lazy file lists, comments and reloads. |
| Request hooks | Overview, repository lists, selected-file payload, comments, operation status/errors and timers. HTTP/native APIs remain behind `review/api.js`. |
| App and pane-local state | Draft-presence signal, command-line state/controller, DOM refs, pane cursor/selection and draft contents. Application actions own focus effects and the action-adapter registry. Vim and Pierre models have their own lifecycles. |

`workspace.selectedPath` is **intent**, not a second authoritative current-file
payload. `selectActivePath` chooses that path if visible, then the overview's
initial path if visible, then the first visible entry, otherwise null. Files mode
keeps an explicitly selected file visible while the repository list is idle,
loading or failed. Only after a successful list (or an available changes overview)
does the session reconcile the requested path to the derived path. Empty reviews
switch to Files. `review_loaded` initializes selection once per mounted session.

There is real duplication of the initial wrap/relative-number values in the
configuration snapshot and workspace, but they serve different purposes: saved
configuration versus mutable session preferences. Reapplying configuration on every
store update would overwrite user toggles. `finderOpen` and nullable `finderMode`
also encode overlapping information; reducer transitions currently keep them
consistent. Do not change either behavior incidentally in a state-library spike.

App threads a large session interface into panes, overlays, footer and application
actions. Request completions and workspace changes rerender App; unstable callback
props can propagate that work. A resize or overlay action can revisit components
whose displayed file did not change. This is a potential optimization target,
not evidence of costly renderer work: memoization, React batching and Pierre's
internal updates affect actual cost. A large hook return value alone is not
proof of duplicated authoritative state.

Stale-update safeguards are already explicit: overview/list request counters,
selected-file effect cleanup and a key containing generation/path/diff identity,
and comment mutation revisions protecting the initial fetch. Reload preserves the
draft guard and reloads overview/lists after advancing generation. Moving state
into Zustand would not replace these rules. Follow-up audit candidates include
late async mutation/reload completions after unmount and early navigation racing
the first overview's initialization; this spike does not claim to reproduce or
fix either. Singleton stores would make cross-session leakage more dangerous.

## Options

| Criterion | Keep current design | A: workspace-only store | B: full session/request store |
| --- | --- | --- | --- |
| Complexity | Existing pure reducer and hook ownership; broad App composition remains | Reuse reducer, add session provider and selective pane subscriptions; request-derived selectors still need hook inputs | Rebuild orchestration, cancellation/revisions, timers, reload ordering and lifecycle ownership |
| Testing | Existing Node reducer/selector/request-helper tests | Same tests plus subscription, session isolation and provider lifecycle tests | Async ordering and teardown tests across every request and transport consumer |
| Rendering | Root changes may reach both panes; profile and split components first | Narrow primitive subscriptions filter unrelated workspace changes; parent/request renders remain | Can isolate more updates, but selector allocation and ordering introduce new costs |
| Risk/scope estimate | 1–2 days to profile/extract one pane boundary | 3–5 engineering days plus browser/native QA for staged integration | 2–3 weeks plus broad regression QA; speculative estimate, no demonstrated need |

## Retained bounded prototype

`frontend/prototypes/workspace-store/` uses pinned Zustand 5.0.8 as a **dev-only**
dependency. No production module imports it and the normal Vite build does not
include the demo. `createWorkspaceSession()` creates a fresh vanilla store and
stable dispatch per session, retaining the existing reducer. `Pane.jsx` uses
`useStore` for primitive tree-mode and active-path subscriptions. It represents
the pane boundary without migrating the real renderer or action registry.

Request data stays outside the store. `activePathSelector` closes over a request
snapshot; React recomputes it when those props change. An imperative subscription
must be rebound when its request snapshot changes. Copying request data into a
workspace store merely to avoid this boundary would introduce a second owner.
The prototype deliberately recomputes file entries in the selector; large-list
allocation/sorting would need memoization before adoption.

There are no global subscriptions, requests or timers to dispose. Imperative
subscriptions return cleanup functions, React owns its subscription cleanup, and
session stores become collectible after unmount. Tests exercise unsubscribe,
resubscribe (the StrictMode lifecycle pattern), and independence of two instances;
they do not claim to mount the full application under StrictMode.

Run from the repository root:

```sh
npm test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5178
```

Open `/prototypes/workspace-store/index.html` on that local Vite server. The demo
uses synthetic request snapshots, not backend requests. The full session's
list-ready reconciliation effect remains outside this small pane harness and is
modeled explicitly in the Node test.

Evidence collected:

- All 213 frontend tests passed, including three prototype tests. Lint and the
  production frontend build passed (the existing large-chunk advisory remains).
- Configuration defaults/valid overrides/invalid input, user toggles, finder and
  keymap transitions, logical active surface, pending/error/success list states,
  fallback, empty reviews, tree navigation and stale file-key masking are covered
  by the new tests together with the existing suite.
- Eight sequential dispatches (select, resize, finder open, surface change,
  configuration setting, finder close, finder file open, repeated selection)
  generated **7 root, 2 active-path and 1 tree-mode notifications**. The final
  selection was a no-op. This is an update trace, not measured React commits,
  renderer time, or proof of performance improvement over the reducer.
- In-app browser verified a.js → b.js selection, pending.js in Files while the
  synthetic request is loading, fallback to a.js when the successful list omits
  it, and return to Changes. This also exercises prop-driven selector refresh.
- Actual focus movement, native WebKit, live request races and large repositories
  were not tested by this demo. Logical focus state is tested; DOM focus effects
  stay in application actions. No backend/native code changed.

## Next steps and ownership if revisited

First profile the current App/tree/diff boundaries during resize, finder toggling,
file navigation and reload using a representative large repository. Record React
commits and durations; compare a pane extraction/memoization baseline before
attributing gains to Zustand. Keep the prototype as a reproducible evaluation,
not a production dependency commitment.

Only reopen A if profiling or repeated cross-pane prop changes show a concrete
benefit. Proposed sequence: (1) establish a per-session provider and teardown tests;
(2) move only reducer-owned workspace UI state, with configuration initialization
at the session boundary; (3) migrate one pane's primitive selectors and verify
navigation/fallback with live requests; (4) compare profiles and migrate remaining
workspace consumers only if justified. Preserve request hooks as owners of server
data/status, generation and stale-result protection. Keep derived active paths out
of writable state. Keep DOM focus, Vim, action adapters and Pierre models outside
the store. Native follow-up should exercise finder focus restoration, split-pane
focus, configured display preferences and reload with an unsaved draft.

Do not start B without a separate requirement and decision record. The current
recommendation creates no production migration work; the estimates above describe
possible follow-up scope rather than a commitment.
