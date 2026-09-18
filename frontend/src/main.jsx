import HighlightWorker from '@pierre/diffs/worker/worker-portable.js?worker&inline'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { installGlobalLogging } from './review/log.js'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import { defaultApplicationBindings } from './actions/application-actions.js'
import './index.css'
import { VimProvider } from './vim/index.js'

// Inline the portable worker so the native custom asset scheme needs no
// network fetch or module imports from a blob URL.
const poolOptions = { poolSize: 2, totalASTLRUCacheSize: 16, workerFactory: () => new HighlightWorker() }
const highlighterOptions = { langs: ['javascript', 'typescript', 'tsx', 'zig', 'swift'] }

installGlobalLogging()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      <VimProvider bindings={defaultApplicationBindings}>
        <App />
      </VimProvider>
    </WorkerPoolContextProvider>
  </StrictMode>,
)
