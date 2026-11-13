import { useTheme } from '../contexts/ThemeContext'
import { faDesktop, faMoon, faSun } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

export function ThemeToggle() {
  const { isDark, mode, setMode } = useTheme()

  const isSystem = mode === 'system'

  const handleThemeClick = () => {
    if (isDark) {
      setMode('light')
    } else {
      setMode('dark')
    }
  }

  const handleSystemClick = () => {
    if (isSystem) {
      // Exiting system mode: lock to current resolved theme
      setMode(isDark ? 'dark' : 'light')
    } else {
      setMode('system')
    }
  }

  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        className={`flex items-center justify-center w-9 h-9 transition-all duration-150 rounded-l-lg ${
          isSystem
            ? 'bg-surface-inset/50 text-content-faint'
            : 'bg-surface-inset text-content-secondary hover:bg-surface-active'
        }`}
        onClick={handleThemeClick}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {isDark ? <Icon icon={faSun} className="text-base" /> : <Icon icon={faMoon} className="text-base" />}
      </button>
      <button
        type="button"
        className={`flex items-center justify-center w-9 h-9 border-l border-border transition-all duration-150 rounded-r-lg ${
          isSystem ? 'bg-accent/10 text-accent-content' : 'bg-surface-inset text-content-faint hover:bg-surface-active'
        }`}
        onClick={handleSystemClick}
        title={isSystem ? 'Using system theme' : 'Use system theme'}>
        <Icon icon={faDesktop} className="text-base" />
      </button>
    </div>
  )
}
