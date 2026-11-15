import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { faImage } from '@fortawesome/free-solid-svg-icons'
import IntegrationCard, { IntegrationAddress, addressSegments, type IntegrationCardLayout } from './IntegrationCard'

afterEach(cleanup)

const DOCS_HREF = 'https://docs.gib.show/api-reference/images/'

function renderCard(layout: IntegrationCardLayout, preview: boolean) {
  return render(
    <IntegrationCard
      layout={layout}
      icon={faImage}
      title="Example title"
      description="Example description"
      preview={preview ? <span>the live example</span> : undefined}
      docsHref={DOCS_HREF}>
      <p>the text under the description</p>
    </IntegrationCard>,
  )
}

describe('IntegrationCard, compact layout', () => {
  it('shows its title and description under the preview', () => {
    renderCard('compact', true)
    expect(screen.getByRole('heading', { name: 'Example title' })).toBeTruthy()
    expect(screen.getByText('Example description')).toBeTruthy()
  })

  it('draws the preview in its own panel, above the title, as the layout expects', () => {
    const { container } = renderCard('compact', true)
    const preview = screen.getByText('the live example')
    const title = screen.getByRole('heading', { name: 'Example title' })
    expect(preview.parentElement!.className).toContain('bg-surface-inset')
    expect(preview.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('.bg-surface-inset')).toHaveLength(1)
  })

  it('pushes the documentation link to the foot of the card, so cards in a row line up', () => {
    renderCard('compact', true)
    const docs = screen.getByRole('link', { name: /Read the full documentation/ })
    expect(docs.className).toContain('mt-auto')
  })
})

describe('IntegrationCard, wide layout', () => {
  it('has no preview panel of its own, because its children draw the body', () => {
    const { container } = renderCard('wide', false)
    expect(container.querySelectorAll('.bg-surface-inset')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Example title' })).toBeTruthy()
  })

  it('draws the children under the description, before the documentation link', () => {
    renderCard('wide', false)
    const description = screen.getByText('Example description')
    const under = screen.getByText('the text under the description')
    const docs = screen.getByRole('link', { name: /Read the full documentation/ })
    expect(description.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(under.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a preview only when one is given, even in the wide layout', () => {
    renderCard('wide', true)
    expect(screen.getByText('the live example')).toBeTruthy()
  })
})

describe('IntegrationCard, both layouts', () => {
  it.each(['compact', 'wide'] as const)('links the documentation page in a new tab (%s)', (layout) => {
    renderCard(layout, false)
    const docs = screen.getByRole('link', { name: /Read the full documentation/ })
    expect(docs.getAttribute('href')).toBe(DOCS_HREF)
    expect(docs.getAttribute('target')).toBe('_blank')
    expect(docs.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('addressSegments', () => {
  it('breaks only after each question mark and each ampersand, and joins back to the exact address', () => {
    const address = 'https://gib.show/image/eip155-1/0xabc?w=64&h=64&as=webp'
    const segments = addressSegments(address)
    expect(segments).toEqual(['https://gib.show/image/eip155-1/0xabc?', 'w=64&', 'h=64&', 'as=webp'])
    expect(segments.join('')).toBe(address)
  })

  it('has no break point in an address without a query', () => {
    expect(addressSegments('https://gib.show/image/eip155-1')).toEqual(['https://gib.show/image/eip155-1'])
  })
})

describe('IntegrationAddress', () => {
  const address = 'https://gib.show/image/eip155-25?contrast=dark'

  it('shows the full address as its own text, so a reader can copy exactly what the link opens', () => {
    render(<IntegrationAddress href={address} />)
    expect(screen.getByText(address).tagName).toBe('CODE')
  })

  it('offers a break point after the question mark, and none in the path', () => {
    const { container } = render(<IntegrationAddress href={address} />)
    const code = container.querySelector('code')!
    expect(code.querySelectorAll('wbr')).toHaveLength(1)
    expect(code.innerHTML.indexOf('<wbr>')).toBeGreaterThan(code.innerHTML.indexOf('eip155-25?'))
  })

  it('opens the same address it shows', () => {
    render(<IntegrationAddress href={address} />)
    const link = screen.getByText(address).closest('a')!
    expect(link.getAttribute('href')).toBe(address)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
