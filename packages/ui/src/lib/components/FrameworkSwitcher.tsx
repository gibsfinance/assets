interface FrameworkLanguage {
  key: string
  label: string
}

interface FrameworkSwitcherProps {
  languages: FrameworkLanguage[]
  activeLanguage: string
  onSelect: (key: string) => void
}

export default function FrameworkSwitcher({ languages, activeLanguage, onSelect }: FrameworkSwitcherProps) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Code language selector">
      {languages.map((lang) => (
        <button
          key={lang.key}
          role="tab"
          aria-selected={activeLanguage === lang.key}
          onClick={() => onSelect(lang.key)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
            activeLanguage === lang.key
              ? 'bg-accent-500 text-black shadow-glow-green'
              : 'bg-surface-light-2 dark:bg-surface-2 text-gray-600 dark:text-gray-400 hover:bg-surface-light-3 dark:hover:bg-surface-3'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  )
}
