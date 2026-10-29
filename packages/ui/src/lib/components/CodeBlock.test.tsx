/**
 * CodeBlock renders highlighted source once Shiki has loaded, and a plain
 * `<pre><code>` fallback before that and on the server.
 *
 * Shiki is several hundred kilobytes, so it loads once, only after a block
 * comes near the viewport, behind a module-level singleton every CodeBlock
 * instance subscribes to. The singleton lives for the whole file, so the
 * tests run in order: those that need it unloaded come first.
 * This file mocks Shiki's pieces so the singleton resolves on demand and the
 * resulting highlighted markup can be inspected, instead of only ever seeing
 * the plain-text fallback the way other test files touching CodeBlock do.
 *
 * `renderToString` drives the server-snapshot path directly: React calls a
 * component's `getServerSnapshot` function, not its `subscribe` function,
 * when rendering outside the browser, so this is the only way to reach it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import CodeBlock from './CodeBlock'
import { ThemeProvider } from '../contexts/ThemeContext'

const { createHighlighterSpy } = vi.hoisted(() => ({ createHighlighterSpy: vi.fn() }))

vi.mock('shiki/core', () => ({
  createHighlighterCoreSync: createHighlighterSpy,
}))
vi.mock('shiki/engine/javascript', () => ({ createJavaScriptRegexEngine: vi.fn(() => ({})) }))
vi.mock('shiki/themes/dark-plus.mjs', () => ({ default: { name: 'dark-plus' } }))
vi.mock('shiki/themes/light-plus.mjs', () => ({ default: { name: 'light-plus' } }))
vi.mock('shiki/langs/console.mjs', () => ({ default: { name: 'console' } }))
vi.mock('shiki/langs/html.mjs', () => ({ default: { name: 'html' } }))
vi.mock('shiki/langs/css.mjs', () => ({ default: { name: 'css' } }))
vi.mock('shiki/langs/javascript.mjs', () => ({ default: { name: 'javascript' } }))

const fakeHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) =>
    `<pre data-theme="${options.theme}" data-lang="${options.lang}"><code>${code}</code></pre>`,
}

/** Observers created by blocks, so a test can decide when each one reports. */
let observers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit }> = []
/** Idle callbacks waiting for the browser to be idle. */
let idleQueue: Array<() => void> = []

class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observers.push({ callback, options })
  }
  observe = vi.fn()
  disconnect = vi.fn()
}

function stubBrowserScheduling() {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => idleQueue.push(callback))
  vi.stubGlobal('cancelIdleCallback', vi.fn())
}

/** Report that every observed block is near the viewport. */
function intersectAll() {
  act(() => {
    observers.forEach(({ callback }) =>
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
    )
  })
}

/** Let the browser run everything queued for idle time. */
async function flushIdle() {
  await act(async () => {
    idleQueue.splice(0).forEach((run) => run())
  })
}

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

beforeEach(() => {
  observers = []
  idleQueue = []
  createHighlighterSpy.mockReset()
  createHighlighterSpy.mockReturnValue(fakeHighlighter)
  stubBrowserScheduling()
})

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

describe('deferred loading', () => {
  // The home page renders code blocks. Loading Shiki at mount cost it a run
  // of long frames right after first paint, so a block that is never near the
  // viewport must never pay for it.
  it('shows plain text and loads nothing until the block is near the viewport', async () => {
    render(<CodeBlock code="plain before near" />)
    expect(screen.getByText('plain before near')).toBeTruthy()
    expect(highlightedPre()).toBeNull()

    await flushIdle()
    expect(createHighlighterSpy).not.toHaveBeenCalled()
    expect(highlightedPre()).toBeNull()
  })

  it('watches with a margin so highlighting starts before the block scrolls into view', () => {
    render(<CodeBlock code="margin" />)
    expect(observers).toHaveLength(1)
    expect(observers[0].options?.rootMargin).toBe('200px')
  })

  // Being near is not enough: the work has to wait for idle time, or the
  // download-and-run would block the scroll that brought the block near.
  // Several blocks on one page must share a single load.
  it('waits for idle time, then loads once for every block on the page', async () => {
    render(
      <>
        <CodeBlock code="first block" />
        <CodeBlock code="second block" />
        <CodeBlock code="third block" />
      </>,
    )
    intersectAll()
    expect(idleQueue.length).toBeGreaterThan(0)
    expect(createHighlighterSpy).not.toHaveBeenCalled()

    await flushIdle()
    await waitFor(() => expect(document.querySelectorAll('pre[data-theme]')).toHaveLength(3))
    expect(createHighlighterSpy).toHaveBeenCalledTimes(1)
  })

  it('schedules no work for a block the observer reports as still far away', () => {
    render(<CodeBlock code="far away" />)
    act(() => {
      observers[0].callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(idleQueue).toHaveLength(0)
  })
})

describe('replacing plain text with highlighted markup', () => {
  it('keeps the same wrapper element, so the box does not change when highlighting lands', async () => {
    const { container } = render(<CodeBlock code="same box" prePadding="px-4" />)
    const wrapper = container.firstElementChild as HTMLElement
    const classBefore = wrapper.className
    intersectAll()
    await flushIdle()
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
    expect(container.firstElementChild).toBe(wrapper)
    expect(wrapper.className).toBe(classBefore)
  })
})

describe('theme resolution', () => {
  async function renderHighlighted(element: React.ReactElement) {
    render(element)
    intersectAll()
    await flushIdle()
    await waitFor(() => expect(highlightedPre()).not.toBeNull())
  }

  // An explicit theme prop must win even when the visitor's resolved theme is
  // light. Losing this would make an embed that pins dark mode (for example
  // a code sample on a page with a fixed dark background) flip to light the
  // moment a visitor's system preference changes.
  it('keeps the requested theme even when the resolved site theme is light', async () => {
    stubMatchMedia(false)
    await renderHighlighted(
      <ThemeProvider>
        <CodeBlock code="pinned dark sample" theme="dark-plus" />
      </ThemeProvider>,
    )
    expect(highlightedPre()?.dataset.theme).toBe('dark-plus')
  })

  // With no explicit theme, the block must follow the site theme so a page
  // in dark mode never shows a code sample rendered for a light background.
  it('follows the site theme to dark when no explicit theme is requested', async () => {
    stubMatchMedia(true)
    await renderHighlighted(
      <ThemeProvider>
        <CodeBlock code="dark site theme" />
      </ThemeProvider>,
    )
    expect(highlightedPre()?.dataset.theme).toBe('dark-plus')
  })

  // And it must follow the site theme to light too, otherwise the branch
  // above could be "always dark" and this file would never notice.
  it('follows the site theme to light when no explicit theme is requested', async () => {
    stubMatchMedia(false)
    await renderHighlighted(
      <ThemeProvider>
        <CodeBlock code="light site theme" />
      </ThemeProvider>,
    )
    expect(highlightedPre()?.dataset.theme).toBe('light-plus')
  })
})
