import { useStore } from 'zustand'
import { activePathSelector, selectTreeMode } from './store.js'

// Representative pane boundary: narrow subscriptions, request data via props.
// The real FileTreePane and its renderer/action adapter are deliberately untouched.
export default function Pane({ store, overview, paths, status }) {
  const mode = useStore(store, selectTreeMode)
  const activePath = useStore(store, activePathSelector({ overview, paths, status }))
  return <section aria-label="Prototype pane"><p>Mode: {mode}</p><p>Active file: {activePath ?? 'none'}</p></section>
}
