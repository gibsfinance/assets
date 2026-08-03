// @vitest-environment node
/**
 * ThemeProvider rendered where there is no browser.
 *
 * The provider reads matchMedia and localStorage while computing its initial state, both
 * of which exist only in a browser. Two guards handle their absence, and neither can be
 * reached from a test that runs in a simulated browser — the sibling ThemeContext.test.tsx
 * always has a window. Rendering to a string in a plain node environment is the only way
 * to exercise them, and it is also the situation they exist for: any pre-render of the
 * markup, or any consumer importing this provider outside a browser, throws a bare
 * "localStorage is not defined" the moment a guard is dropped.
 *
 * The fallback contract is light and system-following: without a machine to ask, the
 * provider must not guess dark and must not claim the visitor chose anything.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider, useTheme } from './ThemeContext'

function ThemeProbe() {
  const { isDark, mode } = useTheme()
  return (
    <span>
      {mode}:{String(isDark)}
    </span>
  )
}

describe('ThemeProvider without a browser', () => {
  it('renders instead of throwing on the missing browser globals', () => {
    expect(() =>
      renderToStaticMarkup(
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>,
      ),
    ).not.toThrow()
  })

  it('falls back to a light, system-following theme with nothing to read', () => {
    const markup = renderToStaticMarkup(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(markup).toContain('system:false')
  })
})
