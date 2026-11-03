import { useEffect, lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { SettingsProvider } from './lib/contexts/SettingsContext'
import { StudioProvider } from './lib/contexts/StudioContext'
import { ListEditorProvider } from './lib/contexts/ListEditorContext'
import { handleOAuthCallback } from './lib/hooks/useVCSPublish'
import { getApiUrl } from './lib/utils'
import { queryClient } from './lib/query-client'
import { Layout } from './Layout'
import Home from './lib/pages/Home'
import { loadStudio } from './lib/pages/load-studio'
import NotFound from './lib/pages/NotFound'

// Home stays eager — it is the landing route and must paint immediately.
// Studio (virtualized browser + list editor) and Docs (live endpoint cards)
// are heavy and only needed on navigation, so they load as separate chunks.
const Studio = lazy(loadStudio)
const Docs = lazy(() => import('./lib/pages/Docs'))

/**
 * Every provider the page needs, in the order the browser render and the
 * build-time static render must agree on. The router is the one thing that
 * differs between them, so it arrives as `children`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <StudioProvider>
            <ListEditorProvider>{children}</ListEditorProvider>
          </StudioProvider>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/** The route table, shared by the browser router and the build-time static router. */
export function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="studio" element={<Studio />} />
          <Route path="wizard" element={<Navigate to="/studio" replace />} />
          <Route path="docs" element={<Docs />} />
          {/* Inside Layout on purpose: a visitor who mistyped an address keeps
              the header and can navigate out without editing the URL. */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export function App() {
  // Process OAuth callback params on mount (after redirect from GitHub/GitLab/Gitea)
  useEffect(() => {
    handleOAuthCallback(getApiUrl(''))
  }, [])

  return (
    <AppProviders>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AppProviders>
  )
}
