import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/instrument-sans/wght.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { startPersistence } from './store/persist'

startPersistence().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
