/**
 * Theme resolution: how the interface decides whether to render dark.
 *
 * Three inputs feed one boolean — the mode stored from a previous visit, the operating
 * system's colour-scheme preference, and whatever the visitor picks now. Every failure
 * here is silent: a stored preference that is ignored, an operating-system switch that
 * never arrives, or a pinned mode that drifts back to following the system all look like
 * a working page that simply chose the other colour scheme. Nothing throws.
 *
 * jsdom provides no matchMedia, so it is stubbed at the host boundary and the registered
 * listener is captured, letting the tests emit an operating-system change. localStorage is
 * real and cleared between cases. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'

type MediaHandler = (event: { matches: boolean }) => void

/**
 * Answers the prefers-color-scheme query and keeps hold of the change listener the
 * provider registers, so a test can emit an operating-system theme switch and can assert
 * the listener is released on unmount.
 */
function stubMatchMedia(prefersDark: boolean) {
  const handlers = new Set<MediaHandler>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: (_event: string, handler: MediaHandler) => {
        handlers.add(handler)
      },
      removeEventListener: (_event: string, handler: MediaHandler) => {
        handlers.delete(handler)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
  return {
    listenerCount: () => handlers.size,
    emitSystemChange: (matches: boolean) =>
      act(() => {
        for (const handler of handlers) handler({ matches })
      }),
  }
}

/** Surfaces the live context value and offers a way to drive setMode. */
function ThemeProbe() {
  const { isDark, mode, setMode } = useTheme()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="is-dark">{String(isDark)}</span>
      <button type="button" onClick={() => setMode('dark')}>
        pin dark
      </button>
      <button type="button" onClick={() => setMode('light')}>
        pin light
      </button>
      <button type="button" onClick={() => setMode('system')}>
        follow system
      </button>
    </div>
  )
}

const readMode = () => screen.getByTestId('mode').textContent
const readIsDark = () => screen.getByTestId('is-dark').textContent

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider', () => {
  it('honours a stored dark preference over a light operating system', () => {
    localStorage.setItem('theme-mode', 'dark')
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readMode()).toBe('dark')
    expect(readIsDark()).toBe('true')
  })

  it('honours a stored light preference over a dark operating system', () => {
    // The other side of the same rule: a visitor who deliberately chose light must not
    // be overridden by the machine they happen to be sitting at.
    localStorage.setItem('theme-mode', 'light')
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readMode()).toBe('light')
    expect(readIsDark()).toBe('false')
  })

  it('falls back to the operating system when the stored value is not a mode', () => {
    // Guards a rename or a corrupted entry: an unrecognised value must not leave the
    // interface stuck on one scheme.
    localStorage.setItem('theme-mode', 'chartreuse')
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('true')
  })

  it('follows the operating system on a first visit, with nothing stored', () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('false')
  })

  it('applies the dark class to the document so the stylesheet can respond', () => {
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when the resolved theme is light', () => {
    document.documentElement.classList.add('dark')
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('stores a chosen mode, so the next visit opens the same way', () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'pin dark' }))
    expect(localStorage.getItem('theme-mode')).toBe('dark')
    expect(readIsDark()).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows the operating system switching to dark while in system mode', () => {
    const media = stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readIsDark()).toBe('false')
    media.emitSystemChange(true)
    expect(readIsDark()).toBe('true')
  })

  it('ignores operating system changes once a mode is pinned', () => {
    // The whole point of pinning: the machine going dark at sunset must not undo an
    // explicit choice of light.
    const media = stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'pin light' }))
    media.emitSystemChange(true)
    expect(readIsDark()).toBe('false')
    expect(readMode()).toBe('light')
  })

  it('picks the operating system preference back up when told to follow it again', () => {
    localStorage.setItem('theme-mode', 'light')
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(readIsDark()).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'follow system' }))
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('true')
  })

  it('releases the operating system listener on unmount', () => {
    // A leaked listener writes state into a torn-down tree on the next theme change.
    const media = stubMatchMedia(false)
    const view = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(media.listenerCount()).toBe(1)
    view.unmount()
    expect(media.listenerCount()).toBe(0)
  })
})

describe('useTheme outside a provider', () => {
  it('reports a light, system-following theme and a harmless setter', () => {
    // Consumers rendered in isolation — a detached modal, a test harness — must not
    // crash; they get the neutral default instead.
    stubMatchMedia(true)
    render(<ThemeProbe />)
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('false')
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'pin dark' }))).not.toThrow()
    expect(localStorage.getItem('theme-mode')).toBeNull()
  })
})
