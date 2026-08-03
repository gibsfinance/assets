/**
 * The expandable branch under a token row, listing every list that publishes an icon for
 * the same token.
 *
 * The whole point of the branch is attribution: each sub-row must carry its own list's
 * icon, its own list's name, and a link to its own list's image. Pairing a row with a
 * neighbour's icon or link is silent — the branch still renders, the icons still load,
 * and the only tell is that the picture beside "uniswap/default" is the one PulseChain's
 * bridge publishes. Every assertion below therefore ties a row's icon, label and link
 * back to the reference that row stands for, rather than checking that some icon exists.
 *
 * The rows also sit inside a clickable parent: the whole token row toggles the branch
 * open and shut. Both controls inside a sub-row stop the click from travelling, so
 * following a link cannot also collapse the thing you were reading.
 *
 * Icons are lazy, so `Image` reaches for IntersectionObserver, which jsdom does not
 * supply. It is stubbed at the host boundary and reports everything as on screen. No
 * application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import TokenSubRows from './TokenSubRows'
import type { TokenListReference } from '../types'

const UNISWAP: TokenListReference = {
  sourceList: 'uniswap/default',
  imageUri: 'https://icons.test/uniswap/dai.svg',
  imageFormat: 'svg',
}
const BRIDGE: TokenListReference = {
  sourceList: 'pulsechain-bridge/tokens',
  imageUri: 'https://icons.test/bridge/dai.png',
  imageFormat: 'png',
}
const COINGECKO: TokenListReference = {
  sourceList: 'coingecko/all',
  imageUri: 'https://icons.test/coingecko/dai.png',
  imageFormat: '',
}

/** Reports every observed element as on screen so the lazy icons resolve to real images. */
function stubIntersectionObserver() {
  class ImmediateObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }])
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', ImmediateObserver)
}

beforeEach(stubIntersectionObserver)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The rendered sub-row that carries a given list's name. */
const rowFor = (reference: TokenListReference) =>
  screen.getByText(reference.sourceList).closest('div')!

describe('TokenSubRows', () => {
  it('renders nothing when only one list publishes the token', () => {
    // One source is not a branch. Drawing a single-child tree beside every token would
    // add a row of chrome to the majority of the list for no information.
    const { container } = render(<TokenSubRows references={[UNISWAP]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when there are no references at all', () => {
    const { container } = render(<TokenSubRows references={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders one row per list once there is more than one', () => {
    render(<TokenSubRows references={[UNISWAP, BRIDGE, COINGECKO]} />)
    expect(screen.getByText(UNISWAP.sourceList)).toBeTruthy()
    expect(screen.getByText(BRIDGE.sourceList)).toBeTruthy()
    expect(screen.getByText(COINGECKO.sourceList)).toBeTruthy()
  })

  it('gives each row the icon its own list publishes', () => {
    // The failure this exists to catch: rows sharing one icon, or an index slipping by
    // one, so the picture next to a list name belongs to a different list entirely.
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    const images = Array.from(document.querySelectorAll('img'))
    const sources = images.map((image) => image.getAttribute('src'))
    expect(sources).toEqual([UNISWAP.imageUri, BRIDGE.imageUri])
  })

  it('points each row link at that row own image', () => {
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    const links = Array.from(document.querySelectorAll('a'))
    expect(links.map((link) => link.getAttribute('href'))).toEqual([UNISWAP.imageUri, BRIDGE.imageUri])
  })

  it('opens an image link in a new tab without leaking the referrer', () => {
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    const link = document.querySelector('a')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('does not let following an image link collapse the row it sits in', () => {
    // The parent token row toggles this branch on click. Without the stop, opening an
    // image would also shut the branch, so the list you were comparing disappears.
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <TokenSubRows references={[UNISWAP, BRIDGE]} />
      </div>,
    )
    fireEvent.click(document.querySelector('a')!)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('offers the list-editor jump only when the caller can handle it', () => {
    const { container: without } = render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    expect(without.querySelectorAll('button')).toHaveLength(0)

    cleanup()
    const { container: with_ } = render(
      <TokenSubRows references={[UNISWAP, BRIDGE]} onNavigateToList={vi.fn()} />,
    )
    expect(with_.querySelectorAll('button')).toHaveLength(2)
  })

  it('jumps to the list belonging to the row that was clicked', () => {
    // Mixing this up sends the user to the wrong list editor, which looks like the
    // editor loading the wrong data rather than the row pointing at the wrong place.
    const onNavigateToList = vi.fn()
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} onNavigateToList={onNavigateToList} />)

    fireEvent.click(rowFor(BRIDGE).querySelector('button')!)
    expect(onNavigateToList).toHaveBeenCalledWith(BRIDGE.sourceList)
  })

  it('does not let the list-editor jump collapse the row it sits in', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <TokenSubRows references={[UNISWAP, BRIDGE]} onNavigateToList={vi.fn()} />
      </div>,
    )
    fireEvent.click(document.querySelector('button')!)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('labels the image format when the list reported one', () => {
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    expect(rowFor(UNISWAP).textContent).toContain('svg')
    expect(rowFor(BRIDGE).textContent).toContain('png')
  })

  it('omits the format label when the list reported none', () => {
    // An empty badge would read as a format named "" rather than an unknown one.
    render(<TokenSubRows references={[UNISWAP, COINGECKO]} />)
    const spansIn = (reference: TokenListReference) => rowFor(reference).querySelectorAll('span').length
    expect(spansIn(COINGECKO)).toBe(spansIn(UNISWAP) - 1)
  })

  it('distinguishes a scalable icon from a raster one in the format badge', () => {
    // Vector is the outcome the studio steers users toward, so it is the one format the
    // badge highlights rather than greys out.
    render(<TokenSubRows references={[UNISWAP, BRIDGE]} />)
    const vectorBadge = Array.from(rowFor(UNISWAP).querySelectorAll('span')).find(
      (span) => span.textContent === 'svg',
    )!
    const rasterBadge = Array.from(rowFor(BRIDGE).querySelectorAll('span')).find(
      (span) => span.textContent === 'png',
    )!
    expect(vectorBadge.className).toContain('accent')
    expect(rasterBadge.className).not.toContain('accent')
  })
})
