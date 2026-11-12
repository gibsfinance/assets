import { useEffect, useRef } from 'react'

export interface DocsSidebarSection {
  id: string
  label: string
}

export interface DocsSidebarProps {
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
function DesktopSidebar({ sections, activeSection, onSectionChange }: Omit<DocsSidebarProps, 'variant'>) {
  const handleClick = (id: string) => {
    onSectionChange(id)
    scrollToSection(id)
  }

  return (
    <aside className="hidden lg:block">
      <nav className="sticky top-24 space-y-1">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-content-subtle-4">On this page</p>
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleClick(section.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-all duration-150 ${
              activeSection === section.id
                ? 'bg-accent/10 text-accent border-l-2 border-accent pl-[10px]'
                : 'text-content-muted hover:bg-surface-sheen hover:text-content-strong'
            }`}>
            {section.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}

/** Mobile: horizontal scrolling tab bar */
function MobileSidebar({ sections, activeSection, onSectionChange }: Omit<DocsSidebarProps, 'variant'>) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll the active tab into view.
  //
  // The container ref is attached to a div this component always renders, and React
  // attaches refs during the commit that runs this effect, so containerRef.current is
  // always set by the time this callback fires. There is no mount state where it is not.
  useEffect(() => {
    const container = containerRef.current as HTMLDivElement
    const active = container.querySelector('[data-active="true"]')
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeSection])

  const handleClick = (id: string) => {
    onSectionChange(id)
    scrollToSection(id)
  }

  return (
    <div
      ref={containerRef}
      className="lg:hidden sticky top-14 z-10 flex gap-2 overflow-x-auto border-b border-border bg-surface py-2 px-4">
      {sections.map((section) => (
        <button
          key={section.id}
          data-active={activeSection === section.id ? 'true' : 'false'}
          onClick={() => handleClick(section.id)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap ${
            activeSection === section.id
              ? 'bg-accent text-black'
              : 'bg-surface-inset-4 text-content-muted hover:bg-surface-active-5'
          }`}>
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
export default function DocsSidebar({
  sections,
  activeSection,
  onSectionChange,
  variant = 'desktop',
}: DocsSidebarProps) {
  if (variant === 'mobile') {
    return <MobileSidebar sections={sections} activeSection={activeSection} onSectionChange={onSectionChange} />
  }

  return <DesktopSidebar sections={sections} activeSection={activeSection} onSectionChange={onSectionChange} />
}
