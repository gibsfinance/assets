import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SPRITE_MAXIMUM_SHEET_PIXELS,
  buildSpriteQuery,
  canonicalHexColour,
  choiceFrom,
  SPRITE_PLATED_LIMIT,
  type SpriteRequest,
  encodeSpriteClassSegment,
  escapeCssString,
  hashSpriteText,
  isVectorImageExtension,
  maximumSpriteCells,
  normalizeSpriteAddress,
  normalizeSpriteSettings,
  planSpriteLayout,
  renderSpriteStylesheet,
  spriteClassName,
  spriteQueryValues,
  spriteScopeClassName,
  spriteTokenClassName,
  spriteTokenKey,
  toCaip2ChainId,
  type SpriteSettings,
  type SpriteEntry,
} from './sprite-layout'

const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SOLANA_MINT = 'GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g'

/** Settings with every default applied, for the layout tests to build on. */
function settingsWith(overrides: Partial<SpriteSettings>): SpriteSettings {
  return { ...normalizeSpriteSettings({}), ...overrides }
}

describe('normalizeSpriteSettings', () => {
  it('applies the defaults to an empty request', () => {
    expect(normalizeSpriteSettings({})).toEqual({
      size: 32,
      cols: 25,
      limit: 500,
      scale: 1,
      content: 'grid',
      chainId: null,
      gap: 0,
      plate: null,
    })
  })

  it('treats a missing, null, zero or non-numeric value as the default', () => {
    expect(normalizeSpriteSettings({ size: null, cols: 0, limit: Number.NaN })).toMatchObject({
      size: 32,
      cols: 25,
      limit: 500,
    })
  })

  it('holds each whole-number setting inside its range', () => {
    expect(normalizeSpriteSettings({ size: 4, cols: 500, limit: 999_999 })).toMatchObject({
      size: 16,
      cols: 50,
      limit: 2000,
    })
    expect(normalizeSpriteSettings({ size: 512, cols: 1, limit: -3 })).toMatchObject({
      size: 128,
      cols: 5,
      limit: 1,
    })
  })

  it('cuts a fraction to a whole number before bounding it', () => {
    expect(normalizeSpriteSettings({ size: 48.9, cols: 10.2 })).toMatchObject({
      size: 48,
      cols: 10,
    })
  })

  it('takes scale 2 only when it is exactly 2', () => {
    expect(normalizeSpriteSettings({ scale: 2 }).scale).toBe(2)
    expect(normalizeSpriteSettings({ scale: 3 }).scale).toBe(1)
    expect(normalizeSpriteSettings({ scale: null }).scale).toBe(1)
  })

  it('reads content=mixed and treats any other value as grid', () => {
    expect(normalizeSpriteSettings({ content: 'mixed' }).content).toBe('mixed')
    expect(normalizeSpriteSettings({ content: 'anything' }).content).toBe('grid')
  })

  it('keeps a chain filter as text and treats a blank one as absent', () => {
    expect(normalizeSpriteSettings({ chainId: 369 }).chainId).toBe('369')
    expect(normalizeSpriteSettings({ chainId: 'solana-501' }).chainId).toBe('solana-501')
    expect(normalizeSpriteSettings({ chainId: '' }).chainId).toBeNull()
    expect(normalizeSpriteSettings({ chainId: null }).chainId).toBeNull()
  })

  it('reads a plate from a colour or a tone, and makes none from a shape alone', () => {
    expect(normalizeSpriteSettings({ bg: 'F80' }).plate).toEqual({
      colour: 'ff8800',
      shape: 'circle',
      contrast: null,
    })
    expect(normalizeSpriteSettings({ contrast: 'Dark', shape: 'square' }).plate).toEqual({
      colour: null,
      shape: 'square',
      contrast: 'dark',
    })
    expect(normalizeSpriteSettings({ shape: 'square' }).plate).toBeNull()
    expect(normalizeSpriteSettings({ bg: 'zz', contrast: 'sideways' }).plate).toBeNull()
  })

  it('holds the gap in its range, with 0 as the default', () => {
    expect(normalizeSpriteSettings({ gap: 4 }).gap).toBe(4)
    expect(normalizeSpriteSettings({ gap: 99 }).gap).toBe(32)
  })
})

describe('toCaip2ChainId', () => {
  it('names a bare number as an EVM chain', () => {
    expect(toCaip2ChainId(1)).toBe('eip155-1')
    expect(toCaip2ChainId('369')).toBe('eip155-369')
  })

  it('keeps an identifier that already names its namespace', () => {
    expect(toCaip2ChainId('solana-501')).toBe('solana-501')
  })

  it('puts chain 0 in the asset namespace', () => {
    expect(toCaip2ChainId(0)).toBe('asset-0')
  })
})

describe('normalizeSpriteAddress and spriteTokenKey', () => {
  it('lowercases an Ethereum-style address', () => {
    expect(normalizeSpriteAddress(ETHEREUM_USDC)).toBe(ETHEREUM_USDC.toLowerCase())
  })

  it('leaves a base58 id exactly as given, because its case is significant', () => {
    expect(normalizeSpriteAddress(SOLANA_MINT)).toBe(SOLANA_MINT)
  })

  it('lowercases any hexadecimal id, since hex casing carries no meaning', () => {
    const hash = `0x${'AB'.repeat(32)}`
    expect(normalizeSpriteAddress(hash)).toBe(hash.toLowerCase())
  })

  it('builds the manifest key for a bare or a namespaced chain', () => {
    expect(spriteTokenKey({ chainId: 1, address: ETHEREUM_USDC })).toBe(
      'eip155-1-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    )
    expect(spriteTokenKey({ chainId: 'solana-501', address: SOLANA_MINT })).toBe(`solana-501-${SOLANA_MINT}`)
  })
})

describe('isVectorImageExtension', () => {
  it('counts both spellings of an SVG', () => {
    expect(isVectorImageExtension('.svg')).toBe(true)
    expect(isVectorImageExtension('.svg+xml')).toBe(true)
  })

  it('does not count rasters, an absent extension, or a name that only contains svg', () => {
    expect(isVectorImageExtension('.webp')).toBe(false)
    expect(isVectorImageExtension(null)).toBe(false)
    expect(isVectorImageExtension(undefined)).toBe(false)
    expect(isVectorImageExtension('.svgz')).toBe(false)
  })
})

describe('class names', () => {
  it('leaves lowercase letters, digits and dashes unchanged', () => {
    expect(encodeSpriteClassSegment('eip155-1-0xabc')).toBe('eip155-1-0xabc')
  })

  it('keeps an uppercase letter apart from its lowercase form', () => {
    expect(encodeSpriteClassSegment('A')).not.toBe(encodeSpriteClassSegment('a'))
    expect(encodeSpriteClassSegment('Ab')).toBe('_ab')
  })

  it('doubles an underscore, so it cannot be read as the start of an escape', () => {
    expect(encodeSpriteClassSegment('_')).toBe('__')
    expect(encodeSpriteClassSegment('_0')).toBe('__0')
  })

  it('escapes every other character to its hexadecimal code point', () => {
    expect(encodeSpriteClassSegment('/')).toBe('_02f_')
    expect(encodeSpriteClassSegment('ibc/x')).toBe('ibc_02f_x')
    expect(encodeSpriteClassSegment('0\u{1F600}')).toBe('0_01f600_')
  })

  it('gives a distinct class to every key that differs only in case', () => {
    const keys = [ETHEREUM_USDC.toLowerCase(), 'gozp', 'GOZP', 'GozP', 'gOzP']
    const classes = keys.map((key) => spriteTokenClassName(key))
    expect(new Set(classes).size).toBe(keys.length)
  })

  it('contains only characters that need no escape in a selector', () => {
    const hostile = 'a}body{background:red}/*"\'\\ \n;:.#[x]'
    expect(encodeSpriteClassSegment(hostile)).toMatch(/^[a-z0-9_-]*$/)
    expect(spriteTokenClassName(hostile)).toMatch(/^gib-[a-z0-9_-]+$/)
  })

  it('builds the page class for a token from its chain and address', () => {
    expect(spriteClassName(1, ETHEREUM_USDC)).toBe('gib-eip155-1-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(spriteClassName('solana-501', SOLANA_MINT)).toBe(`gib-solana-501-${encodeSpriteClassSegment(SOLANA_MINT)}`)
  })
})

describe('hashSpriteText', () => {
  it('gives fourteen lowercase hexadecimal digits, the same every time', () => {
    const hash = hashSpriteText('layout')
    expect(hash).toMatch(/^[0-9a-f]{14}$/)
    expect(hashSpriteText('layout')).toBe(hash)
  })

  it('separates texts that differ by one character, and by length', () => {
    expect(hashSpriteText('layout')).not.toBe(hashSpriteText('layouT'))
    expect(hashSpriteText('')).not.toBe(hashSpriteText('\u0000'))
  })
})

describe('maximumSpriteCells', () => {
  it('leaves the defaults unchanged', () => {
    expect(maximumSpriteCells(25, 32)).toBe(25 * 511)
  })

  it('is limited by the side at a small cell and by the pixels at a large one', () => {
    expect(maximumSpriteCells(5, 128)).toBe(5 * 127)
    expect(maximumSpriteCells(50, 256)).toBe(50 * 7)
  })

  it('keeps every sheet within the pixel budget', () => {
    for (const cellPixels of [16, 32, 64, 128, 256]) {
      for (let columns = 5; columns <= 50; columns += 5) {
        const rows = maximumSpriteCells(columns, cellPixels) / columns
        expect(columns * cellPixels * rows * cellPixels).toBeLessThanOrEqual(SPRITE_MAXIMUM_SHEET_PIXELS)
      }
    }
  })
})

describe('planSpriteLayout', () => {
  const entries: SpriteEntry[] = [
    { key: 'k-a', vector: false },
    { key: 'k-b', vector: true },
    { key: 'k-c', vector: false },
    { key: 'k-a', vector: false },
  ]

  it('places rasters in list order, four to a row', () => {
    const layout = planSpriteLayout(entries, settingsWith({ cols: 5, size: 32 }))
    expect(layout.placements).toEqual([
      { kind: 'cell', key: 'k-a', source: 0, index: 0, column: 0, row: 0 },
      { kind: 'cell', key: 'k-b', source: 1, index: 1, column: 1, row: 0 },
      { kind: 'cell', key: 'k-c', source: 2, index: 2, column: 2, row: 0 },
    ])
  })

  it('keeps the first occurrence of a key and drops the rest', () => {
    const layout = planSpriteLayout(entries, settingsWith({}))
    expect(layout.placements.filter((placement) => placement.key === 'k-a')).toHaveLength(1)
  })

  it('inlines vectors under content=mixed without moving a raster', () => {
    const layout = planSpriteLayout(entries, settingsWith({ content: 'mixed' }))
    expect(layout.placements).toEqual([
      { kind: 'cell', key: 'k-a', source: 0, index: 0, column: 0, row: 0 },
      { kind: 'inline', key: 'k-b', source: 1 },
      { kind: 'cell', key: 'k-c', source: 2, index: 1, column: 1, row: 0 },
    ])
  })

  it('gives each vector a cell under grid content', () => {
    const layout = planSpriteLayout(entries, settingsWith({ content: 'grid' }))
    expect(layout.placements.map((placement) => placement.kind)).toEqual(['cell', 'cell', 'cell'])
  })

  it('sizes the sheet from the cell size, the scale and the rows used', () => {
    const layout = planSpriteLayout(entries, settingsWith({ cols: 5, size: 32, scale: 2 }))
    expect(layout.cellPixels).toBe(64)
    expect(layout.rows).toBe(1)
    expect(layout.sheetWidth).toBe(5 * 64)
    expect(layout.sheetHeight).toBe(64)
  })

  it('keeps a sheet at least one pixel tall when nothing is placed', () => {
    const layout = planSpriteLayout([], settingsWith({}))
    expect(layout.rows).toBe(0)
    expect(layout.sheetHeight).toBe(1)
    expect(layout.placements).toEqual([])
  })

  it('leaves a raster past the capacity off the layout', () => {
    const many = Array.from({ length: 2000 }, (_, index) => ({
      key: `k-${index}`,
      vector: false,
    }))
    const settings = settingsWith({
      cols: 50,
      size: 128,
      scale: 2,
      limit: 2000,
    })
    const layout = planSpriteLayout(many, settings)
    expect(layout.placements).toHaveLength(maximumSpriteCells(50, 256))
    expect(layout.sheetHeight).toBeLessThanOrEqual(16383)
  })

  it('versions the layout by its placements, and only by them', () => {
    const settings = settingsWith({ cols: 5 })
    const first = planSpriteLayout(entries, settings)
    expect(planSpriteLayout(entries, settings).version).toBe(first.version)
    const reordered = planSpriteLayout([entries[2], entries[0]], settings)
    expect(reordered.version).not.toBe(first.version)
    expect(planSpriteLayout(entries, settingsWith({ cols: 6 })).version).not.toBe(first.version)
    expect(planSpriteLayout(entries, settingsWith({ cols: 5, scale: 2 })).version).not.toBe(first.version)
  })

  it('tells a vector apart from a raster in the version, so a change of content is a new layout', () => {
    const grid = planSpriteLayout(entries, settingsWith({ content: 'grid' }))
    const mixed = planSpriteLayout(entries, settingsWith({ content: 'mixed' }))
    expect(mixed.version).not.toBe(grid.version)
  })
})

describe('spriteScopeClassName', () => {
  it('is the same whether a default is written out or left out', () => {
    expect(spriteScopeClassName('p', 'l', {})).toBe(spriteScopeClassName('p', 'l', { size: 32, cols: 25, limit: 500 }))
  })

  it('differs by provider, list, and any setting that changes the picture', () => {
    const base = spriteScopeClassName('p', 'l', {})
    expect(base).toMatch(/^gibsheet-[0-9a-f]{14}$/)
    expect(spriteScopeClassName('q', 'l', {})).not.toBe(base)
    expect(spriteScopeClassName('p', 'm', {})).not.toBe(base)
    expect(spriteScopeClassName('p', 'l', { size: 48 })).not.toBe(base)
    expect(spriteScopeClassName('p', 'l', { scale: 2 })).not.toBe(base)
  })
})

describe('buildSpriteQuery and spriteQueryValues', () => {
  it('leaves out an undefined value and keeps the order of the rest', () => {
    expect(buildSpriteQuery({ size: 32, cols: undefined, chainId: 'eip155-1' })).toBe('size=32&chainId=eip155-1')
  })

  it('names every setting and the version when one is given', () => {
    const settings = normalizeSpriteSettings({
      size: 40,
      scale: 2,
      chainId: 1,
      content: 'mixed',
    })
    expect(buildSpriteQuery(spriteQueryValues(settings, 'abc'))).toBe(
      'size=40&cols=25&limit=500&chainId=1&content=mixed&scale=2&v=abc',
    )
  })

  it('omits the chain, the content and the version when they are not set', () => {
    expect(buildSpriteQuery(spriteQueryValues(normalizeSpriteSettings({}), undefined))).toBe(
      'size=32&cols=25&limit=500&scale=1',
    )
  })
})

describe('escapeCssString', () => {
  it('escapes a quote and a backslash', () => {
    expect(escapeCssString('a"b\\c')).toBe('a\\"b\\\\c')
  })

  it('escapes line breaks as hexadecimal code points', () => {
    expect(escapeCssString('a\nb\rc\fd')).toBe('a\\a b\\d c\\c d')
  })

  it('leaves other text alone', () => {
    expect(escapeCssString('/sprite/p/l/sheet?size=32')).toBe('/sprite/p/l/sheet?size=32')
  })
})

describe('renderSpriteStylesheet', () => {
  it('writes the scope, then one rule per token, for three tokens', () => {
    const settings = normalizeSpriteSettings({ cols: 5, size: 32 })
    const css = renderSpriteStylesheet({
      scope: 'gibsheet-test',
      sheetAddress: '/sprite/p/l/sheet?size=32&cols=5&limit=500&scale=1&v=abc',
      settings,
      rules: [
        { kind: 'cell', key: 'eip155-1-0xa', column: 0, row: 0 },
        { kind: 'cell', key: 'eip155-1-0xb', column: 3, row: 2 },
        {
          kind: 'inline',
          key: 'eip155-1-0xc',
          dataAddress: 'data:image/svg+xml;base64,PHN2Zz4=',
        },
      ],
    })
    expect(css).toBe(
      [
        '.gibsheet-test {',
        '  display: inline-block;',
        '  width: 32px;',
        '  height: 32px;',
        '  background-image: url("/sprite/p/l/sheet?size=32&cols=5&limit=500&scale=1&v=abc");',
        '  background-repeat: no-repeat;',
        '  background-size: 160px auto;',
        '}',
        '.gibsheet-test.gib-eip155-1-0xa {',
        '  background-position: 0px 0px;',
        '}',
        '.gibsheet-test.gib-eip155-1-0xb {',
        '  background-position: -96px -64px;',
        '}',
        '.gibsheet-test.gib-eip155-1-0xc {',
        '  background-image: url("data:image/svg+xml;base64,PHN2Zz4=");',
        '  background-size: contain;',
        '  background-position: center;',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('cannot be made to end a rule by a token key, a list key or an address', () => {
    const hostile = 'x}body{background:url(//evil)}'
    const settings: SpriteSettings = settingsWith({})
    const css = renderSpriteStylesheet({
      scope: 'gibsheet-test',
      sheetAddress: `/sprite/p/${'"}body{}'}/sheet`,
      settings,
      rules: [
        { kind: 'cell', key: hostile, column: 0, row: 0 },
        {
          kind: 'inline',
          key: hostile,
          dataAddress: 'data:image/svg+xml;base64,"}',
        },
      ],
    })
    expect(css).not.toContain('evil)}')
    expect(css).toContain('url("/sprite/p/\\"}body{}/sheet")')
    expect(css.match(/^\.gibsheet-test/gm)).toHaveLength(3)
    expect(css).toContain(`.gibsheet-test.${spriteTokenClassName(hostile)} {`)
  })

  it('writes a base rule and no token rules when nothing is placed', () => {
    const css = renderSpriteStylesheet({
      scope: 'gibsheet-test',
      sheetAddress: '/sprite/p/l/sheet',
      settings: settingsWith({}),
      rules: [],
    })
    expect(css.split('\n').filter((line) => line.startsWith('.'))).toHaveLength(1)
  })
})

describe('gap, plate and the plated limit', () => {
  it('cuts a plated request to the plated limit, and leaves an unplated one alone', () => {
    expect(normalizeSpriteSettings({ limit: 2000, bg: 'ff0000' }).limit).toBe(SPRITE_PLATED_LIMIT)
    expect(normalizeSpriteSettings({ limit: 2000 }).limit).toBe(2000)
    expect(normalizeSpriteSettings({ limit: 100, contrast: 'dark' }).limit).toBe(100)
  })

  it('reads a colour as lowercase hex, doubling three digits, and refuses anything else', () => {
    expect(canonicalHexColour('ABC')).toBe('aabbcc')
    expect(canonicalHexColour('A1B2C3')).toBe('a1b2c3')
    expect(canonicalHexColour('A1B2C3FF')).toBe('a1b2c3ff')
    expect(canonicalHexColour('#abc')).toBeNull()
    expect(canonicalHexColour('abcd')).toBeNull()
  })

  it('reads a choice without regard to case, and returns null for a value that is not a choice', () => {
    expect(choiceFrom(['dark', 'light'] as const, 'LIGHT')).toBe('light')
    expect(choiceFrom(['dark', 'light'] as const, 'sideways')).toBeNull()
    expect(choiceFrom(['dark', 'light'] as const, undefined)).toBeNull()
  })

  it('changes the version when the gap, the scale or the plate changes, so a manifest never pairs with another sheet', () => {
    const entries = [{ key: 'k-a', vector: false }]
    const base = planSpriteLayout(entries, normalizeSpriteSettings({})).version
    expect(planSpriteLayout(entries, normalizeSpriteSettings({ gap: 2 })).version).not.toBe(base)
    expect(planSpriteLayout(entries, normalizeSpriteSettings({ scale: 2 })).version).not.toBe(base)
    expect(planSpriteLayout(entries, normalizeSpriteSettings({ bg: 'ff0000' })).version).not.toBe(base)
    expect(planSpriteLayout(entries, normalizeSpriteSettings({ contrast: 'dark' })).version).not.toBe(base)
    expect(planSpriteLayout(entries, normalizeSpriteSettings({ bg: 'ff0000', shape: 'square' })).version).not.toBe(
      planSpriteLayout(entries, normalizeSpriteSettings({ bg: 'ff0000' })).version,
    )
  })

  it('spaces the sheet by the cell and the gap together, so the pitch is size plus gap', () => {
    const settings = normalizeSpriteSettings({
      size: 16,
      cols: 5,
      gap: 4,
      scale: 2,
    })
    const layout = planSpriteLayout([{ key: 'k-a', vector: false }], settings)
    expect(layout.pitchPixels).toBe(40)
    expect(layout.gapPixels).toBe(8)
    expect(layout.sheetWidth).toBe(200)
    expect(layout.sheetHeight).toBe(40)
  })

  it('addresses a sheet with its gap and plate, and leaves them out when they are absent', () => {
    const plated = normalizeSpriteSettings({
      gap: 3,
      bg: 'FF0000',
      shape: 'square',
      contrast: 'light',
    })
    expect(buildSpriteQuery(spriteQueryValues(plated, undefined))).toBe(
      'size=32&cols=25&limit=500&scale=1&gap=3&bg=ff0000&shape=square&contrast=light',
    )
    expect(buildSpriteQuery(spriteQueryValues(normalizeSpriteSettings({}), undefined))).not.toContain('bg')
  })

  it('offsets each rule by the pitch, so a gap moves every cell on the page', () => {
    const settings = normalizeSpriteSettings({ size: 16, cols: 5, gap: 4 })
    const css = renderSpriteStylesheet({
      scope: 'gibsheet-x',
      sheetAddress: '/sprite/p/l/sheet',
      settings,
      rules: [{ kind: 'cell', key: 'k-b', column: 2, row: 1 }],
    })
    expect(css).toContain('background-size: 100px auto;')
    expect(css).toContain('background-position: -40px -20px;')
  })
})

describe('shared fixture: layout contract', () => {
  const layoutContract = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../fixtures/sprite-layout-contract.json', import.meta.url)), 'utf8'),
  ) as {
    provider: string
    list: string
    request: SpriteRequest
    entries: SpriteEntry[]
    version: string
    scope: string
    classes: { chainId: string | number; address: string; className: string }[]
  }

  it('computes the layout version, the scope and the token classes the server computes', () => {
    const settings = normalizeSpriteSettings(layoutContract.request)
    expect(planSpriteLayout(layoutContract.entries, settings).version).toBe(layoutContract.version)
    expect(spriteScopeClassName(layoutContract.provider, layoutContract.list, layoutContract.request)).toBe(
      layoutContract.scope,
    )
    for (const token of layoutContract.classes) {
      expect(spriteClassName(token.chainId, token.address)).toBe(token.className)
    }
  })
})
