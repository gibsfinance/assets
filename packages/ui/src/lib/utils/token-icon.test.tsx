import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

import Image from '../components/Image'
import {
  FIRST_SCREEN_ICON_COUNT,
  TOKEN_ROW_ICON_SIZE,
  preloadFirstScreenIcons,
  preloadTokenIcons,
  tokenRowIconUrl,
} from './token-icon'
import type { Token } from '../types'

const tokenAt = (index: number, overrides: Partial<Token> = {}): Token => ({
  chainId: 1,
  chainIdentifier: 'eip155-1',
  address: `0x${index.toString(16).padStart(40, '0')}`,
  name: `Token ${index}`,
  symbol: `T${index}`,
  decimals: 18,
  hasIcon: true,
  sourceList: 'merged',
  ...overrides,
})

const tokensFrom = (count: number, overrides: Partial<Token> = {}) =>
  Array.from({ length: count }, (_, index) => tokenAt(index, overrides))

/** Records every element the code under test creates and the URL it was given. */
let created: Array<{ src: string; decoding: string; onload: (() => void) | null; onerror: (() => void) | null }>

beforeEach(() => {
  created = []
  class FakeImage {
    src = ''
    decoding = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      created.push(this)
    }
  }
  vi.stubGlobal('Image', FakeImage)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('tokenRowIconUrl', () => {
  it('names the chain, the address, and the bucketed size the row renders at', () => {
    expect(tokenRowIconUrl(tokenAt(1))).toBe(
      'https://api.test/image/eip155-1/0x0000000000000000000000000000000000000001?w=64&h=64&as=webp',
    )
  })

  it('addresses a token by its own namespace, not by its bare chain number', () => {
    const solana = tokenAt(1, { chainId: 501, chainIdentifier: 'solana-501', address: 'EPjFW' })
    expect(tokenRowIconUrl(solana)).toContain('/image/solana-501/EPjFW?')
  })

  // The preload only helps when the browser cache key matches the row's request.
  // Rendering the real Image with this URL must leave the src exactly as given.
  it('is the final src the real Image element requests, byte for byte', () => {
    const token = tokenAt(7)
    const { container } = render(createElement(Image, { src: tokenRowIconUrl(token), size: TOKEN_ROW_ICON_SIZE }))
    expect(container.querySelector('img')!.getAttribute('src')).toBe(tokenRowIconUrl(token))
  })
})

describe('preloadTokenIcons', () => {
  it('requests the row URL of each token, decoding off the main thread', () => {
    preloadTokenIcons(tokensFrom(3))

    expect(created.map(({ src }) => src)).toEqual(tokensFrom(3).map(tokenRowIconUrl))
    expect(created.every(({ decoding }) => decoding === 'async')).toBe(true)
  })

  it('stops at one screen of icons', () => {
    preloadTokenIcons(tokensFrom(FIRST_SCREEN_ICON_COUNT + 10))

    expect(created).toHaveLength(FIRST_SCREEN_ICON_COUNT)
    expect(created.at(-1)!.src).toBe(tokenRowIconUrl(tokenAt(FIRST_SCREEN_ICON_COUNT - 1)))
  })

  it('skips tokens without an icon and fills the screen from those that have one', () => {
    const tokens = [tokenAt(0, { hasIcon: false }), tokenAt(1), tokenAt(2, { hasIcon: false }), tokenAt(3)]

    preloadTokenIcons(tokens)

    expect(created.map(({ src }) => src)).toEqual([tokenRowIconUrl(tokenAt(1)), tokenRowIconUrl(tokenAt(3))])
  })

  it('keeps each element until it loads or fails, and handles both outcomes', () => {
    preloadTokenIcons(tokensFrom(2))

    expect(() => created[0].onload!()).not.toThrow()
    expect(() => created[1].onerror!()).not.toThrow()
  })
})

describe('preloadFirstScreenIcons', () => {
  it('preloads a chain once, however many times its slice is read', () => {
    preloadFirstScreenIcons('eip155-once', tokensFrom(2))
    preloadFirstScreenIcons('eip155-once', tokensFrom(2))

    expect(created).toHaveLength(2)
  })

  it('preloads each chain separately', () => {
    preloadFirstScreenIcons('eip155-first', tokensFrom(1))
    preloadFirstScreenIcons('eip155-second', tokensFrom(1))

    expect(created).toHaveLength(2)
  })
})
