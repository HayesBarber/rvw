import { installGlobalLogging } from './review/log.js'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import { defaultApplicationBindings } from './actions/application-actions.js'
import './index.css'
import { VimProvider } from './vim/index.js'

installGlobalLogging()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VimProvider bindings={defaultApplicationBindings}>
      <App />
    </VimProvider>
  </StrictMode>,
)
