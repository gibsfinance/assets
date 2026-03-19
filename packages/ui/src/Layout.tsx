import { Link, Outlet, useLocation } from 'react-router-dom'
import { ThemeToggle } from './lib/components/ThemeToggle'

export function Layout() {
  const location = useLocation()
  const isStudio = location.pathname === '/studio'

  return (
    <div className="min-h-screen bg-surface-light-base dark:bg-surface-base text-gray-900 dark:text-gray-100">
      <header className="sticky top-0 z-50 border-b border-border-light dark:border-border-dark bg-white/80 dark:bg-surface-base/80 backdrop-blur-lg">
        <div className="mx-auto flex items-center justify-between px-4 py-3 max-w-7xl">
          <Link to="/" className="font-heading text-2xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
            Gib.Show
          </Link>
          <div className="flex items-center gap-4">
            {!isStudio && (
              <Link to="/studio" className="btn-primary text-sm">
                Studio
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
