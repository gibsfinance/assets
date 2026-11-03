import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { AppProviders, AppRoutes } from './App'
import { queryClient } from './lib/query-client'

/**
 * Renders the home route to an HTML string, with an empty query cache.
 *
 * The build calls this once and writes the result into `index.html`, so the page
 * paints before any script runs. The client does not hydrate this markup; it
 * replaces it, so the snapshot never has to match the browser render byte for
 * byte. This module is never part of the browser bundle.
 *
 * Rendering registers the home page's queries, and each schedules a garbage
 * collection timer of up to an hour. Those timers kept the build process alive
 * for that long after the build had finished, so the cache is cleared here, which
 * cancels them.
 */
export function renderHome(): string {
  const markup = renderToString(
    <AppProviders>
      <StaticRouter location="/">
        <AppRoutes />
      </StaticRouter>
    </AppProviders>,
  )
  queryClient.clear()
  return markup
}
