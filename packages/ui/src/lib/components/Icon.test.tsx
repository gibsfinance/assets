import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { faCheck, faLink } from '@fortawesome/free-solid-svg-icons'
import { Icon, type IconProps } from './Icon'

const draw = (props: IconProps) => render(<Icon {...props} />).container.querySelector('svg')!

describe('Icon', () => {
  it('sizes the view box to the glyph so its paths are not cropped or stretched', () => {
    const [width, height] = faLink.icon
    expect(draw({ icon: faLink }).getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`)
  })

  it('is one em tall and as wide as the glyph aspect ratio, as the font was', () => {
    const [width, height] = faLink.icon
    const svg = draw({ icon: faLink })
    expect(svg.getAttribute('height')).toBe('1em')
    expect(svg.getAttribute('width')).toBe(`${width / height}em`)
  })

  it('draws the glyph path in the text colour', () => {
    const svg = draw({ icon: faCheck })
    expect(svg.getAttribute('fill')).toBe('currentColor')
    expect(svg.querySelector('path')!.getAttribute('d')).toBe(faCheck.icon[4])
  })

  it('draws every segment of a glyph given as several paths', () => {
    const duotone = { ...faCheck, icon: [448, 512, [], 'f00c', ['M0 0h1', 'M2 2h3']] } as unknown as typeof faCheck
    expect([...draw({ icon: duotone }).querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual([
      'M0 0h1',
      'M2 2h3',
    ])
  })

  it('stays out of the accessibility tree', () => {
    expect(draw({ icon: faCheck }).getAttribute('aria-hidden')).toBe('true')
  })

  it('names the glyph so a test can tell which one is drawn', () => {
    expect(draw({ icon: faCheck }).getAttribute('data-icon')).toBe('check')
  })

  it('keeps the caller classes next to its own', () => {
    expect(draw({ icon: faCheck, className: 'text-xs mr-2' }).getAttribute('class')).toBe('icon text-xs mr-2')
  })

  it('spins only when asked', () => {
    expect(draw({ icon: faCheck }).classList.contains('icon-spin')).toBe(false)
    expect(draw({ icon: faCheck, spin: true }).classList.contains('icon-spin')).toBe(true)
  })

  it('passes other attributes through', () => {
    expect(draw({ icon: faCheck, 'data-testid': 'tick' } as IconProps).getAttribute('data-testid')).toBe('tick')
  })

  it('cannot be made visible to assistive technology by a caller attribute', () => {
    expect(draw({ icon: faCheck, 'aria-hidden': false }).getAttribute('aria-hidden')).toBe('true')
  })
})
