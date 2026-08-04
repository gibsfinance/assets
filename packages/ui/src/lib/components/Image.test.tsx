import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getApiUrl: (path: string) => `https://api.test${path}`,
  }
})

import Image from './Image'

const srcOf = (container: HTMLElement) => container.querySelector('img')!.getAttribute('src')

afterEach(cleanup)

describe('Image', () => {
  // Nothing in the interface asked the image endpoint for a smaller asset, so a
  // 24-pixel row icon downloaded the full stored logo — tens of kilobytes each,
  // hundreds of times over a scrolling list.
  it('requests our own images at the size it renders them', () => {
    const { container } = render(createElement(Image, { src: 'https://api.test/image/eip155-369', size: 24 }))
    expect(srcOf(container)).toBe('https://api.test/image/eip155-369?w=48&h=48&as=webp')
  })

  it('leaves an upstream image URL untouched', () => {
    const upstream = 'https://raw.githubusercontent.com/org/repo/logo.png'
    const { container } = render(createElement(Image, { src: upstream, size: 24 }))
    expect(srcOf(container)).toBe(upstream)
  })

  // The Studio preview can be zoomed past its layout box, so it is the one surface
  // that genuinely needs the stored bytes.
  it('fetches the original when the caller asks for full resolution', () => {
    const { container } = render(
      createElement(Image, { src: 'https://api.test/image/eip155-1', size: 24, fullResolution: true }),
    )
    expect(srcOf(container)).toBe('https://api.test/image/eip155-1')
  })

  it('sizes from explicit width and height when given instead of size', () => {
    const { container } = render(
      createElement(Image, { src: 'https://api.test/image/eip155-1', width: 24, height: 64 }),
    )
    expect(srcOf(container)).toBe('https://api.test/image/eip155-1?w=48&h=128&as=webp')
  })
})

/**
 * Everything the component does after the URL is decided.
 *
 * These paths carry the failure handling — a missing icon is routine in a token list, so
 * the fallback and the load timeout are ordinary operation rather than edge cases. jsdom
 * ships no IntersectionObserver, so lazy mode is driven through a controllable stub.
 */
/** The subset of the fallback's props these tests assert on. */
type SeenFallbackProps = { width?: number; height?: number; src?: string; alt?: string }

describe('Image — loading and failure', () => {
  const SRC = 'https://api.test/image/eip155-1'

  /** Captures the observer so a test can decide when the element scrolls into view. */
  function stubIntersectionObserver() {
    const instances: { trigger: (isIntersecting: boolean) => void; disconnect: () => void }[] = []
    class FakeObserver {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {
        instances.push({
          trigger: (isIntersecting) => this.cb([{ isIntersecting }]),
          disconnect: () => {},
        })
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    return instances
  }

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the image immediately when not lazy', () => {
    const { container } = render(createElement(Image, { src: SRC }))
    expect(container.querySelector('img')).toBeTruthy()
  })

  it('holds the request back until a lazy image scrolls into view', () => {
    // The point of lazy mode: a list of hundreds of icons must not issue hundreds of
    // requests on mount. If the img element exists up front, it has already fetched.
    const observers = stubIntersectionObserver()
    const { container } = render(createElement(Image, { src: SRC, lazy: true }))
    expect(container.querySelector('img')).toBeNull()

    act(() => observers[0].trigger(true))
    expect(container.querySelector('img')).toBeTruthy()
  })

  it('keeps holding while the element stays out of view', () => {
    const observers = stubIntersectionObserver()
    const { container } = render(createElement(Image, { src: SRC, lazy: true }))
    act(() => observers[0].trigger(false))
    expect(container.querySelector('img')).toBeNull()
  })

  it('swaps in the caller fallback when the image errors', () => {
    const { container } = render(
      createElement(Image, {
        src: SRC,
        fallback: (props) => createElement('span', { 'data-testid': 'fb' }, props.alt ?? ''),
        alt: 'DAI',
      }),
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('[data-testid="fb"]')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('hands the fallback the resolved dimensions, not the raw props', () => {
    // The fallback usually draws a placeholder box, so it needs the size actually used
    // after size/width/height are reconciled.
    const seen: SeenFallbackProps[] = []
    const { container } = render(
      createElement(Image, {
        src: SRC,
        size: 32,
        fallback: (props) => {
          seen.push(props)
          return createElement('span')
        },
      }),
    )
    fireEvent.error(container.querySelector('img')!)
    expect(seen[0]).toMatchObject({ width: 32, height: 32, src: SRC })
  })

  it('lets fallbackProps override what the component passes down', () => {
    const seen: SeenFallbackProps[] = []
    const { container } = render(
      createElement(Image, {
        src: SRC,
        size: 32,
        fallbackProps: { width: 99 },
        fallback: (props) => {
          seen.push(props)
          return createElement('span')
        },
      }),
    )
    fireEvent.error(container.querySelector('img')!)
    expect(seen[0]).toMatchObject({ width: 99 })
  })

  it('drops the image and shows nothing when it errors with no fallback given', () => {
    const { container } = render(createElement(Image, { src: SRC }))
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
  })

  it('reports load and error to the caller', () => {
    const onLoad = vi.fn()
    const onError = vi.fn()
    const { container } = render(createElement(Image, { src: SRC, onLoad, onError }))
    fireEvent.load(container.querySelector('img')!)
    expect(onLoad).toHaveBeenCalledTimes(1)

    cleanup()
    const second = render(createElement(Image, { src: SRC, onLoad, onError }))
    fireEvent.error(second.container.querySelector('img')!)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('gives up on an image that never loads or errors', () => {
    // A host that accepts the connection and then stalls would otherwise leave a
    // skeleton shimmering forever, with no error event to react to.
    vi.useFakeTimers()
    const onError = vi.fn()
    render(createElement(Image, { src: SRC, onError }))
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('does not fire the timeout once the image has loaded', () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const { container } = render(createElement(Image, { src: SRC, onError }))
    fireEvent.load(container.querySelector('img')!)
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('hides the skeleton once the image has loaded', () => {
    const { container } = render(createElement(Image, { src: SRC, skeleton: true }))
    const skeleton = container.querySelector('span > div')!
    expect((skeleton as HTMLElement).style.display).not.toBe('none')
    fireEvent.load(container.querySelector('img')!)
    expect((container.querySelector('span > div') as HTMLElement).style.display).toBe('none')
  })

  it('renders no skeleton when it was not asked for', () => {
    const { container } = render(createElement(Image, { src: SRC }))
    expect(container.querySelector('span > div')).toBeNull()
  })

  it('wraps the image in a link when given an href, opened safely', () => {
    const { container } = render(createElement(Image, { src: SRC, href: 'https://example.com' }))
    const anchor = container.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('https://example.com')
    expect(anchor.getAttribute('rel')).toContain('noopener')
    expect(anchor.getAttribute('target')).toBe('_blank')
  })

  it('uses a span rather than an anchor when there is nowhere to go', () => {
    const { container } = render(createElement(Image, { src: SRC }))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('span')).toBeTruthy()
  })
})
