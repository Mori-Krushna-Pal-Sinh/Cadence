import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/instrument-sans/wght.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { initAuth } from './store/auth'
import { startPersistence } from './store/persist'

// Auth resolves first so startPersistence loads the right account's namespace
// immediately — nothing renders in between, so no account's data ever flashes
// on screen before the correct one is known.
initAuth()
  .then((userId) => startPersistence(userId))
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
