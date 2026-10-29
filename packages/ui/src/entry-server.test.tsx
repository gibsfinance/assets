// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHome } from './entry-server'

afterEach(() => {
  vi.useRealTimers()
})

describe('renderHome', () => {
  // The build imports this module and renders once. A timer left behind keeps the
  // build process alive: React Query's hour-long garbage collection timers held
  // every build open for an hour after it finished.
  it('leaves no timer running, so the build process can exit', () => {
    vi.useFakeTimers()
    renderHome()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders the site header and the home heading with no browser present', () => {
    const markup = renderHome()
    expect(markup.length).toBeGreaterThan(1000)
    expect(markup).toContain('Gib.Show')
    expect(markup).toContain('<h1')
  })

  it('renders fully on the server instead of falling back to client rendering', () => {
    // React marks a boundary that errored with `<!--$!-->`, and the page would paint empty.
    expect(renderHome()).not.toContain('<!--$!-->')
  })

  it('renders the home route, not the not-found page', () => {
    expect(renderHome()).not.toMatch(/not found/i)
  })
})
