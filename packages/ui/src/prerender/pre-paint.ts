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

/**
 * Empties `#app` when the address names a page other than home, so a visitor who
 * opens `/#/studio` never sees the static home markup. It must sit after the
 * `#app` element so the element exists when it runs.
 */
export const routeGuardScript = `(function(){var h=location.hash;if(h===''||h==='#'||h==='#/')return;var r=document.getElementById('app');if(r)r.textContent=''})()`
