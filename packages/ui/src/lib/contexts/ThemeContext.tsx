import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type ThemeContextValue = {
  isDark: boolean
  toggle: () => void
  set: (value: boolean) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  toggle: () => {},
  set: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = localStorage.getItem('theme')
    if (stored) return stored === 'dark'
    return false
  })

  useEffect(() => {
    if (!localStorage.getItem('theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      setIsDark(prefersDark)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const toggle = useCallback(() => setIsDark((prev) => !prev), [])

  const set = useCallback((value: boolean) => {
    setIsDark(value)
  }, [])

  return <ThemeContext.Provider value={{ isDark, toggle, set }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
