import { useEffect, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
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

// Home stays eager — it is the landing route and must paint immediately.
// Studio (virtualized browser + list editor) and Docs (live endpoint cards)
// are heavy and only needed on navigation, so they load as separate chunks.
const Studio = lazy(() => import('./lib/pages/Studio'))
const Docs = lazy(() => import('./lib/pages/Docs'))

export function App() {
  // Process OAuth callback params on mount (after redirect from GitHub/GitLab/Gitea)
  useEffect(() => {
    handleOAuthCallback(getApiUrl(''))
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <StudioProvider>
            <ListEditorProvider>
              <HashRouter>
                <Suspense fallback={null}>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<Home />} />
                      <Route path="studio" element={<Studio />} />
                      <Route path="wizard" element={<Navigate to="/studio" replace />} />
                      <Route path="docs" element={<Docs />} />
                    </Route>
                  </Routes>
                </Suspense>
              </HashRouter>
            </ListEditorProvider>
          </StudioProvider>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
