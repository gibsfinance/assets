import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { SettingsProvider } from './lib/contexts/SettingsContext'
import { MetricsProvider } from './lib/contexts/MetricsContext'
import { StudioProvider } from './lib/contexts/StudioContext'
import { ListEditorProvider } from './lib/contexts/ListEditorContext'
import { handleOAuthCallback } from './lib/hooks/useVCSPublish'
import { getApiUrl } from './lib/utils'
import { queryClient } from './lib/query-client'
import { Layout } from './Layout'
import Home from './lib/pages/Home'
import Studio from './lib/pages/Studio'
import Docs from './lib/pages/Docs'

export function App() {
  // Process OAuth callback params on mount (after redirect from GitHub/GitLab/Gitea)
  useEffect(() => {
    handleOAuthCallback(getApiUrl(''))
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SettingsProvider>
          <MetricsProvider>
            <StudioProvider>
              <ListEditorProvider>
                <HashRouter>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<Home />} />
                      <Route path="studio" element={<Studio />} />
                      <Route path="wizard" element={<Navigate to="/studio" replace />} />
                      <Route path="docs" element={<Docs />} />
                    </Route>
                  </Routes>
                </HashRouter>
              </ListEditorProvider>
            </StudioProvider>
          </MetricsProvider>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
