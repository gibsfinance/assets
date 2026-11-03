/**
 * Inline scripts that run before the first paint. Each is plain source held as a
 * string, because the build writes it into `index.html` verbatim. The tests
 * evaluate the same string, so the shipped text is the tested text.
 */

/**
 * Applies the stored theme to the `html` element, exactly as `ThemeProvider` does
 * once React mounts: a `theme-mode` of `dark`, or anything but `light` while the
 * system prefers dark, adds the `dark` class. Without it the static markup paints
 * light and flips when React mounts.
 */
export const themeScript = `(function(){try{var m=localStorage.getItem('theme-mode');var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

/** The id of the style element that hides `#app` until the route guard has emptied it. */
export const HIDE_STYLE_ID = 'prerender-hidden'

/** The id of the loader element that sits beside `#app`. */
export const LOADER_ID = 'route-loader'

/** The attribute the head script sets on `html` so the loader's own rule can show it. */
export const LOADER_ATTRIBUTE = 'data-route-loader'

/**
 * The loader shown in place of a page other than home while its code loads: the
 * site name, pulsing. Markup and style only, so it needs no script and no request.
 * It is hidden unless the head script marks `html`, so home never shows it. It sits
 * outside `#app` because React replaces everything inside `#app` on mount, and the
 * entry script removes it then. Text takes its colour from the page, so it follows
 * the dark class the theme script sets.
 */
export const routeLoaderMarkup = `<div id="${LOADER_ID}" role="status" aria-label="Loading"><span>Gib.Show</span></div><style>#${LOADER_ID}{display:none}html[${LOADER_ATTRIBUTE}] #${LOADER_ID}{display:flex;position:fixed;inset:0;align-items:center;justify-content:center;font:600 1.5rem/1 Inter,system-ui,sans-serif;animation:route-loader-pulse 1.4s ease-in-out infinite}@keyframes route-loader-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){#${LOADER_ID}{animation:none!important}}</style>`

/** Removes the loader. Safe to call when it is already gone. */
export const removeRouteLoader = (): void => {
  document.getElementById(LOADER_ID)?.remove()
}

/** True, as inline source, when the address names a page other than home. */
const NAMES_ANOTHER_PAGE = `!(location.hash===''||location.hash==='#'||location.hash==='#/')`

/**
 * Hides `#app` from the head when the address names a page other than home. The
 * route guard below empties `#app`, but it runs after the markup is parsed, and a
 * browser may paint the markup before reaching it. Hiding first means a visitor who
 * opens `/#/studio` never sees the static home page, whatever the browser paints when.
 */
export const routeHideScript = `(function(){if(${NAMES_ANOTHER_PAGE}){document.documentElement.setAttribute('${LOADER_ATTRIBUTE}','');var s=document.createElement('style');s.id='${HIDE_STYLE_ID}';s.textContent='#app{visibility:hidden}';document.head.appendChild(s)}})()`

/**
 * Empties `#app` when the address names a page other than home, then removes the
 * hiding style so the page React renders there is visible. It must sit after the
 * `#app` element so the element exists when it runs.
 */
export const routeGuardScript = `(function(){if(!(${NAMES_ANOTHER_PAGE}))return;var r=document.getElementById('app');if(r)r.textContent='';var s=document.getElementById('${HIDE_STYLE_ID}');if(s)s.remove();window.addEventListener('hashchange',function(){if(!(${NAMES_ANOTHER_PAGE})){var l=document.getElementById('${LOADER_ID}');if(l)l.remove();document.documentElement.removeAttribute('${LOADER_ATTRIBUTE}')}})})()`
