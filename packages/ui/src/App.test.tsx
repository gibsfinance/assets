/**
 * The route table — the one place that says which address shows which page.
 *
 * A route dropped during a refactor does not break the build and does not throw at
 * runtime: the router simply matches nothing, and every link pointing at the lost address
 * quietly lands on the catch-all instead. Two of the four entries are lazily loaded, so a
 * broken import shows as an empty page rather than an error, and the redirect kept for the
 * old "wizard" address is invisible until someone follows a stale link. These mount the
 * real application and assert that each declared address still resolves to its page.
 *
 * The router is a hash router, which cannot be swapped from outside the component, so the
 * tests drive it the way a visitor does — by setting the fragment before mounting. Nothing
 * in the component is restructured for the test.
 *
 * Every page underneath reaches for browser features jsdom does not implement
 * (IntersectionObserver for lazy images, ResizeObserver for the measured layouts,
 * matchMedia for the theme) and for the network. All four are stubbed at the host
 * boundary; no application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { App } from './App'
import { queryClient } from './lib/query-client'

/** Answers every request with an empty, well-formed payload. */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: string) => {
      const url = String(input)
      const body = url.includes('openapi.json') ? { paths: {}, tags: [] } : []
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }),
  )
}

function stubBrowserObservers() {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  vi.stubGlobal('ResizeObserver', NoopObserver)
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
}

/**
 * Both heavy pages arrive as separate chunks and mount a large tree once they do, which
 * takes longer than the one-second default when the whole file runs together — and longer
 * still under coverage instrumentation. The wait is generous on purpose: a slow machine
 * must not read as a missing route.
 */
const WAIT = { timeout: 15_000 }

/** Room for that wait plus the mount it is waiting on, above the five-second default. */
const TEST_OPTIONS = { timeout: 25_000 }

/** Mounts the whole application at a fragment, exactly as a pasted link would arrive. */
function visit(fragment: string) {
  window.location.hash = fragment
  return render(<App />)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  stubBrowserObservers()
  stubFetch()
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  window.location.hash = ''
  document.documentElement.classList.remove('dark')
})

describe('App routes', () => {
  it('serves the home page at the root address', TEST_OPTIONS, async () => {
    visit('#/')
    expect(
      await screen.findByText(/A decentralized solution for token metadata and assets/, {}, WAIT),
    ).toBeTruthy()
  })

  it('serves the studio, loaded as its own chunk, at /studio', TEST_OPTIONS, async () => {
    visit('#/studio')
    // The studio is lazy: an import that no longer resolves would leave the Suspense
    // fallback — an entirely blank page — in place forever.
    expect((await screen.findAllByTitle('New List', {}, WAIT)).length).toBeGreaterThan(0)
  })

  it('serves the documentation, also lazily loaded, at /docs', TEST_OPTIONS, async () => {
    visit('#/docs')
    expect(await screen.findByText(/Complete reference for the Gib Assets API/, {}, WAIT)).toBeTruthy()
  })

  it('still honours the retired /wizard address by sending it to the studio', TEST_OPTIONS, async () => {
    // Links to the old name are out in the world and cannot be recalled; dropping the
    // redirect drops every one of them on the not-found page, with no other symptom.
    visit('#/wizard')
    await waitFor(() => expect(window.location.hash).toBe('#/studio'), WAIT)
    expect((await screen.findAllByTitle('New List', {}, WAIT)).length).toBeGreaterThan(0)
  })

  it('replaces the retired address rather than stacking a history entry', TEST_OPTIONS, async () => {
    // A pushed entry would trap the visitor: pressing back re-enters /wizard, which
    // forwards to the studio again, so back never leaves the page.
    const pushed = vi.spyOn(window.history, 'pushState')
    const replaced = vi.spyOn(window.history, 'replaceState')

    visit('#/wizard')
    await waitFor(() => expect(window.location.hash).toBe('#/studio'), WAIT)

    expect(replaced).toHaveBeenCalled()
    expect(pushed).not.toHaveBeenCalled()
  })

  it('answers an address that matches nothing with the not-found page', TEST_OPTIONS, async () => {
    visit('#/no-such-page')
    expect(await screen.findByText('This page does not exist', {}, WAIT)).toBeTruthy()
    // The address is echoed back, which is what tells the visitor it was mistyped rather
    // than that the site failed to load.
    expect(screen.getByText(/no-such-page/)).toBeTruthy()
  })

  it('keeps the site header on the not-found page so the visitor can navigate out', TEST_OPTIONS, async () => {
    // Deliberate: the catch-all sits inside the shared layout. Moving it outside leaves a
    // dead end reachable only by editing the address bar.
    visit('#/no-such-page')
    await screen.findByText('This page does not exist', {}, WAIT)
    // Addresses are fragments here, which is what the hash router requires: a plain path
    // would ask the server for a document it does not serve.
    expect(screen.getByRole('link', { name: 'Gib.Show' }).getAttribute('href')).toBe('#/')
  })

  it('does not fall through to the not-found page on a real route', TEST_OPTIONS, async () => {
    // Guards the catch-all being matched too eagerly, which would hide every page behind
    // it while the application still rendered without error.
    visit('#/docs')
    await screen.findByText(/Complete reference for the Gib Assets API/, {}, WAIT)
    expect(screen.queryByText('This page does not exist')).toBeNull()
  })
})
