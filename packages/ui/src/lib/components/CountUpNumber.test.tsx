/**
 * The counter the landing page uses for its headline totals.
 *
 * It exists to animate a number into view, which makes every one of its failures a quiet
 * one: the element is always present and always holds a number, so a counter that never
 * starts shows a permanent zero, one that stops early shows a plausible-looking wrong
 * total, and one that ignores a changed target shows yesterday's figure as though it were
 * live. None of those throw. The tests below pin the four properties that distinguish a
 * working counter from those three: it waits until it is on screen, it climbs, it lands
 * exactly on the target, and it follows the target when the target moves.
 *
 * jsdom supplies no IntersectionObserver, so scrolling into view is driven through a
 * controllable stub, and the animation is stepped with fake timers rather than waited on —
 * frames are requested through requestAnimationFrame and timed with performance.now, so
 * both are faked alongside the timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import CountUpNumber from './CountUpNumber'

/** One frame of the fake clock, matching the interval fake timers schedule frames on. */
const FRAME = 16

/** Captures each observer so a test decides exactly when the counter scrolls into view. */
function stubIntersectionObserver() {
  const instances: { trigger: (isIntersecting: boolean) => void }[] = []
  class ControllableObserver {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {
      instances.push({ trigger: (isIntersecting) => this.callback([{ isIntersecting }]) })
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', ControllableObserver)
  return instances
}

let observers: { trigger: (isIntersecting: boolean) => void }[]

beforeEach(() => {
  observers = stubIntersectionObserver()
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Scrolls the most recently mounted counter into view. */
const scrollIntoView = () => act(() => observers[observers.length - 1].trigger(true))

const advance = (milliseconds: number) => act(() => void vi.advanceTimersByTime(milliseconds))

/** The number currently on screen, parsed back out of its grouped presentation. */
const valueOf = (container: HTMLElement) => Number(container.querySelector('span')!.textContent!.replace(/\D/g, ''))

const textOf = (container: HTMLElement) => container.querySelector('span')!.textContent

describe('CountUpNumber', () => {
  it('holds at zero until it is scrolled into view', () => {
    // The whole point of the effect is that the climb happens where someone can see it. A
    // counter that starts on mount has finished long before the reader scrolls down to it,
    // and looks like a static number.
    const { container } = render(<CountUpNumber end={500} />)
    expect(valueOf(container)).toBe(0)
    advance(5000)
    expect(valueOf(container)).toBe(0)
  })

  it('stays at zero while the counter remains off screen', () => {
    const { container } = render(<CountUpNumber end={500} />)
    act(() => observers[0].trigger(false))
    advance(5000)
    expect(valueOf(container)).toBe(0)
  })

  it('starts from zero and climbs once it is on screen', () => {
    const { container } = render(<CountUpNumber end={500} />)
    scrollIntoView()
    advance(FRAME)
    const afterOneFrame = valueOf(container)
    expect(afterOneFrame).toBeGreaterThan(0)
    expect(afterOneFrame).toBeLessThan(500)
  })

  it('front-loads the climb, so it is past halfway at half the duration', () => {
    // The easing is deliberately decelerating: most of the distance is covered early and
    // the last stretch settles. A linear ramp would sit at exactly half here, so this
    // catches the easing being dropped or inverted.
    const { container } = render(<CountUpNumber end={1000} duration={2000} />)
    scrollIntoView()
    advance(1000)
    expect(valueOf(container)).toBeGreaterThan(500)
    expect(valueOf(container)).toBeLessThan(1000)
  })

  it('lands exactly on the target and never passes it', () => {
    // Rounding an eased fraction is easy to get wrong at the ends: one frame past the
    // duration would put the number above the real total, which on a landing page is a
    // published figure that is simply false.
    const end = 1234
    const { container } = render(<CountUpNumber end={end} duration={2000} />)
    scrollIntoView()

    const seen: number[] = []
    for (let elapsed = 0; elapsed < 2500; elapsed += FRAME) {
      advance(FRAME)
      seen.push(valueOf(container))
    }

    expect(Math.max(...seen)).toBe(end)
    expect(seen[seen.length - 1]).toBe(end)
    // Never goes backwards on its way there.
    expect(seen.every((value, index) => index === 0 || value >= seen[index - 1])).toBe(true)
  })

  it('stops when it arrives instead of continuing to redraw', () => {
    const { container } = render(<CountUpNumber end={300} duration={1000} />)
    scrollIntoView()
    advance(2000)
    expect(valueOf(container)).toBe(300)
    advance(60_000)
    expect(valueOf(container)).toBe(300)
  })

  it('honours a custom duration rather than the default two seconds', () => {
    const { container } = render(<CountUpNumber end={800} duration={500} />)
    scrollIntoView()
    advance(600)
    expect(valueOf(container)).toBe(800)
  })

  it('does not restart when it scrolls out of view and back in', () => {
    // Re-entering the viewport must not knock a settled total back to zero.
    const { container } = render(<CountUpNumber end={640} duration={1000} />)
    scrollIntoView()
    advance(2000)
    expect(valueOf(container)).toBe(640)

    scrollIntoView()
    advance(FRAME)
    expect(valueOf(container)).toBe(640)
  })

  it('follows a target that changes after it has already counted up', () => {
    // The landing page refetches its metrics, so the target can move under a counter that
    // has already finished. Ignoring the new value leaves a stale total on screen, looking
    // exactly like live data — the failure this component can produce that nobody would
    // ever notice.
    const { container, rerender } = render(<CountUpNumber end={100} duration={1000} />)
    scrollIntoView()
    advance(2000)
    expect(valueOf(container)).toBe(100)

    rerender(<CountUpNumber end={900} duration={1000} />)
    advance(2000)
    expect(valueOf(container)).toBe(900)
  })

  it('redirects to a new target that arrives mid-climb, without snapping back to zero', () => {
    const { container, rerender } = render(<CountUpNumber end={1000} duration={2000} />)
    scrollIntoView()
    advance(400)
    const beforeChange = valueOf(container)
    expect(beforeChange).toBeGreaterThan(0)

    rerender(<CountUpNumber end={2000} duration={2000} />)
    advance(FRAME)
    // It continues from where the number already was rather than restarting the climb.
    expect(valueOf(container)).toBeGreaterThanOrEqual(beforeChange)

    advance(3000)
    expect(valueOf(container)).toBe(2000)
  })

  it('counts down when the new target is lower than the number on screen', () => {
    const { container, rerender } = render(<CountUpNumber end={5000} duration={1000} />)
    scrollIntoView()
    advance(2000)
    expect(valueOf(container)).toBe(5000)

    rerender(<CountUpNumber end={20} duration={1000} />)
    advance(2000)
    expect(valueOf(container)).toBe(20)
  })

  it('shows a plain zero for a zero target', () => {
    // A metric of zero is a legitimate answer — an empty database, a chain with no tokens —
    // and it must be distinguishable from the counter having failed to start.
    const { container } = render(<CountUpNumber end={0} />)
    scrollIntoView()
    advance(3000)
    expect(textOf(container)).toBe('0')
  })

  it('groups a very large total so it stays readable', () => {
    // These totals run into the millions. Rendered ungrouped they are an unreadable digit
    // run, which is the reason the component formats rather than printing the raw number.
    const end = 1_234_567
    const { container } = render(<CountUpNumber end={end} duration={1000} />)
    scrollIntoView()
    advance(2000)
    expect(textOf(container)).toBe(end.toLocaleString())
    expect(textOf(container)).not.toBe(String(end))
  })

  it('passes its class name through to the rendered element', () => {
    const { container } = render(<CountUpNumber end={1} className="text-gradient-green" />)
    expect(container.querySelector('span')!.className).toBe('text-gradient-green')
  })
})
