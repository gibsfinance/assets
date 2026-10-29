import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { themeScript, routeHideScript, routeGuardScript, HIDE_STYLE_ID } from './pre-paint'

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
