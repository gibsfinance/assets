import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { SettingsProvider } from './lib/contexts/SettingsContext'
import { MetricsProvider } from './lib/contexts/MetricsContext'
import { Layout } from './Layout'

/** Placeholder pages — real implementations come in Tasks 7-9 */
function Home() {
  return <div>Home page placeholder</div>
}

function Wizard() {
  return <div>Wizard page placeholder</div>
}

function Docs() {
  return <div>Docs page placeholder</div>
}

export function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <MetricsProvider>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/wizard" element={<Wizard />} />
                <Route path="/docs" element={<Docs />} />
              </Route>
            </Routes>
          </HashRouter>
        </MetricsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
