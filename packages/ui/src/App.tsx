import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { SettingsProvider } from './lib/contexts/SettingsContext'
import { MetricsProvider } from './lib/contexts/MetricsContext'
import { StudioProvider } from './lib/contexts/StudioContext'
import { Layout } from './Layout'
import Home from './lib/pages/Home'
import Studio from './lib/pages/Studio'
import Docs from './lib/pages/Docs'

export function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <MetricsProvider>
          <StudioProvider>
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
          </StudioProvider>
        </MetricsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
