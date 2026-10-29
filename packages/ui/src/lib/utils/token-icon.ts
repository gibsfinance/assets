/**
 * @module token-icon
 * The icon a token row requests, and the early requests that warm it.
 *
 * A row's `<img>` only starts its request once the row renders, so the icons
 * finished 350 to 500 ms after the rows did. Everything the first screen needs is
 * known as soon as its list arrives, so these functions start those requests
 * then. The browser serves the later `<img>` from its cache, provided both ask
 * for the identical URL — which is why the row and the preload share one
 * function for it.
 */
import { getApiUrl } from './index'
import { tokenChainIdentifier } from './chain-identifier'
import { sizedImageUrl } from './image-size'
import type { Token } from '../types'

/** Layout size, in CSS pixels, of the icon in a Studio token row. */
export const TOKEN_ROW_ICON_SIZE = 28

/**
 * How many icons to start early: about one screen of rows.
 *
 * More would compete with the rows' own requests for connections, for icons the
 * user has not yet scrolled to.
 */
export const FIRST_SCREEN_ICON_COUNT = 24

/**
 * The exact URL a token row's `<img>` requests, sizing parameters included.
 *
 * The row passes this to `Image`, which leaves an already-sized URL untouched,
 * so the preload and the rendered image can never ask for different variants.
 */
export function tokenRowIconUrl(token: Pick<Token, 'chainId' | 'chainIdentifier' | 'address'>): string {
  return sizedImageUrl({
    url: getApiUrl(`/image/${tokenChainIdentifier(token)}/${token.address}`),
    width: TOKEN_ROW_ICON_SIZE,
    height: TOKEN_ROW_ICON_SIZE,
    imageEndpoint: getApiUrl('/image/'),
  })
}

/**
 * Elements whose request is still running. A script holds the only reference to
 * an element made with `new Image()`, and a collected element can cancel its
 * request, so each stays here until it loads or fails.
 */
const inFlight = new Set<HTMLImageElement>()

/** Start a browser request for each of the first screen's icons. Tokens without an icon are skipped. */
export function preloadTokenIcons(tokens: readonly Token[]): void {
  tokens
    .filter((token) => token.hasIcon)
    .slice(0, FIRST_SCREEN_ICON_COUNT)
    .forEach((token) => {
      const image = new globalThis.Image()
      const release = () => inFlight.delete(image)
      image.onload = release
      image.onerror = release
      image.decoding = 'async'
      inFlight.add(image)
      image.src = tokenRowIconUrl(token)
    })
}

const preloadedChains = new Set<string>()

/**
 * Preload a chain's first-screen icons, once per chain for the life of the page.
 *
 * Both the click and the hover path reach for the same slice, and the slice can
 * be re-read many times as the cache refreshes. The browser would dedupe the
 * requests, but the extra elements are wasted work, and a repeat would start
 * requests for icons the user has already seen.
 */
export function preloadFirstScreenIcons(chainIdentifier: string, tokens: readonly Token[]): void {
  if (preloadedChains.has(chainIdentifier)) return
  preloadedChains.add(chainIdentifier)
  preloadTokenIcons(tokens)
}
