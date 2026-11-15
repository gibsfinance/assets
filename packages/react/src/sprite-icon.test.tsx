import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { GibProvider } from './provider'
import { SpriteIcon } from './sprite-icon'

const address = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

/** The stylesheet links the page holds, in order. */
function stylesheetLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-gib-sprite]'))
}

describe('SpriteIcon', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[data-gib-sprite]').forEach((link) => link.remove())
  })

  it('gives the token class and the list scope class, and adds the list stylesheet', () => {
    const { container } = render(
      <SpriteIcon provider="coingecko" list="ethereum" chainId="eip155-1" address={address} />,
    )
    const icon = container.querySelector('span')!
    const classes = icon.className.split(' ')
    expect(classes).toHaveLength(2)
    expect(classes[0]).toMatch(/^gibsheet-[0-9a-f]{14}$/)
    expect(classes[1]).toBe(`gib-eip155-1-${address.toLowerCase()}`)
    expect(stylesheetLinks()[0].getAttribute('href')).toBe('https://gib.show/sprite/coingecko/ethereum/sheet.css')
  })

  it('adds one stylesheet link for two icons from the same list and options', () => {
    render(
      <>
        <SpriteIcon provider="p" list="l" chainId={1} address={address} />
        <SpriteIcon provider="p" list="l" chainId={369} address={address} />
      </>,
    )
    expect(stylesheetLinks()).toHaveLength(1)
  })

  it('adds a separate stylesheet for the same list at another size, because its layout differs', () => {
    render(
      <>
        <SpriteIcon provider="p" list="l" chainId={1} address={address} size={24} />
        <SpriteIcon provider="p" list="l" chainId={1} address={address} size={48} />
      </>,
    )
    expect(stylesheetLinks()).toHaveLength(2)
  })

  it('passes the sizing, gap and plate options to the stylesheet address and to its scope', () => {
    const { container } = render(
      <SpriteIcon
        provider="p"
        list="l"
        chainId={1}
        address={address}
        size={24}
        scale={2}
        gap={3}
        bg="ff8800"
        shape="square"
        contrast="dark"
        cols={10}
        limit={100}
        content="mixed"
      />,
    )
    const href = stylesheetLinks()[0].getAttribute('href')!
    expect(href).toContain('size=24')
    expect(href).toContain('scale=2')
    expect(href).toContain('gap=3')
    expect(href).toContain('bg=ff8800')
    expect(href).toContain('shape=square')
    expect(href).toContain('contrast=dark')
    expect(href).toContain('cols=10')
    expect(href).toContain('limit=100')
    expect(href).toContain('content=mixed')
    expect(container.querySelector('span')!.className).toMatch(/^gibsheet-/)
  })

  it('uses the base address given to it, then the provider, then the production instance', () => {
    render(<SpriteIcon provider="p" list="l" chainId={1} address={address} baseUrl="https://staging.example" />)
    expect(stylesheetLinks()[0].getAttribute('href')).toMatch(/^https:\/\/staging\.example\/sprite\/p\/l\/sheet\.css/)
  })

  it('uses the provider base address when no base address is given', () => {
    render(
      <GibProvider baseUrl="https://provider.example">
        <SpriteIcon provider="p" list="l" chainId={1} address={address} />
      </GibProvider>,
    )
    expect(stylesheetLinks()[0].getAttribute('href')).toMatch(/^https:\/\/provider\.example\/sprite/)
  })

  it('is hidden from assistive technology without alt text, and named with it', () => {
    const { container, rerender } = render(<SpriteIcon provider="p" list="l" chainId={1} address={address} />)
    expect(container.querySelector('span')!.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('span')!.getAttribute('role')).toBeNull()

    rerender(<SpriteIcon provider="p" list="l" chainId={1} address={address} alt="WBTC" />)
    const named = container.querySelector('span')!
    expect(named.getAttribute('role')).toBe('img')
    expect(named.getAttribute('aria-label')).toBe('WBTC')
    expect(named.getAttribute('aria-hidden')).toBeNull()
  })

  it('merges a caller class and forwards other element props', () => {
    const { container } = render(
      <SpriteIcon provider="p" list="l" chainId={1} address={address} className="logo" title="Wrapped Bitcoin" />,
    )
    const icon = container.querySelector('span')!
    expect(icon.classList.contains('logo')).toBe(true)
    expect(icon.getAttribute('title')).toBe('Wrapped Bitcoin')
  })
})
