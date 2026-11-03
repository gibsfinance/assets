import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  themeScript,
  routeHideScript,
  routeGuardScript,
  HIDE_STYLE_ID,
} from './pre-paint'
import { LOADER_ID, LOADER_ATTRIBUTE, LOADER_BUDGET_BYTES, routeLoaderMarkup, removeRouteLoader } from './route-loader'

/** Runs a shipped script string the way the browser runs the inline tag. */
const run = (source: string) => new Function(source)()

function stubSystemDark(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: prefersDark }))
}

describe('themeScript', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('adds the dark class when the stored mode is dark', () => {
    stubSystemDark(false)
    localStorage.setItem('theme-mode', 'dark')
    run(themeScript)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('stays light when the stored mode is light, even if the system prefers dark', () => {
    stubSystemDark(true)
    localStorage.setItem('theme-mode', 'light')
    run(themeScript)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows the system when nothing is stored', () => {
    stubSystemDark(true)
    run(themeScript)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows the system when the stored mode is system', () => {
    stubSystemDark(false)
    localStorage.setItem('theme-mode', 'system')
    run(themeScript)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => run(themeScript)).not.toThrow()
  })
})

describe('routeGuardScript', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"><h1>Home</h1></div>'
  })
  afterEach(() => {
    window.location.hash = ''
  })

  it.each(['#/studio', '#/docs', '#/wizard', '#/nowhere'])('empties the root for %s', (hash) => {
    window.location.hash = hash
    run(routeGuardScript)
    expect(document.getElementById('app')!.innerHTML).toBe('')
  })

  it.each(['', '#', '#/'])('keeps the root for the home hash %j', (hash) => {
    window.location.hash = hash
    run(routeGuardScript)
    expect(document.getElementById('app')!.innerHTML).toBe('<h1>Home</h1>')
  })

  it('does nothing when there is no root element', () => {
    document.body.innerHTML = ''
    window.location.hash = '#/studio'
    expect(() => run(routeGuardScript)).not.toThrow()
  })
})

// The head script hides the markup before the browser can paint it; the guard after
// the markup empties it and lifts the hiding. Together they must leave another page's
// root empty and visible, and leave home untouched.
describe('routeHideScript with routeGuardScript', () => {
  const hidingStyle = () => document.getElementById(HIDE_STYLE_ID)

  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<div id="app"><h1>Home</h1></div>'
  })
  afterEach(() => {
    window.location.hash = ''
  })

  it.each(['#/studio', '#/docs'])('hides the root from the head for %s', (hash) => {
    window.location.hash = hash
    run(routeHideScript)
    expect(hidingStyle()?.textContent).toBe('#app{visibility:hidden}')
  })

  it.each(['', '#', '#/'])('leaves the home page visible for %j', (hash) => {
    window.location.hash = hash
    run(routeHideScript)
    run(routeGuardScript)
    expect(hidingStyle()).toBeNull()
    expect(document.getElementById('app')!.innerHTML).toBe('<h1>Home</h1>')
  })

  it('empties the root and removes the hiding style once the guard runs', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    run(routeGuardScript)
    expect(document.getElementById('app')!.innerHTML).toBe('')
    expect(hidingStyle()).toBeNull()
  })

  it('still empties the root when the head script never ran', () => {
    window.location.hash = '#/studio'
    run(routeGuardScript)
    expect(document.getElementById('app')!.innerHTML).toBe('')
  })
})

// The loader must show on another page before React mounts, never on home, and be
// gone once the page mounts or the address returns to home.
describe('route loader', () => {
  const shown = () => document.documentElement.hasAttribute(LOADER_ATTRIBUTE)
  const loader = () => document.getElementById(LOADER_ID)

  beforeEach(() => {
    document.documentElement.removeAttribute(LOADER_ATTRIBUTE)
    document.head.innerHTML = ''
    document.body.innerHTML = `<div id="app"><h1>Home</h1></div>${routeLoaderMarkup}`
  })
  afterEach(() => {
    window.location.hash = ''
  })

  it('is hidden by its own rule unless the head script marks the page', () => {
    expect(routeLoaderMarkup).toContain(`#${LOADER_ID}{display:none;`)
    expect(routeLoaderMarkup).toContain(`html[${LOADER_ATTRIBUTE}] #${LOADER_ID}{display:grid`)
    expect(routeLoaderMarkup).toContain('prefers-reduced-motion:reduce')
  })

  it('stays inside its byte budget', () => {
    expect(new TextEncoder().encode(routeLoaderMarkup).length).toBeLessThanOrEqual(LOADER_BUDGET_BYTES)
  })

  it('scopes every style rule under the loader id, so nothing leaks into the app', () => {
    const css = /<style>(.*)<\/style>/.exec(routeLoaderMarkup)![1]
    const selectors = css
      .replace(/@media[^{]*\{/g, '')
      .replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*\}/g, '')
      .split('}')
      .map((rule) => rule.split('{')[0])
      .filter(Boolean)
      .flatMap((list) => list.split(','))
    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) expect(selector, selector).toContain(`#${LOADER_ID}`)
  })

  it('carries its own clip path, the accent, and both themes', () => {
    expect(routeLoaderMarkup).toContain('<clipPath id="gl-coin-clip">')
    expect(routeLoaderMarkup).toContain('#00dc82')
    expect(routeLoaderMarkup).toContain(`.dark #${LOADER_ID}{`)
    expect(routeLoaderMarkup).toContain('role="img" aria-label="Loading"')
  })

  it('is marked visible on /#/studio before React mounts, and sits outside the root', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    expect(shown()).toBe(true)
    expect(loader()).not.toBeNull()
    expect(document.getElementById('app')!.contains(loader())).toBe(false)
  })

  it.each(['', '#', '#/'])('is never marked visible on home %j', (hash) => {
    window.location.hash = hash
    run(routeHideScript)
    expect(shown()).toBe(false)
  })

  it('survives the guard emptying the root', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    run(routeGuardScript)
    expect(loader()).not.toBeNull()
    expect(document.getElementById('app')!.innerHTML).toBe('')
  })

  it('is gone after mount', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    removeRouteLoader()
    expect(loader()).toBeNull()
    expect(() => removeRouteLoader()).not.toThrow()
  })

  it('is removed when the address returns to home before mount', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    run(routeGuardScript)
    window.location.hash = '#/'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(loader()).toBeNull()
    expect(shown()).toBe(false)
  })

  it('stays when the address moves between other pages', () => {
    window.location.hash = '#/studio'
    run(routeHideScript)
    run(routeGuardScript)
    window.location.hash = '#/docs'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(loader()).not.toBeNull()
    expect(shown()).toBe(true)
  })

  it('tolerates a hashchange to home when the loader is already gone', () => {
    window.location.hash = '#/studio'
    run(routeGuardScript)
    removeRouteLoader()
    window.location.hash = ''
    expect(() => window.dispatchEvent(new HashChangeEvent('hashchange'))).not.toThrow()
  })
})
