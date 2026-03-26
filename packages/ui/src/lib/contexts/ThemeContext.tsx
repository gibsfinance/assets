import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'

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
  const [systemPreference, setSystemPreference] = useState(resolveSystemPreference)

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    localStorage.setItem('theme-mode', newMode)
  }, [])

  // Subscribe to OS dark mode changes (real side effect: event listener)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPreference(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // Derived: isDark is purely computed from mode + systemPreference
  const isDark = useMemo(() => {
    if (mode === 'system') return systemPreference
    return mode === 'dark'
  }, [mode, systemPreference])

  // Apply dark class to document (real side effect: DOM mutation)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  return <ThemeContext.Provider value={{ isDark, mode, setMode }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
