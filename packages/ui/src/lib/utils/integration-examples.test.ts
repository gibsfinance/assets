import { describe, it, expect } from 'vitest'
import { spriteClassName, spriteScopeClassName } from '../../../../sdk/src/sprite-layout'
import {
  IMAGE_OPTION_DARK_LOGO_PATH,
  IMAGE_OPTION_SUBJECT_PATH,
  IMAGE_OPTION_TILES,
  SPRITE_MANIFEST_PATH,
  SPRITE_SAMPLE_TOKEN_CLASS,
  SPRITE_SCOPE_CLASS,
  SPRITE_SHEET_PATH,
  SPRITE_STYLESHEET_PATH,
  spriteSnippet,
} from './integration-examples'

const tileByKey = (key: string) => {
  const tile = IMAGE_OPTION_TILES.find((candidate) => candidate.key === key)
  if (!tile) throw new Error(`no tile named ${key}`)
  return tile
}

describe('IMAGE_OPTION_TILES', () => {
  it('shows the four options the card explains, each with its exact address', () => {
    expect(IMAGE_OPTION_TILES.flatMap((tile) => tile.samples.map((sample) => sample.path))).toEqual([
      '/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&as=webp',
      '/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?only=vector',
      '/image/eip155-25',
      '/image/eip155-25?contrast=dark',
      '/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?bg=6b7280&shape=rounded',
    ])
  })

  it('draws every option from the subject logo except the dark-page tile, which draws the dark logo', () => {
    const paths = IMAGE_OPTION_TILES.flatMap((tile) => tile.samples.map((sample) => sample.path))
    const fromDarkLogo = paths.filter((path) => path.startsWith(IMAGE_OPTION_DARK_LOGO_PATH))
    expect(fromDarkLogo).toEqual([IMAGE_OPTION_DARK_LOGO_PATH, `${IMAGE_OPTION_DARK_LOGO_PATH}?contrast=dark`])
    expect(paths.filter((path) => path.startsWith(IMAGE_OPTION_SUBJECT_PATH))).toHaveLength(3)
  })

  it('puts the dark-page tile on the dark backdrop, and only that tile', () => {
    const surfaces = Object.fromEntries(IMAGE_OPTION_TILES.map((tile) => [tile.key, tile.surface]))
    expect(surfaces).toEqual({
      'resize-and-convert': 'inset',
      'vector-only': 'inset',
      'plate-for-dark-page': 'backdrop',
      'custom-plate': 'inset',
    })
  })

  it('shows the plain logo beside the contrast one, so the option has something to change', () => {
    const samples = tileByKey('plate-for-dark-page').samples
    expect(samples.map((sample) => sample.path)).toEqual([
      IMAGE_OPTION_DARK_LOGO_PATH,
      `${IMAGE_OPTION_DARK_LOGO_PATH}?contrast=dark`,
    ])
    expect(samples.map((sample) => sample.caption)).toEqual(['No options', 'contrast=dark'])
  })

  it('names the logo each sample draws in its alternative text', () => {
    for (const tile of IMAGE_OPTION_TILES) {
      for (const sample of tile.samples) {
        const named = sample.path.startsWith(IMAGE_OPTION_DARK_LOGO_PATH) ? 'Cronos' : 'Wrapped Bitcoin'
        expect(sample.alt).toContain(named)
      }
    }
  })

  it('describes the custom plate as visible on both themes, which the grey plate is on any page', () => {
    expect(tileByKey('custom-plate').description).toContain('both light and dark pages')
  })
})

describe('sprite addresses', () => {
  it('asks for the manifest and the sheet with the same sizing', () => {
    expect(SPRITE_MANIFEST_PATH).toBe('/sprite/pulsex/extended?size=32&cols=10&limit=20')
    expect(SPRITE_SHEET_PATH).toBe('/sprite/pulsex/extended/sheet?size=32&cols=10&limit=20')
  })

  it('asks for the stylesheet route with the same query as the sheet it styles', () => {
    expect(SPRITE_STYLESHEET_PATH).toBe('/sprite/pulsex/extended/sheet.css?size=32&cols=10&limit=20')
  })
})

describe('sprite class names', () => {
  // The snippet must name the classes the server writes. These tests ask the shared layout
  // module for them, so a change to the naming rules fails here rather than in a reader's page.
  it('names the scope class the server gives this list and these settings', () => {
    expect(SPRITE_SCOPE_CLASS).toBe(spriteScopeClassName('pulsex', 'extended', { size: 32, cols: 10, limit: 20 }))
  })

  it('names the class the server gives the sample token', () => {
    expect(SPRITE_SAMPLE_TOKEN_CLASS).toBe(spriteClassName(369, '0x8854bc985fb5725f872c8856bea11b917caeb2fe'))
  })
})

describe('spriteSnippet', () => {
  const stylesheetUrl = 'https://gib.show/sprite/pulsex/extended/sheet.css?size=32&cols=10&limit=20'
  const snippet = spriteSnippet({ stylesheetUrl })

  it('links the stylesheet it was given, not a fixed address', () => {
    expect(snippet).toContain(`<link rel="stylesheet" href="${stylesheetUrl}" />`)
  })

  it('puts the list scope class and the token class on one span', () => {
    expect(snippet).toContain(`<span class="${SPRITE_SCOPE_CLASS} ${SPRITE_SAMPLE_TOKEN_CLASS}"></span>`)
  })

  it('does not teach the background arithmetic, which the stylesheet does for the reader', () => {
    expect(snippet).not.toContain('backgroundPosition')
    expect(snippet).not.toContain('manifest.size')
  })
})
