/**
 * The "powered by" row of data-provider logos.
 *
 * Its only branch is the logo path: providers shipped as local assets have a light and a
 * dark variant chosen from the active theme, while providers giving an absolute URL are
 * used verbatim. Getting that wrong shows dark logos on a dark background — invisible
 * rather than broken, so nothing would fail loudly.
 *
 * ThemeProvider needs matchMedia and localStorage, and the logos are lazy so Image
 * reaches for IntersectionObserver. All three are stubbed at the host boundary — jsdom
 * supplies none of them — so the real provider and the real Image component are
 * exercised rather than mocked away.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Attribution from './Attribution'
import { ThemeProvider } from '../contexts/ThemeContext'
import { attributionProviders } from '../attribution-providers'

/** Drives the theme by answering the prefers-color-scheme query. */
function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
}

/**
 * Reports every observed element as already on screen, so the lazy logos resolve to real
 * img elements. Attribution renders a short static row that is visible on load anyway —
 * deferring here would only hide the src attribute these tests are about.
 */
function stubIntersectionObserver() {
  class ImmediateObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }])
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', ImmediateObserver)
}

beforeEach(() => {
  localStorage.clear()
  stubIntersectionObserver()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const renderAttribution = () =>
  render(
    <ThemeProvider>
      <Attribution />
    </ThemeProvider>,
  )

describe('Attribution', () => {
  it('links out to every provider it credits', () => {
    stubMatchMedia(false)
    renderAttribution()
    for (const provider of attributionProviders) {
      const link = screen.getByTitle(provider.name)
      expect(link.getAttribute('href')).toBe(provider.link)
    }
  })

  it('opens provider links in a new tab without leaking the referrer', () => {
    stubMatchMedia(false)
    renderAttribution()
    const link = screen.getByTitle(attributionProviders[0].name)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('serves the light logo variant under the light theme', () => {
    stubMatchMedia(false)
    renderAttribution()
    const local = attributionProviders.find((p) => !p.imageUrl.startsWith('http'))!
    const img = screen.getByAltText(local.name)
    expect(img.getAttribute('src')).toContain(`/logos/light/${local.imageUrl}`)
  })

  it('serves the dark logo variant under the dark theme', () => {
    // The failure this prevents is silent: a light-on-transparent logo rendered against
    // the dark surface simply disappears.
    stubMatchMedia(true)
    renderAttribution()
    const local = attributionProviders.find((p) => !p.imageUrl.startsWith('http'))!
    const img = screen.getByAltText(local.name)
    expect(img.getAttribute('src')).toContain(`/logos/dark/${local.imageUrl}`)
  })

  it('uses an absolute provider logo exactly as given, with no theme folder', () => {
    stubMatchMedia(true)
    const remote = attributionProviders.find((p) => p.imageUrl.startsWith('http'))
    if (!remote) return
    renderAttribution()
    const img = screen.getByAltText(remote.name)
    expect(img.getAttribute('src')).not.toContain('/logos/')
  })

  it('labels the section so the logos are not a bare unexplained row', () => {
    stubMatchMedia(false)
    renderAttribution()
    expect(screen.getByText('Powered by')).toBeTruthy()
  })
})
