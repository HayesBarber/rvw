import { installGlobalLogging } from './review/log.js'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import ReviewStartup from './app/ReviewStartup.jsx'
import { defaultApplicationBindings } from './actions/application-actions.js'
import './index.css'
import { VimProvider } from './vim/index.js'

installGlobalLogging()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReviewStartup>{(onRetryStartup, openPickerOnLaunch) => (
      <VimProvider bindings={defaultApplicationBindings}>
        <App onRetryStartup={onRetryStartup} openPickerOnLaunch={openPickerOnLaunch} />
      </VimProvider>
    )}</ReviewStartup>
  </StrictMode>,
)
