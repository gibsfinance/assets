interface FrameworkLanguage {
  key: string
  label: string
}

export interface FrameworkSwitcherProps {
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
              ? 'bg-accent text-black shadow-glow-accent'
              : 'bg-surface-inset-4 text-content-muted hover:bg-surface-active-5'
          }`}>
          {lang.label}
        </button>
      ))}
    </div>
  )
}
