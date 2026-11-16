import { useEffect, type HTMLAttributes } from 'react'
import {
  getSpriteScopeClass,
  getSpriteStylesheetUrl,
  spriteClassName,
  type ChainId,
  type SpriteOptions,
} from '@gibs/sdk'
import { useOptionalGib } from './provider'

/** Where a list's stylesheet comes from, and the options it was built with. */
export interface SpriteStylesheetRequest {
  provider: string
  list: string
  /** The instance's base address. Defaults to the provider's, then to the production instance. */
  baseUrl?: string
  options?: SpriteOptions
}

/** The options a sprite icon takes beside its token. The chain filter is not one of them: a token names its own chain. */
export type SpriteIconOptions = Pick<
  SpriteOptions,
  'size' | 'cols' | 'limit' | 'content' | 'scale' | 'gap' | 'bg' | 'shape' | 'contrast'
>

/**
 * Adds a list's stylesheet to the page, once for each address, and returns the scope class its rules sit under.
 *
 * The link is added when the component mounts and never removed, so two icons from one list share one request.
 *
 * @param request The provider, the list and the options the stylesheet is built with.
 * @returns The scope class to apply beside each token class.
 */
export function useSpriteStylesheet({ provider, list, baseUrl, options = {} }: SpriteStylesheetRequest): string {
  const client = useOptionalGib()
  const origin = baseUrl || client?.baseUrl || 'https://gib.show'
  const href = getSpriteStylesheetUrl(origin, provider, list, options)
  useEffect(() => {
    ensureStylesheetLink(href)
  }, [href])
  return getSpriteScopeClass(provider, list, options)
}

/**
 * Adds a stylesheet link to the document head, unless one for that address is already there.
 *
 * @param href The stylesheet's address.
 */
function ensureStylesheetLink(href: string): void {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-gib-sprite]'))
  if (links.some((link) => link.getAttribute('href') === href)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute('data-gib-sprite', '')
  document.head.append(link)
}

/*
 * The element's own `content` attribute is a string that nothing reads here, so it is left out: the sprite's
 * `content` option (`mixed`) takes its name.
 */
export interface SpriteIconProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'content'>,
    SpriteIconOptions {
  /** The provider key, for example `coingecko`. */
  provider: string
  /** The list key within the provider. */
  list: string
  /** The token's chain, namespaced (`eip155-1`) or bare (`1`). */
  chainId: ChainId
  /** The token's address. */
  address: string
  /** A text alternative. Without one the icon is decorative and hidden from assistive technology. */
  alt?: string
  /** The instance's base address. Defaults to the provider's, then to the production instance. */
  baseUrl?: string
}

/**
 * A token's logo drawn from a list's sprite sheet, with no request of its own.
 *
 * The size, the gap and the plate come from the stylesheet, so the element carries no inline size. A token the
 * list does not place (beyond its limit, or with no picture) draws nothing.
 *
 * @example
 * ```tsx
 * <GibProvider>
 *   <SpriteIcon provider="coingecko" list="ethereum" chainId="eip155-1" address="0x2260…" size={24} alt="WBTC" />
 * </GibProvider>
 * ```
 */
export function SpriteIcon({
  provider,
  list,
  chainId,
  address,
  alt,
  baseUrl,
  size,
  cols,
  limit,
  content,
  scale,
  gap,
  bg,
  shape,
  contrast,
  className,
  ...rest
}: SpriteIconProps) {
  const options = {
    size,
    cols,
    limit,
    content,
    scale,
    gap,
    bg,
    shape,
    contrast,
  }
  const scope = useSpriteStylesheet({ provider, list, baseUrl, options })
  const classes = [scope, spriteClassName(chainId, address), className].filter(Boolean).join(' ')
  return (
    <span
      {...rest}
      className={classes}
      role={alt ? 'img' : undefined}
      aria-label={alt}
      aria-hidden={alt ? undefined : true}
    />
  )
}
