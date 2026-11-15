import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SpriteSheetExample from './SpriteSheetExample'
import { getApiUrl } from '../utils'
import {
  SPRITE_PREVIEW_TOKEN_KEYS,
  SPRITE_SCOPE_CLASS,
  SPRITE_SHEET_PATH,
  SPRITE_STYLESHEET_PATH,
  spritePreviewClass,
} from '../utils/integration-examples'

afterEach(cleanup)

describe('SpriteSheetExample', () => {
  it('links the real stylesheet the logos are drawn with', () => {
    const { container } = render(<SpriteSheetExample />)
    const link = container.querySelector('link[rel="stylesheet"]')!
    expect(link.getAttribute('href')).toBe(getApiUrl(SPRITE_STYLESHEET_PATH))
  })

  it('draws one span per preview token, each with the list scope class and its own class', () => {
    render(<SpriteSheetExample />)
    const grid = screen.getByRole('img', { name: /Twenty token logos/ })
    const logos = Array.from(grid.querySelectorAll('span'))

    expect(logos).toHaveLength(SPRITE_PREVIEW_TOKEN_KEYS.length)
    logos.forEach((logo, index) => {
      expect(logo.classList.contains(SPRITE_SCOPE_CLASS)).toBe(true)
      expect(logo.classList.contains(spritePreviewClass(SPRITE_PREVIEW_TOKEN_KEYS[index]))).toBe(true)
    })
  })

  it('names the sheet itself, as a link the reader can open', () => {
    render(<SpriteSheetExample />)
    const link = screen.getByText(getApiUrl(SPRITE_SHEET_PATH)).closest('a')!
    expect(link.getAttribute('href')).toBe(getApiUrl(SPRITE_SHEET_PATH))
  })

  it('shows the snippet for the same stylesheet, with the scope class and the sample token class', () => {
    const { container } = render(<SpriteSheetExample />)
    const text = container.textContent ?? ''
    expect(text).toContain(`<link rel="stylesheet" href="${getApiUrl(SPRITE_STYLESHEET_PATH)}" />`)
    expect(text).toContain(
      `<span class="${SPRITE_SCOPE_CLASS} ${spritePreviewClass(SPRITE_PREVIEW_TOKEN_KEYS[0])}"></span>`,
    )
  })

  it('says what the options do, in one paragraph beside the example', () => {
    render(<SpriteSheetExample />)
    expect(screen.getByText(/content=mixed for vector logos as data addresses/)).toBeTruthy()
    expect(screen.getByText(/scale=2/, { exact: false, selector: 'p' })).toBeTruthy()
  })
})
