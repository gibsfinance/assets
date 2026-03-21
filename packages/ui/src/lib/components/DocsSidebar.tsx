import { useEffect, useRef } from 'react'

export interface DocsSidebarSection {
  id: string
  label: string
}

interface DocsSidebarProps {
  sections: DocsSidebarSection[]
  activeSection: string
  onSectionChange: (id: string) => void
  /** Controls which variant to render. Defaults to 'desktop'. */
  variant?: 'desktop' | 'mobile'
}

function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/** Desktop: sticky left sidebar nav */
function DesktopSidebar({
  sections,
  activeSection,
  onSectionChange,
}: Omit<DocsSidebarProps, 'variant'>) {
  const handleClick = (id: string) => {
    onSectionChange(id)
    scrollToSection(id)
  }

  return (
    <aside className="hidden lg:block">
      <nav className="sticky top-24 space-y-1">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500">
          On this page
        </p>
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleClick(section.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${
              activeSection === section.id
                ? 'bg-accent-500/10 text-accent-500 border-l-2 border-accent-500 pl-[10px]'
                : 'text-gray-600 dark:text-gray-400 hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {section.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

/** Mobile: horizontal scrolling tab bar */
function MobileSidebar({
  sections,
  activeSection,
  onSectionChange,
}: Omit<DocsSidebarProps, 'variant'>) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll the active tab into view
  useEffect(() => {
    if (!containerRef.current) return
    const active = containerRef.current.querySelector('[data-active="true"]')
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeSection])

  const handleClick = (id: string) => {
    onSectionChange(id)
    scrollToSection(id)
  }

  return (
    <div
      ref={containerRef}
      className="lg:hidden sticky top-14 z-10 flex gap-2 overflow-x-auto border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base py-2 px-4"
    >
      {sections.map((section) => (
        <button
          key={section.id}
          data-active={activeSection === section.id ? 'true' : 'false'}
          onClick={() => handleClick(section.id)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap ${
            activeSection === section.id
              ? 'bg-accent-500 text-black'
              : 'bg-surface-light-2 dark:bg-surface-2 text-gray-600 dark:text-gray-400 hover:bg-surface-light-3 dark:hover:bg-surface-3'
          }`}
        >
          {section.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Sidebar navigation for the Docs page.
 *
 * Renders a sticky desktop sidebar on large screens and a horizontal
 * scrolling tab bar on mobile. Each variant is visibility-controlled
 * via Tailwind responsive utilities, so both can be rendered in the tree
 * simultaneously without duplication of logic.
 */
export default function DocsSidebar({ sections, activeSection, onSectionChange, variant = 'desktop' }: DocsSidebarProps) {
  if (variant === 'mobile') {
    return (
      <MobileSidebar
        sections={sections}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
      />
    )
  }

  return (
    <DesktopSidebar
      sections={sections}
      activeSection={activeSection}
      onSectionChange={onSectionChange}
    />
  )
}
