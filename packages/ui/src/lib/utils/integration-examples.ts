/**
 * @module integration-examples
 * The addresses and snippet the home page's image options and sprite sheet cards show.
 *
 * These are plain values, so the page and its tests read one source. Each address is a path
 * on the instance the interface talks to; the page prefixes it with `getApiUrl`. A path
 * here must answer on the public instance, because the page shows what that instance returns.
 */

/**
 * The logo most options draw: Wrapped Bitcoin, a vector that reads on both a light and a dark page.
 */
export const IMAGE_OPTION_SUBJECT_PATH = '/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

/**
 * The logo the dark-page example draws. Cronos is a dark vector logo: it reads on a light page and
 * nearly vanishes on a dark one, so `contrast` has something to fix.
 */
export const IMAGE_OPTION_DARK_LOGO_PATH = '/image/eip155-25'

/** One logo in an option tile: the address it draws, its alternative text and an optional caption. */
export interface ImageOptionSample {
  path: string
  alt: string
  caption?: string
}

/** Which backdrop a tile's logos sit on. A dark logo needs the dark one to show what the option does. */
export type ImageOptionSurface = 'inset' | 'backdrop'

/** One option the image options card explains: a short title, one or two sentences, and its logos. */
export interface ImageOptionTile {
  key: string
  title: string
  description: string
  surface: ImageOptionSurface
  samples: ImageOptionSample[]
}

/**
 * The four options, in the order the card shows them. The dark-page tile shows the plain logo
 * beside the `contrast` one, so a reader can see what the option changes.
 */
export const IMAGE_OPTION_TILES: readonly ImageOptionTile[] = [
  {
    key: 'resize-and-convert',
    title: 'Resize and convert',
    description: 'Use for lists and buttons, where a small file at a set size is enough. Gib never enlarges a logo.',
    surface: 'inset',
    samples: [
      {
        path: `${IMAGE_OPTION_SUBJECT_PATH}?w=64&h=64&as=webp`,
        alt: 'Wrapped Bitcoin, 64 pixels, webp',
      },
    ],
  },
  {
    key: 'vector-only',
    title: 'Vector only',
    description:
      'Use when your design needs a sharp logo at any size. If the token has no vector logo, the answer is 404, so plan a fallback.',
    surface: 'inset',
    samples: [{ path: `${IMAGE_OPTION_SUBJECT_PATH}?only=vector`, alt: 'Wrapped Bitcoin, vector only' }],
  },
  {
    key: 'plate-for-dark-page',
    title: 'Plate for a dark page',
    description:
      'Use when a logo is dark and would vanish on your page. Gib adds a light plate only when a logo is hard to see. The logo on the left has no option, and it nearly disappears here.',
    surface: 'backdrop',
    samples: [
      { path: IMAGE_OPTION_DARK_LOGO_PATH, alt: 'Cronos logo, plain', caption: 'No options' },
      {
        path: `${IMAGE_OPTION_DARK_LOGO_PATH}?contrast=dark`,
        alt: 'Cronos logo, with contrast=dark',
        caption: 'contrast=dark',
      },
    ],
  },
  {
    key: 'custom-plate',
    title: 'Custom plate',
    description:
      'Use when you want your own background behind a logo. bg takes a six-digit colour without the hash sign, and shape sets the outline: circle, rounded or square. This grey plate shows on both light and dark pages.',
    surface: 'inset',
    samples: [
      {
        path: `${IMAGE_OPTION_SUBJECT_PATH}?bg=6b7280&shape=rounded`,
        alt: 'Wrapped Bitcoin on a grey plate',
      },
    ],
  },
]

/** The list the sprite card draws, and the options that size its sheet. */
export const SPRITE_LIST_PATH = '/sprite/pulsex/extended'
/**
 * The options the sprite example asks for: 48-pixel cells, twenty tokens in ten columns, drawn at
 * two sheet pixels per CSS pixel (sharp on high-density screens) with a 4-pixel gap between cells.
 */
const SPRITE_OPTIONS = 'size=48&cols=10&limit=20&scale=2&gap=4'

/** The manifest path for the sprite card: where each token sits in the grid, and the sheet's address. */
export const SPRITE_MANIFEST_PATH = `${SPRITE_LIST_PATH}?${SPRITE_OPTIONS}`

/** The rendered sheet for the sprite card: ten columns and two rows of 48-pixel cells, drawn at scale 2. */
export const SPRITE_SHEET_PATH = `${SPRITE_LIST_PATH}/sheet?${SPRITE_OPTIONS}`

/** The stylesheet the snippet links: one scope class for the list, and one class per token. */
export const SPRITE_STYLESHEET_PATH = `${SPRITE_LIST_PATH}/sheet.css?${SPRITE_OPTIONS}`

/**
 * The scope class of the stylesheet above, which every token rule in it starts with. It is
 * computed by `spriteScopeClassName` in `packages/sdk/src/sprite-layout.ts` from the list and the
 * settings. A test recomputes it through that function, so this value cannot drift from the server.
 */
export const SPRITE_SCOPE_CLASS = 'gibsheet-172034060c850b'

/**
 * The tokens the sprite preview draws, in the order the sheet places them: twenty PulseChain tokens.
 * Their keys come from the manifest for the sprite options above.
 */
export const SPRITE_PREVIEW_TOKEN_KEYS: readonly string[] = [
  'eip155-369-0xa1077a294dde1b09bb078844df40758a5d0f9a27',
  'eip155-369-0xca35638a3fddd02fec597d8c1681198c06b23f58',
  'eip155-369-0xbbcf895bfcb57d0f457d050bb806d1499436c0ce',
  'eip155-369-0x0567ca0de35606e9c260cc2358404b11de21db44',
  'eip155-369-0xaec4c07537b03e3e62fc066ec62401aed5fdd361',
  'eip155-369-0xdfdc2836fd2e63bba9f0ee07901ad465bff4de71',
  'eip155-369-0xcfcffe432a48db53f59c301422d2edd77b2a88d7',
  'eip155-369-0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b',
  'eip155-369-0x0deed1486bc52aa0d3e6f8849cec5add6598a162',
  'eip155-369-0x600136da8cc6d1ea07449514604dc4ab7098db82',
  'eip155-369-0x8854bc985fb5725f872c8856bea11b917caeb2fe',
  'eip155-369-0x96e035ae0905efac8f733f133462f971cfa45db1',
  'eip155-369-0x9663c2d75ffd5f4017310405fce61720af45b829',
  'eip155-369-0xa12e2661ec6603cbbb891072b2ad5b3d5edb48bd',
  'eip155-369-0xecd465a15fac825b0fe69416a4c7bfe03a50c12e',
  'eip155-369-0xa9d4230b4899e6aac0d84e540941b3832aba3ba0',
  'eip155-369-0xf876bdf9d6403aa7d5bf7f523e8f440a841cc596',
  'eip155-369-0x73d8a4d01d658e565cf83068397fd39baf386c48',
  'eip155-369-0x7663e79e09d78142e3f6e4dca19faf604159842d',
  'eip155-369-0x1dcbf345bc44696bbbed402367f7c62e524fe8b5',
]

/**
 * The class a token carries, for a key that is all lowercase letters, digits and dashes (every
 * key in the preview). The server's rule is `spriteTokenClassName` in `packages/sdk/src/sprite-layout.ts`;
 * a test checks this against that function for every preview key, so the two cannot drift.
 *
 * @param key The token's manifest key, `chainId-address`.
 * @returns The class name.
 */
export function spritePreviewClass(key: string): string {
  return `gib-${key}`
}

/**
 * The class of the sample token in the snippet: the first token of the preview.
 */
export const SPRITE_SAMPLE_TOKEN_CLASS = spritePreviewClass(SPRITE_PREVIEW_TOKEN_KEYS[0])

/**
 * The markup a reader would paste to show one token from a sprite sheet: the stylesheet link, then
 * one element that carries the list's scope class and the token's class.
 *
 * @param input.stylesheetUrl The absolute address of the stylesheet, as the reader's page would link it.
 * @returns The snippet, as plain markup.
 */
export function spriteSnippet({ stylesheetUrl }: { stylesheetUrl: string }): string {
  return [
    `<link rel="stylesheet" href="${stylesheetUrl}" />`,
    `<span class="${SPRITE_SCOPE_CLASS} ${SPRITE_SAMPLE_TOKEN_CLASS}"></span>`,
  ].join('\n')
}
