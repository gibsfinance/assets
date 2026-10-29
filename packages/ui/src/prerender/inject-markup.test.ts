import { describe, it, expect } from 'vitest'
import { injectMarkup, MARKUP_PLACEHOLDER, THEME_PLACEHOLDER, GUARD_PLACEHOLDER } from './inject-markup'

const parts = { markup: '<h1>$&Home</h1>', themeScript: 'T()', routeGuardScript: 'G()' }
const shell = `<head>${THEME_PLACEHOLDER}</head><body><div id="app">${MARKUP_PLACEHOLDER}</div>${GUARD_PLACEHOLDER}</body>`

describe('injectMarkup', () => {
  it('puts the markup inside the root and each script in its slot, without expanding $ patterns', () => {
    const html = injectMarkup(shell, parts)
    expect(html).toContain('<div id="app"><h1>$&Home</h1></div>')
    expect(html).toContain('<head><script>T()</script></head>')
    expect(html).toContain('</div><script>G()</script></body>')
  })

  it.each([MARKUP_PLACEHOLDER, THEME_PLACEHOLDER, GUARD_PLACEHOLDER])('throws when %s is missing', (placeholder) => {
    expect(() => injectMarkup(shell.replace(placeholder, ''), parts)).toThrow(placeholder)
  })
})
