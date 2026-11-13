import { Link, Outlet, useLocation } from 'react-router'
import { ThemeToggle } from './lib/components/ThemeToggle'
import { prefetchStudio } from './lib/pages/load-studio'

export function Layout() {
  const location = useLocation()
  const isStudio = location.pathname === '/studio'

  return (
    <div className="min-h-screen bg-surface text-content-strong">
      {!isStudio && (
        <header className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur-lg">
          <div className="mx-auto flex items-center justify-between px-4 py-3 max-w-7xl">
            <Link
              to="/"
              className="font-heading text-2xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
              Gib.Show
            </Link>
            <div className="flex items-center gap-4">
              <Link
                to="/docs"
                className="text-sm font-medium text-content-subtle hover:text-accent-content transition-colors">
                Docs
              </Link>
              <Link
                to="/studio"
                className="btn-primary text-sm"
                onPointerEnter={prefetchStudio}
                onPointerDown={prefetchStudio}
                onFocus={prefetchStudio}>
                Studio
              </Link>
              <ThemeToggle />
            </div>
          </div>
        </header>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  )
}
