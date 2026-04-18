/**
 * Parse-validation tests for the snippet generators.
 *
 * Why: the generators emit strings users paste into real apps. A stray
 * comma, unclosed tag, or unescaped quote would compile fine in the
 * Studio (it's just a string) but break in the user's editor. These
 * tests run every code-path combination through a real parser.
 *
 * Strategy:
 *   - React / SDK / component output -> wrap in a parseable module and
 *     feed to `@babel/parser` (sourceType: module, plugins: jsx + ts).
 *   - HTML output -> feed to jsdom and assert expected elements exist
 *     with the expected attribute values.
 */
import { describe, it, expect } from 'vitest'
import { parse } from '@babel/parser'
import { JSDOM } from 'jsdom'
import type { StudioAppearance, BadgeConfig } from '../types'
import {
  generateSdkSnippet,
  generateReactSnippet,
  generateReactComponent,
  generateHtmlSnippet,
  generateImgTag,
} from './snippet-generators'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHAPES: StudioAppearance['shape'][] = ['circle', 'rounded', 'square']
const SHADOWS: StudioAppearance['shadow'][] = ['none', 'subtle', 'medium', 'strong']
const PADDINGS: number[] = [0, 8]
const BACKGROUNDS: string[] = ['transparent', '#ffffff']
const BADGE_ENABLED: boolean[] = [false, true]
const RING_ENABLED: boolean[] = [false, true]

const IMAGE_URL = 'https://gib.show/image/1/0xabc'
const NETWORK_URL = 'https://gib.show/image/1'
const TOKEN_NAME = 'Token'
const CHAIN_ID = '1'
const ADDRESS = '0x0000000000000000000000000000000000000000'

/** Build an appearance from a small config. */
const buildAppearance = (options: {
  shape: StudioAppearance['shape']
  shadow: StudioAppearance['shadow']
  padding: number
  background: string
}): StudioAppearance => ({
  width: 64,
  height: 64,
  shape: options.shape,
  borderRadius: 12,
  padding: options.padding,
  shadow: options.shadow,
  backgroundColor: options.background,
})

/** Build a badge config from a small config. */
const buildBadge = (options: { enabled: boolean; ringEnabled: boolean }): BadgeConfig => ({
  enabled: options.enabled,
  angleDeg: 135,
  sizeRatio: 0.4,
  overlap: 0.1,
  ringEnabled: options.ringEnabled,
  ringColor: '#ffffff',
  ringThickness: 2,
})

/** Parse a JSX snippet by wrapping it in an assignment. */
const parseJsxSnippet = (code: string): void => {
  const wrapped = `const __snippet = (\n${code}\n)\n`
  parse(wrapped, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  })
}

/** Parse a complete module (SDK snippet, full component). */
const parseModule = (code: string): void => {
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    // SDK snippet contains a top-level JSX expression alongside an
    // import — valid in scripts that allow top-level expressions.
    allowImportExportEverywhere: true,
  })
}

/** Parse an HTML fragment with jsdom. */
const parseHtml = (html: string): Document => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return dom.window.document
}

// ---------------------------------------------------------------------------
// Cartesian product of all relevant combinations
// ---------------------------------------------------------------------------

interface Combo {
  appearance: StudioAppearance
  badge: BadgeConfig
  label: string
}

const allCombos: Combo[] = []
for (const shape of SHAPES) {
  for (const shadow of SHADOWS) {
    for (const padding of PADDINGS) {
      for (const background of BACKGROUNDS) {
        for (const enabled of BADGE_ENABLED) {
          for (const ringEnabled of RING_ENABLED) {
            if (!enabled && ringEnabled) continue // ring only matters when badge on
            allCombos.push({
              appearance: buildAppearance({ shape, shadow, padding, background }),
              badge: buildBadge({ enabled, ringEnabled }),
              label: `shape=${shape} shadow=${shadow} padding=${padding} bg=${background === 'transparent' ? 'transparent' : 'solid'} badge=${enabled ? (ringEnabled ? 'ring' : 'plain') : 'off'}`,
            })
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// generateSdkSnippet
// ---------------------------------------------------------------------------

describe('generateSdkSnippet', () => {
  for (const shape of SHAPES) {
    it(`parses as a valid module (shape=${shape})`, () => {
      const appearance = buildAppearance({
        shape,
        shadow: 'none',
        padding: 0,
        background: 'transparent',
      })
      const code = generateSdkSnippet(CHAIN_ID, ADDRESS, appearance)
      expect(() => parseModule(code)).not.toThrow()
      expect(code).toContain('GibProvider')
      expect(code).toContain('TokenImage')
      expect(code).toContain(`chainId={${CHAIN_ID}}`)
      expect(code).toContain(`address="${ADDRESS}"`)
    })
  }

  it('includes shape="square" only for square shape', () => {
    const squareCode = generateSdkSnippet(
      CHAIN_ID,
      ADDRESS,
      buildAppearance({ shape: 'square', shadow: 'none', padding: 0, background: 'transparent' }),
    )
    expect(squareCode).toContain('shape="square"')

    const circleCode = generateSdkSnippet(
      CHAIN_ID,
      ADDRESS,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
    )
    expect(circleCode).not.toContain('shape="square"')
  })
})

// ---------------------------------------------------------------------------
// generateReactSnippet
// ---------------------------------------------------------------------------

describe('generateReactSnippet', () => {
  for (const combo of allCombos) {
    it(`parses as valid JSX: ${combo.label}`, () => {
      const code = generateReactSnippet(
        TOKEN_NAME,
        IMAGE_URL,
        NETWORK_URL,
        combo.appearance,
        combo.badge,
      )
      expect(() => parseJsxSnippet(code)).not.toThrow()
      expect(code).toContain(IMAGE_URL)
      expect(code).toContain(`alt="${TOKEN_NAME}"`)
      if (combo.badge.enabled) {
        expect(code).toContain(NETWORK_URL)
        expect(code).toContain('alt="Network"')
      }
    })
  }

  it('emits a bare <img> when no wrapper is needed', () => {
    const code = generateReactSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(code.startsWith('<img')).toBe(true)
    expect(code).not.toContain('<div')
  })

  it('wraps in a <div> when padding > 0 but no badge', () => {
    const code = generateReactSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 8, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(code.startsWith('<div')).toBe(true)
    expect(code).toContain('padding: 8')
  })

  it('includes ring border only when ringEnabled is true', () => {
    const withRing = generateReactSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: true, ringEnabled: true }),
    )
    expect(withRing).toMatch(/border: '\d+px solid #ffffff'/)

    const withoutRing = generateReactSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: true, ringEnabled: false }),
    )
    expect(withoutRing).not.toMatch(/border: '\d+px solid/)
  })
})

// ---------------------------------------------------------------------------
// generateReactComponent
// ---------------------------------------------------------------------------

describe('generateReactComponent', () => {
  for (const combo of allCombos) {
    it(`parses as a valid module: ${combo.label}`, () => {
      const code = generateReactComponent(
        TOKEN_NAME,
        IMAGE_URL,
        NETWORK_URL,
        combo.appearance,
        combo.badge,
      )
      expect(() => parseModule(code)).not.toThrow()
      expect(code).toContain('export default function GibToken')
      expect(code).toContain(`src = '${IMAGE_URL}'`)
      expect(code).toContain(`alt = '${TOKEN_NAME}'`)
      if (combo.badge.enabled) {
        expect(code).toContain('badge?: boolean')
        expect(code).toContain('badgeAngle?: number')
      }
    })
  }

  it('omits badge props when badge is disabled', () => {
    const code = generateReactComponent(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(code).not.toContain('badge?:')
    expect(code).not.toContain('badgeAngle?:')
  })

  it('adds shadow prop only when shadow !== none', () => {
    const withShadow = generateReactComponent(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'medium', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(withShadow).toContain('shadow?: boolean')
    expect(withShadow).toContain("boxShadow:")

    const withoutShadow = generateReactComponent(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(withoutShadow).not.toContain('shadow?:')
    expect(withoutShadow).not.toContain('boxShadow:')
  })
})

// ---------------------------------------------------------------------------
// generateHtmlSnippet
// ---------------------------------------------------------------------------

describe('generateHtmlSnippet', () => {
  for (const combo of allCombos) {
    it(`produces valid HTML: ${combo.label}`, () => {
      const html = generateHtmlSnippet(
        TOKEN_NAME,
        IMAGE_URL,
        NETWORK_URL,
        combo.appearance,
        combo.badge,
      )
      const doc = parseHtml(html)

      const imgs = doc.querySelectorAll('img')
      const expectedImgCount = combo.badge.enabled ? 2 : 1
      expect(imgs.length).toBe(expectedImgCount)

      const tokenImg = imgs[0]
      expect(tokenImg.getAttribute('src')).toBe(IMAGE_URL)
      expect(tokenImg.getAttribute('alt')).toBe(TOKEN_NAME)

      if (combo.badge.enabled) {
        const badgeImg = imgs[1]
        expect(badgeImg.getAttribute('src')).toBe(NETWORK_URL)
        expect(badgeImg.getAttribute('alt')).toBe('Network')
      }

      const needsWrapper =
        combo.badge.enabled ||
        combo.appearance.padding > 0 ||
        combo.appearance.shadow !== 'none' ||
        combo.appearance.backgroundColor !== 'transparent'

      const wrapper = doc.querySelector('body > div')
      if (needsWrapper) {
        expect(wrapper).not.toBeNull()
      } else {
        expect(wrapper).toBeNull()
      }
    })
  }

  it('emits background-color when not transparent', () => {
    const html = generateHtmlSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: '#112233' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(html).toContain('background: #112233')
  })

  it('omits background-color when transparent', () => {
    const html = generateHtmlSnippet(
      TOKEN_NAME,
      IMAGE_URL,
      NETWORK_URL,
      buildAppearance({ shape: 'circle', shadow: 'medium', padding: 0, background: 'transparent' }),
      buildBadge({ enabled: false, ringEnabled: false }),
    )
    expect(html).not.toContain('background:')
  })
})

// ---------------------------------------------------------------------------
// generateImgTag
// ---------------------------------------------------------------------------

describe('generateImgTag', () => {
  for (const shape of SHAPES) {
    it(`produces a single valid <img> tag (shape=${shape})`, () => {
      const html = generateImgTag(
        TOKEN_NAME,
        IMAGE_URL,
        buildAppearance({ shape, shadow: 'none', padding: 0, background: 'transparent' }),
      )
      const doc = parseHtml(html)
      const imgs = doc.querySelectorAll('img')
      expect(imgs.length).toBe(1)
      const img = imgs[0]
      expect(img.getAttribute('src')).toBe(IMAGE_URL)
      expect(img.getAttribute('alt')).toBe(TOKEN_NAME)
      expect(img.getAttribute('width')).toBe('64')
      expect(img.getAttribute('height')).toBe('64')
      expect(img.getAttribute('style')).toContain('border-radius')
    })
  }

  it('uses 50% border-radius for circle', () => {
    const html = generateImgTag(
      TOKEN_NAME,
      IMAGE_URL,
      buildAppearance({ shape: 'circle', shadow: 'none', padding: 0, background: 'transparent' }),
    )
    expect(html).toContain('border-radius: 50%')
  })

  it('uses 0 border-radius for square', () => {
    const html = generateImgTag(
      TOKEN_NAME,
      IMAGE_URL,
      buildAppearance({ shape: 'square', shadow: 'none', padding: 0, background: 'transparent' }),
    )
    expect(html).toContain('border-radius: 0')
  })
})
