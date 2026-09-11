// @vitest-environment node
/**
 * BottomDrawer rendered where there is no browser.
 *
 * The drawer reads window.innerHeight while computing its starting viewport height, and a
 * browser is not always present when a component first renders — the sibling
 * BottomDrawer.component.test.tsx always has a window, so it cannot reach this guard. This
 * file renders in a plain node environment, the only place the fallback runs. Losing it
 * would throw a bare "window is not defined" the moment anything renders this drawer
 * outside a browser, matching the same guard already proven on ThemeContext.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BottomDrawer, { COLLAPSED_HEIGHT } from './BottomDrawer'

describe('BottomDrawer without a browser', () => {
  it('renders instead of throwing on the missing window global', () => {
    expect(() =>
      renderToStaticMarkup(
        <BottomDrawer>
          <div>Content</div>
        </BottomDrawer>,
      ),
    ).not.toThrow()
  })

  it('falls back to an eight hundred pixel viewport height with nothing to read', () => {
    // Starting collapsed, the drawer sits at viewportHeight minus the collapsed handle
    // height. Seeing that exact figure in the markup proves the fallback height was used,
    // not just that nothing crashed.
    const markup = renderToStaticMarkup(
      <BottomDrawer>
        <div>Content</div>
      </BottomDrawer>,
    )
    const fallbackViewportHeight = 800
    expect(markup).toContain(`translateY(${fallbackViewportHeight - COLLAPSED_HEIGHT}px)`)
  })
})
