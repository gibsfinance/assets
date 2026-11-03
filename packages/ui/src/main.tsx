import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './app.css'
import { App } from './App'
import { removeRouteLoader } from './prerender/route-loader'
import { registerServiceWorker } from './sw/register'
import { installPreloadRecovery } from './sw/preload-recovery'

/**
 * Takes the build-time loader down once React has committed its first render, so a
 * page other than home never shows a blank gap between the loader and the route.
 */
function RouteLoaderRemover() {
  useEffect(removeRouteLoader, [])
  return null
}

// Before the first render, so no lazy import can fail ahead of it.
installPreloadRecovery({ window, now: Date.now })

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <RouteLoaderRemover />
    <App />
  </StrictMode>,
)

// Production builds only, and not when the build was made with the kill switch
// (`VITE_SERVICE_WORKER=off`). Development and tests never register a worker.
registerServiceWorker({
  enabled: import.meta.env.PROD && import.meta.env.VITE_SERVICE_WORKER !== 'off',
  navigator,
  window,
})
