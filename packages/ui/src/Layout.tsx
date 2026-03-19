import { Link, Outlet, useLocation } from 'react-router-dom'
import { ThemeToggle } from './lib/components/ThemeToggle'

export function Layout() {
  const location = useLocation()
  const isWizardPage = location.pathname === '/wizard'

  return (
    <div className="min-h-full overflow-x-hidden bg-gray-50 dark:bg-gray-950">
      <header className="top-0 z-50 border-b border-gray-200/50 bg-white dark:bg-gray-900">
        <nav className="mx-auto p-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="font-space-grotesk group text-2xl font-bold tracking-tight transition-colors hover:text-secondary-600 dark:text-white"
            >
              <span className="transition-colors group-hover:text-secondary-600">Gib</span>
              <span className="text-secondary-600">.Show</span>
            </Link>
            <div className="flex items-center gap-4">
              {!isWizardPage && (
                <Link
                  to="/wizard"
                  className="btn bg-secondary-600 text-black shadow-lg transition-all hover:bg-secondary-600/80"
                >
                  <i className="fas fa-hat-wizard mr-2"></i>
                  Wizard
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>
        </nav>
      </header>

      <main className="mx-auto min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
