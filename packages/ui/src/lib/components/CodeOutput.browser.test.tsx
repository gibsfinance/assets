/**
 * Browser pilot: renders the HTML output of the generator in a real
 * Chromium DOM, then parses the same combo's React-snippet output to
 * prove both channels align.
 *
 * Why two channels in one test:
 *   - The brief asks for "it actually renders in a real engine." The
 *     HTML generator produces a string we can trust the browser to
 *     render verbatim (`innerHTML`) without any eval/transform step.
 *   - The React snippet generator produces JSX — we don't runtime-
 *     transform JSX here (that needs `new Function`, which is a hot
 *     spot). Instead we assert the React snippet string contains the
 *     same attribute values we see in the rendered HTML, giving us
 *     confidence the two stay in sync.
 *
 * Exhaustive parse-correctness coverage lives in
 * `snippet-generators.test.ts` (jsdom project).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { generateHtmlSnippet, generateReactSnippet } from '../utils/snippet-generators'
import type { StudioAppearance, BadgeConfig } from '../types'

const appearance: StudioAppearance = {
  width: 80,
  height: 80,
  shape: 'circle',
  borderRadius: 12,
  padding: 4,
  shadow: 'medium',
  backgroundColor: '#ffffff',
}

const badge: BadgeConfig = {
  enabled: true,
  angleDeg: 135,
  sizeRatio: 0.4,
  overlap: 0.1,
  ringEnabled: true,
  ringColor: '#000000',
  ringThickness: 2,
}

const IMAGE_URL = 'https://gib.show/image/1/0xabc'
const NETWORK_URL = 'https://gib.show/image/1'
const TOKEN_NAME = 'PLS'

describe('CodeOutput — generated snippet (browser / Chromium)', () => {
  afterEach(() => cleanup())

  it('renders the generated HTML into real DOM with the correct token + badge img', () => {
    const html = generateHtmlSnippet(TOKEN_NAME, IMAGE_URL, NETWORK_URL, appearance, badge)

    // `@testing-library/react` mounts a host container and calls render
    // on a React element. We use its `render` here with a component
    // that pipes the generator's HTML string into a real DOM subtree
    // via `dangerouslySetInnerHTML` — Chromium parses it for real.
    const HtmlHost = () => (
      <div data-testid="host" dangerouslySetInnerHTML={{ __html: html }} />
    )
    const { getByTestId } = render(<HtmlHost />)
    const host = getByTestId('host')

    const imgs = host.querySelectorAll('img')
    expect(imgs.length).toBe(2)

    const tokenImg = imgs[0] as HTMLImageElement
    expect(tokenImg.getAttribute('src')).toBe(IMAGE_URL)
    expect(tokenImg.getAttribute('alt')).toBe(TOKEN_NAME)
    // browser computes px-resolved style for inline CSS
    expect(tokenImg.style.width).toBe('80px')
    expect(tokenImg.style.height).toBe('80px')
    expect(tokenImg.style.borderRadius).toBe('50%')

    const badgeImg = imgs[1] as HTMLImageElement
    expect(badgeImg.getAttribute('src')).toBe(NETWORK_URL)
    expect(badgeImg.getAttribute('alt')).toBe('Network')
    expect(badgeImg.style.position).toBe('absolute')
    expect(badgeImg.style.borderRadius).toBe('50%')
    // ringEnabled=true adds a CSS border
    expect(badgeImg.style.borderColor).toBe('rgb(0, 0, 0)')
    expect(badgeImg.style.borderWidth).toBe('2px')

    const wrapper = host.querySelector(':scope > div')
    expect(wrapper).not.toBeNull()
    expect((wrapper as HTMLElement).style.position).toBe('relative')
    expect((wrapper as HTMLElement).style.display).toBe('inline-block')
  })

  it('React snippet carries the same image/network/size/ring values as the HTML snippet', () => {
    // This keeps the two generator outputs in sync without runtime JSX eval.
    const reactSnippet = generateReactSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      appearance,
      badge,
    )
    expect(reactSnippet).toContain(`src="${IMAGE_URL}"`)
    expect(reactSnippet).toContain(`src="${NETWORK_URL}"`)
    expect(reactSnippet).toContain(`alt="${TOKEN_NAME}"`)
    expect(reactSnippet).toContain('alt="Network"')
    expect(reactSnippet).toContain(`width: ${appearance.width}`)
    expect(reactSnippet).toContain(`height: ${appearance.height}`)
    expect(reactSnippet).toContain(
      `border: '${badge.ringThickness}px solid ${badge.ringColor}'`,
    )
  })
})
