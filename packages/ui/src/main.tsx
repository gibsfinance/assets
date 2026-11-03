import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './app.css'
import { App } from './App'
import { removeRouteLoader } from './prerender/route-loader'

/**
 * Takes the build-time loader down once React has committed its first render, so a
 * page other than home never shows a blank gap between the loader and the route.
 */
function RouteLoaderRemover() {
  useEffect(removeRouteLoader, [])
  return null
}

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <RouteLoaderRemover />
    <App />
  </StrictMode>,
)
