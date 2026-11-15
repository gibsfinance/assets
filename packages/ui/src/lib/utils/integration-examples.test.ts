import { describe, it, expect } from 'vitest'
import {
  IMAGE_OPTION_LOGO_PATH,
  IMAGE_OPTION_TILES,
  SPRITE_MANIFEST_PATH,
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
      '/image/eip155-25?w=64&h=64&as=webp',
      '/image/eip155-25?only=vector',
      '/image/eip155-25',
      '/image/eip155-25?contrast=dark',
      '/image/eip155-25?bg=ffffff&shape=rounded',
    ])
  })

  it('draws the logo the card is about from the logo path it names', () => {
    for (const sample of IMAGE_OPTION_TILES.flatMap((tile) => tile.samples)) {
      expect(sample.path.startsWith(IMAGE_OPTION_LOGO_PATH)).toBe(true)
    }
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
      IMAGE_OPTION_LOGO_PATH,
      `${IMAGE_OPTION_LOGO_PATH}?contrast=dark`,
    ])
    expect(samples.map((sample) => sample.caption)).toEqual(['No options', 'contrast=dark'])
  })

  it('gives every sample alternative text that names the logo', () => {
    for (const sample of IMAGE_OPTION_TILES.flatMap((tile) => tile.samples)) {
      expect(sample.alt).toContain('Cronos')
    }
  })
})

describe('sprite addresses', () => {
  it('asks for the manifest and the sheet with the same sizing', () => {
    expect(SPRITE_MANIFEST_PATH).toBe('/sprite/pulsex/extended?size=32&cols=10&limit=20')
    expect(SPRITE_SHEET_PATH).toBe('/sprite/pulsex/extended/sheet?size=32&cols=10&limit=20')
  })

  it('asks for the stylesheet with the same list and sizing as the sheet it styles', () => {
    expect(SPRITE_STYLESHEET_PATH).toBe('/sprite/pulsex/extended/stylesheet?size=32&cols=10&limit=20')
  })
})

describe('spriteSnippet', () => {
  const stylesheetUrl = 'https://gib.show/sprite/pulsex/extended/stylesheet?size=32&cols=10&limit=20'
  const snippet = spriteSnippet({ stylesheetUrl })

  it('links the stylesheet it was given, not a fixed address', () => {
    expect(snippet).toContain(`<link rel="stylesheet" href="${stylesheetUrl}" />`)
  })

  it('draws the token with one element that takes its class from the stylesheet', () => {
    expect(snippet).toContain('<span class="..."></span>')
  })

  it('does not teach the background arithmetic, which the stylesheet does for the reader', () => {
    expect(snippet).not.toContain('backgroundPosition')
    expect(snippet).not.toContain('manifest.size')
  })
})
