import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type ThemeMode = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  isDark: boolean
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  mode: 'system',
  setMode: () => {},
})

function resolveSystemPreference(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function loadStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem('theme-mode')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'system') return resolveSystemPreference()
  return mode === 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode)
  const [isDark, setIsDark] = useState(() => resolveIsDark(loadStoredMode()))

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    localStorage.setItem('theme-mode', newMode)
    setIsDark(resolveIsDark(newMode))
  }, [])

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (mode !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => {
      setIsDark(event.matches)
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [mode])

  // Apply dark class to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  return <ThemeContext.Provider value={{ isDark, mode, setMode }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
