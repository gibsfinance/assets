/**
 * The shell every page renders inside.
 *
 * Its one conditional is the header, which is suppressed on the Studio route because the
 * Studio owns the full viewport. That rule is easy to break by adding a route and never
 * noticing the chrome is wrong, so both sides of it are asserted here.
 *
 * ThemeProvider reaches for matchMedia and localStorage, neither meaningfully present in
 * jsdom, so both are stubbed at the host boundary. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { Layout } from './Layout'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { prefetchStudio } from './lib/pages/load-studio'

// The real prefetch would import the whole Studio page. Replaced so each test can say
// which gesture asked for it.
vi.mock('./lib/pages/load-studio', () => ({ prefetchStudio: vi.fn() }))

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.mocked(prefetchStudio).mockClear()
  vi.unstubAllGlobals()
})

const renderAt = (path: string) =>
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<p>home content</p>} />
            <Route path="/studio" element={<p>studio content</p>} />
            <Route path="/docs" element={<p>docs content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )

describe('Layout', () => {
  it('renders the routed page through its outlet', () => {
    renderAt('/')
    expect(screen.getByText('home content')).toBeTruthy()
  })

  it('shows the header and its navigation on an ordinary page', () => {
    renderAt('/')
    expect(screen.getByRole('link', { name: 'Gib.Show' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs')
    expect(screen.getByRole('link', { name: 'Studio' }).getAttribute('href')).toBe('/studio')
  })

  it('hides the header on Studio, which takes the whole viewport', () => {
    renderAt('/studio')
    expect(screen.queryByRole('link', { name: 'Gib.Show' })).toBeNull()
    expect(screen.getByText('studio content')).toBeTruthy()
  })

  it('keeps the header on every other route, so only Studio is special-cased', () => {
    // Guards against the check being widened to a prefix match, which would strip the
    // chrome from anything merely starting with the same letters.
    renderAt('/docs')
    expect(screen.getByRole('link', { name: 'Gib.Show' })).toBeTruthy()
    expect(screen.getByText('docs content')).toBeTruthy()
  })

  describe('fetching the Studio ahead of the click', () => {
    const studioLink = () => screen.getByRole('link', { name: 'Studio' })

    it('starts when the pointer reaches the link', () => {
      renderAt('/')
      fireEvent.pointerEnter(studioLink())
      expect(prefetchStudio).toHaveBeenCalledTimes(1)
    })

    it('starts when the link takes keyboard focus', () => {
      renderAt('/')
      fireEvent.focus(studioLink())
      expect(prefetchStudio).toHaveBeenCalledTimes(1)
    })

    it('starts on pointer down, for touch screens that never hover', () => {
      renderAt('/')
      fireEvent.pointerDown(studioLink())
      expect(prefetchStudio).toHaveBeenCalledTimes(1)
    })

    it('does not start for the other links, which lead nowhere near the Studio', () => {
      renderAt('/')
      fireEvent.pointerEnter(screen.getByRole('link', { name: 'Docs' }))
      fireEvent.focus(screen.getByRole('link', { name: 'Gib.Show' }))
      expect(prefetchStudio).not.toHaveBeenCalled()
    })
  })
})
