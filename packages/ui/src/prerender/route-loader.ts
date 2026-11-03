/**
 * The loader shown on every page other than home while that page's code loads.
 * All the artwork lives in this one module, so swapping the design is a one-file
 * change. It is markup and style only: no script and no request.
 */

/** The id of the loader element that sits beside `#app`. */
export const LOADER_ID = 'route-loader'

/** The attribute the head script sets on `html` so the loader's own rule can show it. */
export const LOADER_ATTRIBUTE = 'data-route-loader'

/** Largest the inline loader may grow, in bytes. A test holds the line. */
export const LOADER_BUDGET_BYTES = 2400

const L = `#${LOADER_ID}`

/**
 * Every rule is scoped under the loader's id so nothing reaches the app's own CSS.
 * Light is the default; `html.dark`, which the theme script sets before paint, swaps
 * the variables. The loader is hidden unless the head script marks `html`, so home
 * never shows it. A token is inspected, then earns its network badge.
 */
const style = `${L}{display:none;--a:#00dc82;--s:#fff;--c:#fafafa;--d:#e4e4e7;--r:#a1a1aa;--g:#71717a;--h:rgba(255,255,255,.75)}.dark ${L}{--s:#09090b;--c:#3f3f46;--d:#27272a;--r:#52525b;--g:#a1a1aa;--h:rgba(255,255,255,.22)}html[${LOADER_ATTRIBUTE}] ${L}{display:grid;place-items:center;position:fixed;inset:0;background:var(--s)}${L} svg{width:96px;height:96px;overflow:visible}${L} .t,${L} .p,${L} .w{transform-box:fill-box;transform-origin:center}${L} .f{fill:var(--d);stroke:var(--r)}${L} .h{fill:var(--c)}${L} .i{stroke:var(--r)}${L} .y{stroke:var(--g)}${L} .b{fill:var(--a);stroke:var(--s)}${L} .m{stroke:var(--s)}${L} .w{fill:var(--h);animation:gl-w 2.8s ease-in-out infinite}${L} .t{animation:gl-t 2.8s cubic-bezier(.45,0,.25,1) infinite}${L} .p{animation:gl-b 2.8s cubic-bezier(.3,1.6,.5,1) infinite}@keyframes gl-t{0%,8%,72%,100%{transform:none}30%{transform:scale(1.12) skewY(-7deg) scaleX(.84)}52%{transform:scale(1.12) skewY(7deg) scaleX(.84)}}@keyframes gl-b{0%,10%,94%,100%{transform:scale(0)}20%{transform:scale(1.18)}26%,84%{transform:scale(1)}}@keyframes gl-w{0%,26%{transform:translateX(-70px) rotate(20deg)}58%,100%{transform:translateX(70px) rotate(20deg)}}@media(prefers-reduced-motion:reduce){${L} .t,${L} .p{animation:none}${L} .w{display:none}}`

const svg = `<svg viewBox="0 0 120 120" role="img" aria-label="Loading"><clipPath id="gl-coin-clip"><circle cx="60" cy="60" r="40"/></clipPath><g class="t"><circle class="f" stroke-width="1.5" cx="60" cy="60" r="40"/><circle class="h" clip-path="url(#gl-coin-clip)" cx="52" cy="50" r="34"/><circle class="i" fill="none" opacity=".7" cx="60" cy="60" r="31"/><path class="y" fill="none" stroke-width="3" stroke-linejoin="round" d="M60 43 74.7 51.5V68.5L60 77 45.3 68.5V51.5ZM60 53 66 56.5V63.5L60 67 54 63.5V56.5Z"/><rect class="w" clip-path="url(#gl-coin-clip)" x="52" y="10" width="14" height="100"/></g><g class="p"><circle class="b" stroke-width="4" cx="91" cy="89" r="14"/><path class="m" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M85 89 89.5 93.5 97 85"/></g></svg>`

/** The loader element and its style, written into `index.html` beside `#app`. */
export const routeLoaderMarkup = `<div id="${LOADER_ID}">${svg}</div><style>${style}</style>`

/** Removes the loader. Safe to call when it is already gone. */
export const removeRouteLoader = (): void => {
  document.getElementById(LOADER_ID)?.remove()
}
