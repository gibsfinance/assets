/**
 * CodeBlock renders highlighted source once Shiki has loaded, and a plain
 * `<pre><code>` fallback before that and on the server.
 *
 * Shiki is several hundred kilobytes, so it loads once in the background
 * behind a module-level singleton every CodeBlock instance subscribes to.
 * This file mocks Shiki's pieces so the singleton resolves on demand and the
 * resulting highlighted markup can be inspected, instead of only ever seeing
 * the plain-text fallback the way other test files touching CodeBlock do.
 *
 * `renderToString` drives the server-snapshot path directly: React calls a
 * component's `getServerSnapshot` function, not its `subscribe` function,
 * when rendering outside the browser, so this is the only way to reach it.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import CodeBlock from './CodeBlock'
import { ThemeProvider } from '../contexts/ThemeContext'

vi.mock('shiki/core', () => ({
  createHighlighterCoreSync: vi.fn(() => ({
    codeToHtml: (code: string, options: { lang: string; theme: string }) =>
      `<pre data-theme="${options.theme}" data-lang="${options.lang}"><code>${code}</code></pre>`,
  })),
}))
vi.mock('shiki/engine/javascript', () => ({ createJavaScriptRegexEngine: vi.fn(() => ({})) }))
vi.mock('shiki/themes/dark-plus.mjs', () => ({ default: { name: 'dark-plus' } }))
vi.mock('shiki/themes/light-plus.mjs', () => ({ default: { name: 'light-plus' } }))
vi.mock('shiki/langs/console.mjs', () => ({ default: { name: 'console' } }))
vi.mock('shiki/langs/html.mjs', () => ({ default: { name: 'html' } }))
vi.mock('shiki/langs/css.mjs', () => ({ default: { name: 'css' } }))
vi.mock('shiki/langs/javascript.mjs', () => ({ default: { name: 'javascript' } }))

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

/** The highlighted markup Shiki produces, once the background load resolves. */
function highlightedPre(): HTMLElement | null {
  return document.querySelector('pre[data-theme]')
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('server rendering', () => {
  // React calls getServerSnapshot, not subscribe, while rendering on the
  // server. If that function threw or returned something truthy, a
  // server-rendered page would either crash or wait forever on markup Shiki
  // never gets a chance to produce outside the browser.
  it('falls back to the plain-text block instead of waiting for Shiki, so a server render never crashes', () => {
    const html = renderToString(<CodeBlock code="const value = 1" />)
    expect(html).toContain('const value = 1')
    expect(html).toContain('<pre')
    expect(html).not.toContain('data-theme')
  })
})

describe('theme resolution', () => {
  // The background load is asynchronous and shared across every CodeBlock in
  // the page, so the first assertion just waits for it once and the rest of
  // this file's tests reuse the now-loaded singleton.
  beforeAll(async () => {
    stubMatchMedia(false)
    render(<CodeBlock code="warm up the shared highlighter" />)
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
    cleanup()
    vi.unstubAllGlobals()
  })

  // An explicit theme prop must win even when the visitor's resolved theme is
  // light. Losing this would make an embed that pins dark mode (for example
  // a code sample on a page with a fixed dark background) flip to light the
  // moment a visitor's system preference changes.
  it('keeps the requested theme even when the resolved site theme is light', async () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <CodeBlock code="pinned dark sample" theme="dark-plus" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
    expect(highlightedPre()?.dataset.theme).toBe('dark-plus')
  })

  // With no explicit theme, the block must follow the site theme so a page
  // in dark mode never shows a code sample rendered for a light background.
  it('follows the site theme to dark when no explicit theme is requested', async () => {
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <CodeBlock code="dark site theme" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
    expect(highlightedPre()?.dataset.theme).toBe('dark-plus')
  })

  // And it must follow the site theme to light too — otherwise the branch
  // above could be "always dark" and this file would never notice.
  it('follows the site theme to light when no explicit theme is requested', async () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <CodeBlock code="light site theme" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
    expect(highlightedPre()?.dataset.theme).toBe('light-plus')
  })
})

describe('fallback rendering before Shiki has produced markup', () => {
  it('shows the code as plain text so nothing is hidden while highlighting is unavailable', () => {
    // A fresh assertion against the raw fallback markup, independent of the
    // shared singleton's load state: the exact text must always be present.
    render(<CodeBlock code="fallback readable text" />)
    expect(screen.getByText('fallback readable text')).toBeTruthy()
  })
})
