/**
 * The table of contents for the documentation page.
 *
 * It renders two variants of the same list — a sticky column on wide screens and a
 * horizontal tab strip on narrow ones — and both are pure navigation: a click reports
 * the section identifier upward and scrolls the matching element into view.
 *
 * Every failure this component can have is silent. A section identifier that no element
 * on the page uses still renders a perfectly ordinary looking button; it simply does
 * nothing when clicked. The narrow variant marks the active tab through a data attribute
 * and scrolls it into view through an effect, so dropping either leaves the strip looking
 * correct while the highlight sits off screen. The tests below therefore assert what the
 * click and the effect actually reach, not what the markup says.
 *
 * jsdom implements no scrolling at all, so `scrollIntoView` is stubbed at the host
 * boundary and records the element it was called on. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import DocsSidebar, { type DocsSidebarSection } from './DocsSidebar'

const SECTIONS: DocsSidebarSection[] = [
  { id: 'token-endpoints', label: 'Token Endpoints' },
  { id: 'image-endpoints', label: 'Image Endpoints' },
  { id: 'features', label: 'Features' },
]

/** Elements scrolled into view since the last reset, in call order. */
let scrolledInto: Element[] = []
const originalScrollIntoView = Element.prototype.scrollIntoView

beforeEach(() => {
  scrolledInto = []
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) {
    scrolledInto.push(this)
  }
})

afterEach(() => {
  cleanup()
  Element.prototype.scrollIntoView = originalScrollIntoView
})

/**
 * Render the sidebar next to a stand-in for the page it navigates, so that
 * `document.getElementById` finds the same anchors the real page provides.
 * Pass `anchors` to control which sections actually exist in the document.
 */
function renderSidebar({
  sections = SECTIONS,
  activeSection = SECTIONS[0].id,
  variant,
  anchors = sections.map((section) => section.id),
  onSectionChange = vi.fn(),
}: Partial<{
  sections: DocsSidebarSection[]
  activeSection: string
  variant: 'desktop' | 'mobile'
  anchors: string[]
  onSectionChange: (id: string) => void
}> = {}) {
  const view = render(
    <>
      {anchors.map((id) => (
        <section key={id} id={id} data-testid={`anchor-${id}`} />
      ))}
      <DocsSidebar
        sections={sections}
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        {...(variant ? { variant } : {})}
      />
    </>,
  )
  return { ...view, onSectionChange }
}

/** The wide-screen variant is the one inside the aside element. */
const desktopButtons = (container: HTMLElement) =>
  [...container.querySelectorAll('aside nav button')] as HTMLButtonElement[]

/** The narrow-screen variant is the only one that marks tabs with data-active. */
const mobileButtons = (container: HTMLElement) =>
  [...container.querySelectorAll('button[data-active]')] as HTMLButtonElement[]

describe('DocsSidebar', () => {
  it('renders the wide-screen variant unless the narrow one is asked for', () => {
    const { container } = renderSidebar()
    expect(desktopButtons(container).map((button) => button.textContent)).toEqual([
      'Token Endpoints',
      'Image Endpoints',
      'Features',
    ])
    expect(mobileButtons(container)).toHaveLength(0)
  })

  it('keeps the entries in the order the page lists its sections', () => {
    // The sidebar is a table of contents; reordering it against the document would
    // send readers backwards through the page while the highlight moves forwards.
    const reversed = [...SECTIONS].reverse()
    const { container } = renderSidebar({ sections: reversed })
    expect(desktopButtons(container).map((button) => button.textContent)).toEqual(
      reversed.map((section) => section.label),
    )
  })

  it('reports the section identifier and scrolls that section into view when clicked', () => {
    const { container, onSectionChange } = renderSidebar()
    fireEvent.click(desktopButtons(container)[1])

    expect(onSectionChange).toHaveBeenCalledWith('image-endpoints')
    expect(scrolledInto).toHaveLength(1)
    expect((scrolledInto[0] as HTMLElement).id).toBe('image-endpoints')
  })

  it('scrolls nothing, and does not throw, when an entry names a section the page lacks', () => {
    // This is the failure worth catching: an entry whose identifier no heading uses is
    // indistinguishable from a working one until someone clicks it and the page sits
    // still. The parent is still told about the change, so the highlight moves to a
    // section that is not there.
    const { container, onSectionChange } = renderSidebar({
      sections: [{ id: 'renamed-away', label: 'Renamed Away' }],
      anchors: [],
    })
    fireEvent.click(desktopButtons(container)[0])

    expect(onSectionChange).toHaveBeenCalledWith('renamed-away')
    expect(scrolledInto).toHaveLength(0)
  })

  it('marks exactly one wide-screen entry as the current section', () => {
    const { container } = renderSidebar({ activeSection: 'features' })
    const highlighted = desktopButtons(container).filter((button) =>
      button.className.includes('border-accent-500'),
    )
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].textContent).toBe('Features')
  })

  it('highlights nothing when the current section is not one of its entries', () => {
    const { container } = renderSidebar({ activeSection: 'not-a-section' })
    const highlighted = desktopButtons(container).filter((button) =>
      button.className.includes('border-accent-500'),
    )
    expect(highlighted).toHaveLength(0)
  })

  it('marks exactly one narrow-screen tab active, and machine-readably so', () => {
    // The data attribute is not decoration: the effect below finds the active tab
    // through it, so a styling-only highlight would stop the strip auto-scrolling.
    const { container } = renderSidebar({ variant: 'mobile', activeSection: 'image-endpoints' })
    const active = mobileButtons(container).filter(
      (button) => button.getAttribute('data-active') === 'true',
    )
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe('Image Endpoints')
  })

  it('brings the active narrow-screen tab into view on mount', () => {
    const { container } = renderSidebar({ variant: 'mobile', activeSection: 'features' })
    const active = mobileButtons(container).find(
      (button) => button.getAttribute('data-active') === 'true',
    )
    expect(scrolledInto).toContain(active)
  })

  it('follows the active tab along the strip as the current section changes', () => {
    // Sections scroll past faster than the strip is wide. Without this the reader ends
    // up on a section whose tab has slid out of the visible part of the strip.
    const { container, rerender } = renderSidebar({
      variant: 'mobile',
      activeSection: 'token-endpoints',
    })
    scrolledInto = []

    rerender(
      <>
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} />
        ))}
        <DocsSidebar
          sections={SECTIONS}
          activeSection="features"
          onSectionChange={vi.fn()}
          variant="mobile"
        />
      </>,
    )

    const active = mobileButtons(container).find(
      (button) => button.getAttribute('data-active') === 'true',
    )
    expect(active?.textContent).toBe('Features')
    expect(scrolledInto).toContain(active)
  })

  it('scrolls no tab into view when no tab is active', () => {
    renderSidebar({ variant: 'mobile', activeSection: 'not-a-section' })
    expect(scrolledInto).toHaveLength(0)
  })

  it('reports and scrolls from the narrow-screen variant too', () => {
    const { container, onSectionChange } = renderSidebar({
      variant: 'mobile',
      activeSection: 'token-endpoints',
    })
    scrolledInto = []
    fireEvent.click(mobileButtons(container)[2])

    expect(onSectionChange).toHaveBeenCalledWith('features')
    expect((scrolledInto.at(-1) as HTMLElement).id).toBe('features')
  })

  it('renders no navigation at all when there are no sections to list', () => {
    const { container } = renderSidebar({ sections: [], anchors: [] })
    expect(desktopButtons(container)).toHaveLength(0)
    expect(screen.getByText('On this page')).toBeTruthy()
  })
})
