/** Matches the one stylesheet link Vite writes into the built `index.html`. */
const STYLESHEET_LINK = /<link\s+rel="stylesheet"[^>]*?\shref="([^"]+\.css)"[^>]*>/

/** Matches a CSS `url(...)` token, quoted or bare. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/** A reference that does not point at a file next to the stylesheet. */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i

/**
 * Rewrites every relative `url(...)` in a stylesheet so it resolves from the page
 * instead of from the stylesheet's own folder.
 *
 * @param css Stylesheet source.
 * @param directory Folder of the stylesheet, relative to the page, such as `./assets`.
 */
export function rebaseCssUrls(css: string, directory: string): string {
  return css.replace(CSS_URL, (token, quote: string, reference: string) => {
    if (NOT_RELATIVE.test(reference)) return token
    return `url(${quote}${directory}/${reference.replace(/^\.\//, '')}${quote})`
  })
}

/**
 * Replaces the built stylesheet link with an inline `<style>` holding the same rules,
 * so first paint needs no second request. A missing link, or a stylesheet the caller
 * cannot find, throws: a build that quietly keeps the blocking request loses the speed
 * this exists for.
 *
 * @param html Built `index.html`.
 * @param readStylesheet Returns the source of the stylesheet a link names, or `undefined` when it is not in the bundle.
 */
export function inlineStylesheet(html: string, readStylesheet: (href: string) => string | undefined): string {
  const match = STYLESHEET_LINK.exec(html)
  if (!match) throw new Error('index.html has no stylesheet link to inline')
  const href = match[1]
  const css = readStylesheet(href)
  if (css === undefined) throw new Error(`The bundle has no stylesheet for ${href}`)
  if (/<\/style/i.test(css)) throw new Error(`${href} contains a closing style tag and cannot be inlined`)
  const slash = href.lastIndexOf('/')
  const directory = slash < 0 ? '.' : href.slice(0, slash)
  return html.replace(match[0], () => `<style>${rebaseCssUrls(css, directory)}</style>`)
}
