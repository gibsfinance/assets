// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderHome } from './entry-server'

describe('renderHome', () => {
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
