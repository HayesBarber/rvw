import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { defaultApplicationBindings } from './application-actions.js'
import './index.css'
import { VimProvider } from './vim/index.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VimProvider bindings={defaultApplicationBindings}>
      <App />
    </VimProvider>
  </StrictMode>,
)
