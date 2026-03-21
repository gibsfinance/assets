import { useTheme } from '../contexts/ThemeContext'

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
    <div className="flex rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
      <button
        type="button"
        className={`flex items-center justify-center w-9 h-9 transition-all duration-150 rounded-l-lg ${
          isSystem
            ? 'bg-surface-light-2/50 dark:bg-surface-2/50 text-gray-400 dark:text-gray-500'
            : 'bg-surface-light-2 dark:bg-surface-2 text-gray-700 dark:text-gray-300 hover:bg-surface-light-3 dark:hover:bg-surface-3'
        }`}
        onClick={handleThemeClick}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? (
          <i className="fas fa-sun text-base" />
        ) : (
          <i className="fas fa-moon text-base" />
        )}
      </button>
      <button
        type="button"
        className={`flex items-center justify-center w-9 h-9 border-l border-border-light dark:border-border-dark transition-all duration-150 rounded-r-lg ${
          isSystem
            ? 'bg-accent-500/10 text-accent-500'
            : 'bg-surface-light-2 dark:bg-surface-2 text-gray-400 dark:text-gray-500 hover:bg-surface-light-3 dark:hover:bg-surface-3'
        }`}
        onClick={handleSystemClick}
        title={isSystem ? 'Using system theme' : 'Use system theme'}
      >
        <i className="fas fa-desktop text-base" />
      </button>
    </div>
  )
}
