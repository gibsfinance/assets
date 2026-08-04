import { Link, useLocation } from 'react-router'

/**
 * Terminal route for a hash path matching nothing.
 *
 * Before this existed the router simply rendered no element, so a mistyped or stale link
 * produced the site chrome above an empty page — indistinguishable from a page that had
 * failed to load, which invites a reload that cannot help.
 *
 * A redirect to home was the alternative and is worse: it discards the URL that would tell
 * the visitor what went wrong, and silently landing somewhere other than where a link
 * pointed reads as a broken site rather than a wrong address. The client cannot set an HTTP
 * status here — the document was already served 200, and under HashRouter the server never
 * sees this part of the URL at all — so saying so in the page is the honest equivalent.
 */
export default function NotFound() {
  const location = useLocation()

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
      <p className="font-heading text-7xl font-bold text-gradient-brand">404</p>

      <h1 className="mt-6 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        This page does not exist
      </h1>

      <p className="mt-3 text-gray-500 dark:text-gray-400">
        Nothing is served at{' '}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          #{location.pathname}
        </code>
        . The address may be mistyped, or the page may have moved.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
        <Link to="/" className="btn-primary text-sm">
          Back to home
        </Link>
        <Link to="/studio" className="btn-secondary text-sm">
          Open Studio
        </Link>
        <Link
          to="/docs"
          className="text-sm font-medium text-gray-500 transition-colors hover:text-accent-500 dark:text-gray-400"
        >
          Read the docs
        </Link>
      </div>
    </div>
  )
}
