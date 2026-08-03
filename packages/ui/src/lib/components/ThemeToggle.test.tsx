/**
 * The two-button theme control in the site header.
 *
 * The left button flips between light and dark; the right button attaches the interface to
 * the operating system preference or detaches it. The subtle rule is what detaching does:
 * leaving system mode must pin whatever is on screen right now, not jump to the opposite
 * scheme. Getting that backwards makes the button look like a theme flip, and nothing
 * fails — the page simply changes colour when the visitor asked it to stop changing.
 *
 * Rendered against the real ThemeProvider so the assertions run on resolved theme state
 * rather than on a spy. jsdom has no matchMedia, so it is stubbed at the host boundary,
 * and localStorage is cleared between cases because the provider reads it on mount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { ThemeProvider, useTheme } from '../contexts/ThemeContext'

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

/** Reports the resolved theme state the toggle is writing into. */
function ThemeProbe() {
  const { isDark, mode } = useTheme()
  return (
    <>
      <span data-testid="mode">{mode}</span>
      <span data-testid="is-dark">{String(isDark)}</span>
    </>
  )
}

function renderToggle() {
  render(
    <ThemeProvider>
      <ThemeToggle />
      <ThemeProbe />
    </ThemeProvider>,
  )
  const [themeButton, systemButton] = screen.getAllByRole('button')
  return { themeButton, systemButton }
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

describe('ThemeToggle', () => {
  it('turns a light interface dark', () => {
    stubMatchMedia(false)
    const { themeButton } = renderToggle()
    fireEvent.click(themeButton)
    expect(readMode()).toBe('dark')
    expect(readIsDark()).toBe('true')
  })

  it('turns a dark interface light', () => {
    localStorage.setItem('theme-mode', 'dark')
    stubMatchMedia(false)
    const { themeButton } = renderToggle()
    fireEvent.click(themeButton)
    expect(readMode()).toBe('light')
    expect(readIsDark()).toBe('false')
  })

  it('flips away from the resolved theme, not the stored mode, while following the system', () => {
    // In system mode there is no stored light/dark to invert. The button has to read what
    // is actually on screen, or pressing it on a dark machine would ask for dark again and
    // appear to do nothing.
    stubMatchMedia(true)
    const { themeButton } = renderToggle()
    expect(readIsDark()).toBe('true')
    fireEvent.click(themeButton)
    expect(readMode()).toBe('light')
    expect(readIsDark()).toBe('false')
  })

  it('pins the appearance already on screen when leaving system mode', () => {
    // Detaching from the system must not change a single pixel — it only stops future
    // operating system changes from reaching the page.
    stubMatchMedia(true)
    const { systemButton } = renderToggle()
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('true')
    fireEvent.click(systemButton)
    expect(readMode()).toBe('dark')
    expect(readIsDark()).toBe('true')
  })

  it('pins light when leaving system mode on a light machine', () => {
    stubMatchMedia(false)
    const { systemButton } = renderToggle()
    fireEvent.click(systemButton)
    expect(readMode()).toBe('light')
    expect(readIsDark()).toBe('false')
  })

  it('hands control back to the operating system when pressed while pinned', () => {
    localStorage.setItem('theme-mode', 'light')
    stubMatchMedia(true)
    const { systemButton } = renderToggle()
    expect(readIsDark()).toBe('false')
    fireEvent.click(systemButton)
    expect(readMode()).toBe('system')
    expect(readIsDark()).toBe('true')
  })

  it('describes what each button will do, since neither carries a text label', () => {
    // Both controls are icon-only, so the title attribute is the whole accessible
    // description — a stale one is the only thing a visitor has to go on.
    stubMatchMedia(false)
    const { themeButton, systemButton } = renderToggle()
    expect(themeButton.getAttribute('title')).toBe('Switch to dark mode')
    expect(systemButton.getAttribute('title')).toBe('Using system theme')

    fireEvent.click(themeButton)
    expect(themeButton.getAttribute('title')).toBe('Switch to light mode')
    expect(systemButton.getAttribute('title')).toBe('Use system theme')
  })
})
