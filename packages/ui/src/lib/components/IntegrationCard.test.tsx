import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import IntegrationCard, { IntegrationAddress } from './IntegrationCard'

afterEach(cleanup)

const DOCS_HREF = 'https://docs.gib.show/api-reference/images/'

function renderCard(overrides: Partial<Parameters<typeof IntegrationCard>[0]> = {}) {
  return render(
    <IntegrationCard
      icon={faImage}
      title="Example title"
      description="Example description"
      preview={<span>the live example</span>}
      docsHref={DOCS_HREF}
      {...overrides}>
      <p>the text under the description</p>
    </IntegrationCard>,
  )
}

describe('IntegrationCard', () => {
  it('shows its title and description in the text panel', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Example title' })).toBeTruthy()
    expect(screen.getByText('Example description')).toBeTruthy()
  })

  it('draws the preview in the panel that comes before the text, as the layout expects', () => {
    const { container } = renderCard()
    const preview = screen.getByText('the live example')
    const text = screen.getByText('Example description')
    expect(preview.parentElement!.className).toContain('bg-surface-inset')
    expect(preview.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.bg-surface-inset')).toHaveLength(1)
  })

  it('draws whatever sits under the description, after it and before the documentation link', () => {
    renderCard()
    const description = screen.getByText('Example description')
    const under = screen.getByText('the text under the description')
    const docs = screen.getByRole('link', { name: /Read the full documentation/ })
    expect(description.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(under.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('links the documentation page in a new tab, opened without a reference to the page', () => {
    renderCard()
    const docs = screen.getByRole('link', { name: /Read the full documentation/ })
    expect(docs.getAttribute('href')).toBe(DOCS_HREF)
    expect(docs.getAttribute('target')).toBe('_blank')
    expect(docs.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('IntegrationAddress', () => {
  const address = 'https://gib.show/image/eip155-25?contrast=dark'

  it('shows the full address as its own text, so a reader can copy exactly what the link opens', () => {
    render(<IntegrationAddress href={address} />)
    expect(screen.getByText(address).tagName).toBe('CODE')
  })

  it('opens the same address it shows', () => {
    render(<IntegrationAddress href={address} />)
    const link = screen.getByText(address).closest('a')!
    expect(link.getAttribute('href')).toBe(address)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
