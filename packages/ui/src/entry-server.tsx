import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { AppProviders, AppRoutes } from './App'

/**
 * Renders the home route to an HTML string, with an empty query cache.
 *
 * The build calls this once and writes the result into `index.html`, so the page
 * paints before any script runs. The client does not hydrate this markup; it
 * replaces it, so the snapshot never has to match the browser render byte for
 * byte. This module is never part of the browser bundle.
 */
export function renderHome(): string {
  return renderToString(
    <AppProviders>
      <StaticRouter location="/">
        <AppRoutes />
      </StaticRouter>
    </AppProviders>,
  )
}
