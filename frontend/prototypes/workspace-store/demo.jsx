import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Pane from './Pane.jsx'
import { createWorkspaceSession } from './store.js'

const overview = { initialPath: 'a.js', files: [{ path: 'a.js' }, { path: 'b.js' }] }
export default function Demo() {
  const [{ store, dispatch }] = useState(createWorkspaceSession)
  const [ready, setReady] = useState(false)
  return <main>
    <h1>Isolated workspace store evaluation</h1>
    <Pane store={store} overview={overview} paths={['a.js', 'b.js']} status={ready ? 'success' : 'loading'} />
    <button onClick={() => dispatch({ type: 'file_selected', path: 'b.js' })}>Select b.js</button>
    <button onClick={() => dispatch({ type: 'finder_file_opened', path: 'pending.js', changed: false })}>Open pending file</button>
    <button onClick={() => setReady(true)}>Complete repository request</button>
    <button onClick={() => dispatch({ type: 'tree_mode_changed', mode: 'changes', visiblePaths: ['a.js', 'b.js'], initialPath: 'a.js' })}>Show changes</button>
    <button onClick={() => dispatch({ type: 'finder_opened' })}>Open finder state</button>
  </main>
}
createRoot(document.getElementById('root')).render(<Demo />)
