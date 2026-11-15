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
const SPRITE_OPTIONS = 'size=32&cols=10&limit=20'

/** The manifest path for the sprite card: where each token sits in the grid, and the sheet's address. */
export const SPRITE_MANIFEST_PATH = `${SPRITE_LIST_PATH}?${SPRITE_OPTIONS}`

/** The rendered sheet for the sprite card. Ten columns of 32-pixel cells, two rows, 320 by 64 pixels. */
export const SPRITE_SHEET_PATH = `${SPRITE_LIST_PATH}/sheet?${SPRITE_OPTIONS}`

/** The stylesheet the snippet links: one scope class for the list, and one class per token. */
export const SPRITE_STYLESHEET_PATH = `${SPRITE_LIST_PATH}/sheet.css?${SPRITE_OPTIONS}`

/**
 * The scope class of the stylesheet above, which every token rule in it starts with. It is
 * computed by `spriteScopeClassName` in `packages/sdk/src/sprite-layout.ts` from the list and the
 * settings. A test recomputes it through that function, so this value cannot drift from the server.
 */
export const SPRITE_SCOPE_CLASS = 'gibsheet-0bc2ecdbc38407'

/**
 * The class of the sample token, Pulsechain's first cell in the sheet. Computed by `spriteClassName`
 * in `packages/sdk/src/sprite-layout.ts`; a test recomputes it through that function.
 */
export const SPRITE_SAMPLE_TOKEN_CLASS = 'gib-eip155-369-0x8854bc985fb5725f872c8856bea11b917caeb2fe'

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
