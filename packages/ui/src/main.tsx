import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted font-awesome: bundled through vite instead of a render-blocking
// cross-origin cdnjs stylesheet. Webfonts load on demand per icon family.
import '@fortawesome/fontawesome-free/css/all.min.css'
import './app.css'
import { App } from './App'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
