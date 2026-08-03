/**
 * The decorative icon band that runs across the home page.
 *
 * Everything this component does is invisible when it goes wrong, which is why it is
 * worth testing at all. The band is three conveyor rows: each row samples the icon
 * catalog, repeats the sample until one "half" of the strip spans the viewport, then
 * duplicates that half so a `translateX(-50%)` keyframe returns to a pixel-identical
 * frame. Break any link in that chain and the page still renders — you simply get a
 * bare strip on the right, or a visible jump every time the loop wraps, or a band that
 * downloads full-resolution logos.
 *
 * The failures pinned here:
 *  - icons mounted during the first paint, competing with the real content
 *  - a strip that is not an exact double, so the seamless loop is not seamless
 *  - a half narrower than the viewport, which shows through as a bare strip
 *  - the width measurement not following a window resize
 *  - the resize observer and the idle callback surviving unmount
 *  - the per-icon request losing its explicit size and format
 *
 * The companion file `FloatingIcons.test.ts` covers the two exported pure functions;
 * this file covers the component around them. Host application programming interfaces
 * absent from jsdom — `ResizeObserver`, `requestIdleCallback`, `requestAnimationFrame`,
 * element layout metrics — are stubbed at the boundary. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { MockInstance } from 'vitest'
import FloatingIcons from './FloatingIcons'

/** The rows the browser has been asked to observe, with a hook to fire the callback. */
type ObservedElement = { element: Element; notify: () => void }

let observed: ObservedElement[] = []
let disconnectCount = 0
let idleCallbacks: Array<() => void> = []
let cancelledIdleHandles: number[] = []
let frames: FrameRequestCallback[] = []
let widthSpy: MockInstance<() => number>
let scrollWidthSpy: MockInstance<() => number>

/** Report the same layout width for every element, since jsdom measures nothing. */
const setViewportWidth = (width: number) => widthSpy.mockReturnValue(width)

/** Run every animation frame the component has queued. */
const flushFrames = () =>
  act(() => {
    const queued = frames
    frames = []
    for (const frame of queued) frame(0)
  })

/** Let the component out of its idle deferral, the way an idle browser would. */
const becomeIdle = () =>
  act(() => {
    const queued = idleCallbacks
    idleCallbacks = []
    for (const callback of queued) callback()
  })

beforeEach(() => {
  observed = []
  disconnectCount = 0
  idleCallbacks = []
  cancelledIdleHandles = []
  frames = []

  class FakeResizeObserver {
    constructor(private callback: () => void) {}
    observe(element: Element) {
      observed.push({ element, notify: () => this.callback() })
    }
    unobserve() {}
    disconnect() {
      disconnectCount++
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)

  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idleCallbacks.push(callback)
    return idleCallbacks.length
  })
  vi.stubGlobal('cancelIdleCallback', (handle: number) => {
    cancelledIdleHandles.push(handle)
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})

  widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0)
  scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(0)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Mount and let the deferral through, which is the state every visual test needs. */
const mountReady = () => {
  const result = render(<FloatingIcons />)
  becomeIdle()
  return result
}

const rowsOf = (container: HTMLElement) =>
  Array.from(container.firstElementChild!.children) as HTMLElement[]

const iconSourcesIn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('img')).map((img) => img.getAttribute('src')!)

describe('FloatingIcons — deferred mount', () => {
  it('mounts no icons during the first paint', () => {
    // The band is decoration competing with the real page for the same connections.
    // If icons are in the tree before the browser reports idle, the hundreds of image
    // requests are racing the content the visitor actually came for.
    const { container } = render(<FloatingIcons />)
    expect(container.querySelectorAll('img').length).toBe(0)
  })

  it('brings the rows in once the browser reports idle', () => {
    const { container } = mountReady()
    expect(rowsOf(container).length).toBe(3)
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0)
  })

  it('falls back to a timer where the browser has no idle callback', () => {
    // Safari has never shipped requestIdleCallback. Without the fallback the band
    // simply never appears there, and nothing reports an error.
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.stubGlobal('cancelIdleCallback', undefined)
    vi.useFakeTimers()
    const { container } = render(<FloatingIcons />)
    expect(container.querySelectorAll('img').length).toBe(0)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0)
  })

  it('holds its full height before the icons arrive, so nothing shifts when they land', () => {
    // Three rows of 28, 32 and 36 pixels with 4 pixels between them. The container
    // reserves that height while empty; if it did not, the whole page below the band
    // would jump at idle time.
    const { container } = render(<FloatingIcons />)
    const band = container.firstElementChild as HTMLElement
    const emptyHeight = band.style.height
    becomeIdle()
    expect(emptyHeight).toBe('104px')
    expect(band.style.height).toBe(emptyHeight)
  })

  it('cancels the pending idle callback when unmounted before it fires', () => {
    // Navigating away before idle would otherwise leave a callback holding a setState
    // on a component that no longer exists.
    const { unmount } = render(<FloatingIcons />)
    unmount()
    expect(cancelledIdleHandles.length).toBe(1)
    expect(idleCallbacks.length).toBe(1)
  })

  it('hides the whole band from assistive technology', () => {
    // Several hundred untitled duplicate images would otherwise be announced one by one.
    const { container } = mountReady()
    expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true')
  })
})

describe('FloatingIcons — the conveyor strip', () => {
  it('renders each row as an exact double, which is what makes the loop seamless', () => {
    // The keyframe translates by -50%, so the second half must be the first half
    // repeated. An odd or mismatched strip makes the band visibly jump on every wrap.
    const { container } = mountReady()
    for (const row of rowsOf(container)) {
      const sources = iconSourcesIn(row)
      expect(sources.length % 2).toBe(0)
      const half = sources.length / 2
      expect(sources.slice(0, half)).toEqual(sources.slice(half))
    }
  })

  it('injects the keyframe the doubling depends on, exactly once', () => {
    // The -50% in the keyframe and the doubling of the strip are one design: either
    // alone is wrong. Injection is module-level, so a second band must not add a
    // second style element.
    mountReady()
    const conveyorStyles = Array.from(document.head.querySelectorAll('style')).filter((style) =>
      (style.textContent ?? '').includes('@keyframes conveyor'),
    )
    expect(conveyorStyles.length).toBe(1)
    expect(conveyorStyles[0].textContent).toContain('translateX(-50%)')

    cleanup()
    mountReady()
    const afterSecondMount = Array.from(document.head.querySelectorAll('style')).filter((style) =>
      (style.textContent ?? '').includes('@keyframes conveyor'),
    )
    expect(afterSecondMount.length).toBe(1)
  })

  it('keeps the explicit request size through to the rendered element', () => {
    // The band states its own size and format; the generic image component only
    // supplies defaults when the caller has not. If that precedence ever flips, every
    // icon here silently jumps to the shared size ladder and a heavier payload.
    const { container } = mountReady()
    const sources = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src')!)
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).toContain('w=72')
      expect(source).toContain('h=72')
      expect(source).toContain('as=webp')
    }
  })

  it('links each icon to its own image, unresized', () => {
    // The visible icon is the converted thumbnail; the link has to reach the stored
    // asset itself. They are built from one path, and this pins that relationship
    // rather than either URL on its own.
    const { container } = mountReady()
    const anchor = container.querySelector('a')!
    const image = anchor.querySelector('img')!
    expect(image.getAttribute('src')).toBe(`${anchor.getAttribute('href')}?w=72&h=72&as=webp`)
  })

  it('addresses every icon by prefixed chain identifier', () => {
    // The catalog stores bare paths such as /image/1. Emitting them unprefixed makes a
    // non-Ethereum-Virtual-Machine reference indistinguishable from a chain id.
    const { container } = mountReady()
    const anchors = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href')!)
    expect(anchors.length).toBeGreaterThan(0)
    for (const href of anchors) {
      expect(href).toMatch(/\/image\/[a-z0-9]+-[^/]+/)
    }
  })

  it('samples different icons into each row', () => {
    // One shared sample across all three rows would read as three copies of the same
    // band rather than a field of icons.
    const { container } = mountReady()
    const [first, second] = rowsOf(container).map(iconSourcesIn)
    expect(first).not.toEqual(second)
  })
})

describe('FloatingIcons — spanning the viewport', () => {
  it('repeats the sample until one half spans a wide viewport', () => {
    // A half narrower than the viewport leaves bare space on the right the moment the
    // loop translates, and the reverse-direction middle row starts translated, so it
    // shows the gap on the very first paint.
    setViewportWidth(0)
    const narrow = iconSourcesIn(rowsOf(mountReady().container)[0]).length
    cleanup()

    setViewportWidth(3000)
    const wide = iconSourcesIn(rowsOf(mountReady().container)[0]).length
    expect(wide).toBeGreaterThan(narrow)
  })

  it('re-measures when the window resizes, not only on mount', () => {
    // A window dragged from narrow to wide is exactly the case that exposes a strip
    // sized for the old width.
    setViewportWidth(600)
    const { container } = mountReady()
    const before = iconSourcesIn(rowsOf(container)[0]).length

    setViewportWidth(4000)
    act(() => observed.forEach((entry) => entry.notify()))
    expect(iconSourcesIn(rowsOf(container)[0]).length).toBeGreaterThan(before)
  })

  it('observes the band itself rather than something further up the tree', () => {
    const { container } = mountReady()
    expect(observed.length).toBe(1)
    expect(observed[0].element).toBe(container.firstElementChild)
  })

  it('disconnects the resize observer on unmount', () => {
    // An observer left attached to a detached element keeps the whole subtree alive.
    const { unmount } = mountReady()
    unmount()
    expect(disconnectCount).toBeGreaterThan(0)
  })
})

describe('FloatingIcons — row animation', () => {
  it('gives lower rows a shorter cycle, so the band reads as depth rather than one sheet', () => {
    // Duration is derived from content width over a per-row speed. Equal durations
    // would mean the rows move together, which is the thing the three speeds exist to
    // avoid — and it is only visible by watching, never by an error.
    scrollWidthSpy.mockReturnValue(2400)
    const { container } = mountReady()
    flushFrames()
    const durations = rowsOf(container).map((row) => {
      const strip = row.firstElementChild as HTMLElement
      return Number(/conveyor ([\d.]+)s/.exec(strip.style.getPropertyValue('animation'))![1])
    })
    expect(durations[0]).toBeGreaterThan(durations[1])
    expect(durations[1]).toBeGreaterThan(durations[2])
    expect(durations[2]).toBeGreaterThan(0)
  })

  it('runs the middle row against the other two', () => {
    // Opposing directions are what stops the band looking like a single moving sheet.
    scrollWidthSpy.mockReturnValue(2400)
    const { container } = mountReady()
    flushFrames()
    const directions = rowsOf(container).map((row) => {
      const strip = row.firstElementChild as HTMLElement
      return strip.style.getPropertyValue('animation').includes('reverse') ? 'reverse' : 'normal'
    })
    expect(directions).toEqual(['normal', 'reverse', 'normal'])
  })

  it('sets the animation with priority, so no stylesheet can win over it', () => {
    // The rows carry utility classes; an inline value without priority is one class
    // away from being overridden and the band silently stops moving.
    scrollWidthSpy.mockReturnValue(2400)
    const { container } = mountReady()
    flushFrames()
    const strip = rowsOf(container)[0].firstElementChild as HTMLElement
    expect(strip.style.getPropertyPriority('animation')).toBe('important')
  })

  it('scales the cycle with content width so speed stays constant', () => {
    // Twice the strip, twice the duration — that is what keeps a wide viewport moving
    // at the same pixels per second as a narrow one.
    scrollWidthSpy.mockReturnValue(2400)
    const { container: narrow } = mountReady()
    flushFrames()
    const readDuration = (container: HTMLElement) =>
      Number(
        /conveyor ([\d.]+)s/.exec(
          (rowsOf(container)[0].firstElementChild as HTMLElement).style.getPropertyValue('animation'),
        )![1],
      )
    const narrowDuration = readDuration(narrow)
    cleanup()

    scrollWidthSpy.mockReturnValue(4800)
    const { container: wide } = mountReady()
    flushFrames()
    // The duration is rounded to whole seconds, so allow the one second that costs.
    expect(Math.abs(readDuration(wide) - narrowDuration * 2)).toBeLessThanOrEqual(1)
  })

  it('does not animate rows that were never mounted', () => {
    // The animation effect runs against refs; before the idle deferral lets the rows
    // in there is nothing to style, and reaching into a null ref would throw.
    render(<FloatingIcons />)
    expect(() => flushFrames()).not.toThrow()
    expect(frames.length).toBe(0)
  })
})
