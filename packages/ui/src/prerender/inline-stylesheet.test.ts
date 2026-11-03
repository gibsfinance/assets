import { describe, it, expect } from 'vitest'
import { inlineStylesheet, rebaseCssUrls } from './inline-stylesheet'

const link = '<link rel="stylesheet" crossorigin href="./assets/index-ABC.css">'
const page = `<head><link rel="icon" href="favicon.png">${link}</head>`

describe('rebaseCssUrls', () => {
  it('points relative references at the stylesheet folder, whatever the quoting', () => {
    const css = 'a{src:url(./a.woff2)}b{src:url(\'b.woff2\')}c{src:url( "./c.woff2" )}'
    expect(rebaseCssUrls(css, './assets')).toBe(
      'a{src:url(./assets/a.woff2)}b{src:url(\'./assets/b.woff2\')}c{src:url("./assets/c.woff2")}',
    )
  })

  it.each(['/abs.png', 'https://x.test/a.png', 'data:image/png;base64,AAA', '#frag'])(
    'leaves %s alone',
    (reference) => {
      const css = `a{background:url(${reference})}`
      expect(rebaseCssUrls(css, './assets')).toBe(css)
    },
  )
})

describe('inlineStylesheet', () => {
  it('swaps the link for a style holding the rules, with font urls that resolve from the page', () => {
    const html = inlineStylesheet(page, (href) =>
      href === './assets/index-ABC.css' ? '@font-face{src:url(./inter.woff2)}$&body{}' : undefined,
    )
    expect(html).toContain('<style>@font-face{src:url(./assets/inter.woff2)}$&body{}</style>')
    expect(html).not.toContain('rel="stylesheet"')
    expect(html).toContain('<link rel="icon" href="favicon.png">')
  })

  it('treats a link with no folder as sitting beside the page', () => {
    const html = inlineStylesheet('<link rel="stylesheet" href="a.css">', () => 'a{src:url(f.woff2)}')
    expect(html).toBe('<style>a{src:url(./f.woff2)}</style>')
  })

  it('throws when there is no stylesheet link', () => {
    expect(() => inlineStylesheet('<head></head>', () => 'a{}')).toThrow('no stylesheet link')
  })

  it('throws when the bundle lacks the stylesheet the link names', () => {
    expect(() => inlineStylesheet(page, () => undefined)).toThrow('./assets/index-ABC.css')
  })

  it('throws when the css would close the style element early', () => {
    expect(() => inlineStylesheet(page, () => 'a{content:"</style>"}')).toThrow('closing style tag')
  })
})
