/** The comment in `index.html` that marks where the static markup goes. */
export const MARKUP_PLACEHOLDER = '<!--static-markup-->'
/** The comment in `index.html` that marks where the theme script goes. */
export const THEME_PLACEHOLDER = '<!--theme-script-->'
/** The comment in `index.html` that marks where the route guard goes. */
export const GUARD_PLACEHOLDER = '<!--route-guard-script-->'

/** Replaces one placeholder, and fails loudly when it is missing. */
function fill(html: string, placeholder: string, content: string): string {
  if (!html.includes(placeholder)) throw new Error(`index.html is missing ${placeholder}`)
  return html.replace(placeholder, () => content)
}

/** The pieces the build writes into `index.html`. Both head scripts share one tag. */
export type InjectedParts = { markup: string; themeScript: string; routeHideScript: string; routeGuardScript: string }

/**
 * Fills the three placeholders of `index.html`. A missing placeholder throws,
 * because a build that quietly ships an empty shell loses the speed this exists for.
 */
export function injectMarkup(html: string, parts: InjectedParts): string {
  const withMarkup = fill(html, MARKUP_PLACEHOLDER, parts.markup)
  const withTheme = fill(withMarkup, THEME_PLACEHOLDER, `<script>${parts.themeScript};${parts.routeHideScript}</script>`)
  return fill(withTheme, GUARD_PLACEHOLDER, `<script>${parts.routeGuardScript}</script>`)
}
