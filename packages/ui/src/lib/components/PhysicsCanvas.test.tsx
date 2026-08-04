/**
 * The full-viewport canvas of drifting token and network icons behind the home page.
 *
 * It is the only component that owns an animation loop, a device-pixel-ratio backing
 * store, and four listeners at once, and every one of those fails silently: a loop that
 * is never cancelled keeps stepping physics for the lifetime of the tab, a backing store
 * that misses a resize renders blurred or clipped, a canvas that forgets to opt out of
 * pointer events makes the entire page unclickable, and a reduced-motion visitor sees
 * only whatever happened to be drawn at the moment the component gave up on animating.
 *
 * The physics itself is covered in `src/lib/physics`; this file covers the wiring around
 * it — what reaches the drawing context, what happens on resize, scroll and pointer
 * movement, and what is released on unmount. Assertions are on direction and
 * relationship rather than particular coordinates, matching the physics tests, because
 * the field is built from a random draw.
 *
 * jsdom supplies no drawing context, no useful animation frames, no layout and no image
 * loading, so those host application programming interfaces are replaced with recording
 * stand-ins, and the network is stubbed. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import PhysicsCanvas from './PhysicsCanvas'

// ---------------------------------------------------------------------------
// Recording drawing context
// ---------------------------------------------------------------------------

type DrawCall = { method: string; args: unknown[] }
/** One drawn icon, reduced to the centre point and diameter the component asked for. */
type DrawnIcon = { x: number; y: number; size: number; alpha: number }

let calls: DrawCall[] = []
let alpha = 1

/** Records every call so tests can assert on what was drawn, in what order. */
function createRecordingContext() {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
    }
  return {
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    arc: record('arc'),
    closePath: record('closePath'),
    clip: record('clip'),
    setTransform: record('setTransform'),
    // Recorded with the alpha in force, since that is set on the context rather
    // than passed as an argument.
    drawImage: (...args: unknown[]) => {
      calls.push({ method: 'drawImage', args: [...args, alpha] })
    },
    get globalAlpha() {
      return alpha
    },
    set globalAlpha(value: number) {
      alpha = value
    },
  }
}

const iconsFrom = (drawCalls: DrawCall[]): DrawnIcon[] =>
  drawCalls
    .filter((call) => call.method === 'drawImage')
    .map((call) => {
      const [, x, y, size, , drawnAlpha] = call.args as [unknown, number, number, number, number, number]
      return { x: x + size / 2, y: y + size / 2, size, alpha: drawnAlpha }
    })

/** Everything drawn so far. */
const allDrawnIcons = () => iconsFrom(calls)

/** Only what the most recent frame drew — a frame begins with the clear. */
const lastFrameIcons = () => {
  const lastClear = calls.map((call) => call.method).lastIndexOf('clearRect')
  return iconsFrom(lastClear === -1 ? calls : calls.slice(lastClear))
}

const meanY = (icons: DrawnIcon[]) => icons.reduce((sum, icon) => sum + icon.y, 0) / icons.length

/**
 * Match icons between two frames by diameter.
 *
 * Each icon draws its own size, so the diameter identifies it across frames and across
 * two runs seeded identically. Matching matters because the edge fade removes icons
 * from a frame entirely: pushing the field downward drops the lowest icons out of the
 * drawn set, and an unmatched average would then read as the field moving *up*.
 */
const pairByIcon = (before: DrawnIcon[], after: DrawnIcon[]) => {
  const byDiameter = new Map(after.map((icon) => [icon.size, icon]))
  return before.flatMap((icon) => {
    const match = byDiameter.get(icon.size)
    return match ? [{ before: icon, after: match }] : []
  })
}

/** Mean vertical movement of the icons the two frames have in common. */
const meanVerticalShift = (before: DrawnIcon[], after: DrawnIcon[]) => {
  const pairs = pairByIcon(before, after)
  expect(pairs.length).toBeGreaterThan(20)
  return pairs.reduce((sum, pair) => sum + (pair.after.y - pair.before.y), 0) / pairs.length
}

const distanceSum = (icons: DrawnIcon[], pointerX: number, pointerY: number) =>
  icons.reduce((sum, icon) => sum + Math.hypot(icon.x - pointerX, icon.y - pointerY), 0)

// ---------------------------------------------------------------------------
// Animation frames, driven by hand
// ---------------------------------------------------------------------------

let pendingFrames: Map<number, FrameRequestCallback>
let nextFrameHandle = 0
let cancelledFrames: number[] = []

/** Run every frame the component currently has outstanding. */
const step = (times = 1) => {
  for (let i = 0; i < times; i++) {
    const queued = [...pendingFrames.values()]
    pendingFrames.clear()
    act(() => {
      for (const callback of queued) callback(0)
    })
  }
}

// ---------------------------------------------------------------------------
// Image loading, which jsdom never performs
// ---------------------------------------------------------------------------

let requestedImages: FakeImage[] = []

class FakeImage {
  crossOrigin = ''
  onload: (() => void) | null = null
  private source = ''
  set src(value: string) {
    this.source = value
    requestedImages.push(this)
    // Resolve on a microtask, so the component still gets to assign `onload` on
    // the line after `src` — exactly the window a browser allows it.
    void Promise.resolve().then(() => this.onload?.())
  }
  get src() {
    return this.source
  }
}

const requestedSources = () => requestedImages.map((image) => image.src)

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Networks the metrics endpoints will report. Raised in the sampling tests. */
let networkCount = 12
/** Provider keys whose token list responds with a failure status. */
let failingProviders: string[] = []
/** Provider keys whose token list responds with a body carrying no tokens. */
let emptyProviders: string[] = []
/** Whether the provider list itself comes back with an unusable entry. */
let malformedProviderList = false

const networksBody = () =>
  Array.from({ length: networkCount }, (_unused, index) => ({
    chainId: String(index + 1),
    chainIdentifier: `eip155-${index + 1}`,
    type: 'evm',
    name: `Network ${index + 1}`,
    imageHash: '0xabc',
  }))

const providersBody = [
  { providerKey: 'alpha', name: 'Alpha' },
  { providerKey: 'beta', name: 'Beta' },
]

/** Addresses carry the provider's initial so a test can tell whose tokens landed. */
const tokensBody = (providerKey: string) => ({
  tokens: Array.from({ length: 4 }, (_unused, index) => ({
    chainId: 369,
    address: `0x${providerKey[0].repeat(39)}${index}`,
  })),
})

let fetchedUrls: string[] = []

const stubFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input)
      fetchedUrls.push(url)
      if (url.includes('/networks')) return { ok: true, json: async () => networksBody() } as unknown as Response
      if (url.includes('/stats')) return { ok: true, json: async () => [] } as unknown as Response
      const listMatch = /\/list\/(.+)$/.exec(url)
      if (listMatch) {
        const providerKey = listMatch[1]
        if (failingProviders.includes(providerKey)) {
          return { ok: false, json: async () => ({}) } as unknown as Response
        }
        if (emptyProviders.includes(providerKey)) {
          return { ok: true, json: async () => ({}) } as unknown as Response
        }
        return { ok: true, json: async () => tokensBody(providerKey) } as unknown as Response
      }
      const providers = malformedProviderList ? [null, ...providersBody] : providersBody
      return { ok: true, json: async () => providers } as unknown as Response
    }),
  )

// ---------------------------------------------------------------------------
// Deterministic randomness — the field comes out of Math.random, and two runs
// have to start from the same field for a directional comparison to mean anything.
// ---------------------------------------------------------------------------

let seed = 1
const seededRandom = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const resetRandom = () => {
  seed = 1
}

// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 1200
const VIEWPORT_HEIGHT = 800
const PIXEL_RATIO = 2

const setViewport = (width: number, height: number) => {
  vi.stubGlobal('innerWidth', width)
  vi.stubGlobal('innerHeight', height)
}

let reducedMotion = false
/** One client per test, shared by every mount in it, so a second mount sees the same lists. */
let queryClient: QueryClient

beforeEach(() => {
  calls = []
  alpha = 1
  pendingFrames = new Map()
  nextFrameHandle = 0
  cancelledFrames = []
  requestedImages = []
  fetchedUrls = []
  reducedMotion = false
  networkCount = 12
  failingProviders = []
  emptyProviders = []
  malformedProviderList = false
  resetRandom()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  vi.spyOn(Math, 'random').mockImplementation(seededRandom)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => createRecordingContext() as unknown as CanvasRenderingContext2D,
  )

  setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  vi.stubGlobal('devicePixelRatio', PIXEL_RATIO)
  vi.stubGlobal('scrollY', 0)
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrameHandle += 1
    pendingFrames.set(nextFrameHandle, callback)
    return nextFrameHandle
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    cancelledFrames.push(handle)
    pendingFrames.delete(handle)
  })
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

/** Mount and wait until the field exists and its images have attached. */
const mountCanvas = async () => {
  requestedImages = []
  const result = render(<PhysicsCanvas />, { wrapper })
  await waitFor(() => expect(requestedImages.length).toBeGreaterThan(0))
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

/** Mount and let the lists settle without requiring that any icon was built. */
const mountEmptyCanvas = async () => {
  const result = render(<PhysicsCanvas />, { wrapper })
  await waitFor(() => expect(fetchedUrls.some((url) => url.includes('/networks'))).toBe(true))
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return result
}

const canvasOf = (container: HTMLElement) => container.querySelector('canvas')!

const fireResize = () => act(() => void window.dispatchEvent(new Event('resize')))

const fireScrollTo = (position: number) =>
  act(() => {
    vi.stubGlobal('scrollY', position)
    window.dispatchEvent(new Event('scroll'))
  })

const fireMouseMove = (x: number, y: number) =>
  act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y })))

describe('PhysicsCanvas — the element itself', () => {
  it('never intercepts a click meant for the page behind it', async () => {
    // The canvas covers the entire viewport. Without the pointer-events opt-out
    // every link and button on the home page becomes unclickable, and nothing about
    // the page looks wrong.
    const { container } = await mountCanvas()
    const canvas = canvasOf(container)
    expect(canvas.className).toContain('pointer-events-none')
    expect(canvas.className).toContain('fixed')
    expect(canvas.className).toContain('inset-0')
  })

  it('hides the decoration from assistive technology', async () => {
    const { container } = await mountCanvas()
    expect(canvasOf(container).getAttribute('aria-hidden')).toBe('true')
  })

  it('sizes the backing store in device pixels and the element in layout pixels', async () => {
    // The two sizes are what keep the drawing sharp on a high-density display. Setting
    // only one of them is the classic blurred-canvas bug, and it renders perfectly on
    // the ratio-one display most development happens on.
    const { container } = await mountCanvas()
    const canvas = canvasOf(container)
    expect(canvas.width).toBe(VIEWPORT_WIDTH * PIXEL_RATIO)
    expect(canvas.height).toBe(VIEWPORT_HEIGHT * PIXEL_RATIO)
    expect(canvas.style.width).toBe(`${VIEWPORT_WIDTH}px`)
    expect(canvas.style.height).toBe(`${VIEWPORT_HEIGHT}px`)
  })

  it('scales the coordinate system by the same ratio it inflated the buffer by', async () => {
    // Physics works in layout pixels. Without the matching transform the whole field
    // is drawn into the top-left quarter of a high-density canvas.
    await mountCanvas()
    const transforms = calls.filter((call) => call.method === 'setTransform')
    expect(transforms.length).toBeGreaterThan(0)
    expect(transforms[transforms.length - 1].args).toEqual([PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0])
  })

  it('resizes the backing store when the window resizes', async () => {
    // A canvas sized once at mount is stretched by the browser after any resize,
    // which shows up as blur rather than as an error.
    const { container } = await mountCanvas()
    setViewport(700, 500)
    fireResize()
    const canvas = canvasOf(container)
    expect(canvas.width).toBe(700 * PIXEL_RATIO)
    expect(canvas.height).toBe(500 * PIXEL_RATIO)
    expect(canvas.style.width).toBe('700px')
  })
})

describe('PhysicsCanvas — the animation loop', () => {
  it('schedules the next frame from inside the current one', async () => {
    await mountCanvas()
    expect(pendingFrames.size).toBe(1)
    step()
    expect(pendingFrames.size).toBe(1)
  })

  it('cancels the outstanding frame on unmount', async () => {
    // This is the leak the component is most likely to spring: an uncancelled loop
    // keeps stepping seventy icons and drawing to a detached canvas forever, and the
    // only symptom is a warm laptop.
    const { unmount } = await mountCanvas()
    const outstanding = [...pendingFrames.keys()]
    unmount()
    expect(cancelledFrames).toEqual(expect.arrayContaining(outstanding))
    expect(pendingFrames.size).toBe(0)
  })

  it('draws nothing more once unmounted', async () => {
    const { unmount } = await mountCanvas()
    unmount()
    calls = []
    step(3)
    expect(calls.length).toBe(0)
  })

  it('releases its window listeners on unmount', async () => {
    // Listeners that outlive the component keep writing into refs it still closes
    // over, so the whole detached tree stays reachable.
    const { unmount } = await mountCanvas()
    unmount()
    calls = []
    fireResize()
    fireScrollTo(400)
    fireMouseMove(10, 10)
    expect(calls.length).toBe(0)
  })

  it('clears the whole canvas before each frame', async () => {
    // Without the clear, every frame smears the previous one across the page.
    await mountCanvas()
    calls = []
    step()
    const clears = calls.filter((call) => call.method === 'clearRect')
    expect(clears.length).toBe(1)
    expect(clears[0].args).toEqual([0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT])
  })

  it('clips every icon to a circle inside a saved state', async () => {
    // Stored logos are square. Drawing one without the circular clip, or leaking the
    // clip past a restore, is visible on the page but silent everywhere else.
    await mountCanvas()
    calls = []
    step()
    const methods = calls.map((call) => call.method)
    const drawn = methods.filter((method) => method === 'drawImage').length
    expect(drawn).toBeGreaterThan(0)
    expect(methods.filter((method) => method === 'save').length).toBe(drawn)
    expect(methods.filter((method) => method === 'restore').length).toBe(drawn)
    expect(methods.filter((method) => method === 'clip').length).toBe(drawn)
    const firstDraw = methods.indexOf('drawImage')
    expect(methods.slice(firstDraw - 5, firstDraw)).toEqual(['save', 'beginPath', 'arc', 'closePath', 'clip'])
  })

  it('gives each icon its own alpha and hands the context back at full opacity', async () => {
    // The context is shared state. A frame that ends part-transparent tints whatever
    // is drawn next, and the icons themselves have to fade independently for the
    // depth to read.
    await mountCanvas()
    calls = []
    step()
    const drawn = lastFrameIcons()
    expect(drawn.length).toBeGreaterThan(1)
    for (const icon of drawn) {
      expect(icon.alpha).toBeGreaterThan(0)
      expect(icon.alpha).toBeLessThanOrEqual(1)
    }
    expect(new Set(drawn.map((icon) => icon.alpha)).size).toBeGreaterThan(1)
    expect(alpha).toBe(1)
  })

  it('skips icons the edge fade has taken to nothing', async () => {
    // Fully transparent icons still cost a clip and a draw each. The field is seventy
    // icons a frame, so the ones at the edges are worth not drawing at all.
    await mountCanvas()
    calls = []
    step()
    expect(lastFrameIcons().length).toBeLessThan(70)
  })
})

describe('PhysicsCanvas — staying inside the viewport', () => {
  it('keeps every drawn icon within the canvas it is drawing to', async () => {
    // An icon that escapes is not clipped or wrapped — it is simply drawn outside the
    // visible area and disappears from the field for good.
    await mountCanvas()
    step(40)
    for (const icon of lastFrameIcons()) {
      expect(icon.x).toBeGreaterThanOrEqual(0)
      expect(icon.x).toBeLessThanOrEqual(VIEWPORT_WIDTH)
      expect(icon.y).toBeGreaterThanOrEqual(0)
      expect(icon.y).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
    }
  })

  it('pulls the field back inside a window that has shrunk', async () => {
    // Resizing has to update the bounds the physics runs against, not only the canvas
    // buffer. If only the buffer follows, two thirds of the field is stranded outside
    // the visible area and never returns.
    await mountCanvas()
    step(5)
    setViewport(500, 400)
    fireResize()
    step(60)
    const drawn = lastFrameIcons()
    expect(drawn.length).toBeGreaterThan(0)
    for (const icon of drawn) {
      expect(icon.x).toBeLessThanOrEqual(500)
      expect(icon.y).toBeLessThanOrEqual(400)
    }
  })
})

describe('PhysicsCanvas — pointer', () => {
  it('pushes the field away from the pointer', async () => {
    // Two runs from the same seed differ only in whether the pointer moved, so the
    // comparison isolates the repulsion from the drift the field has anyway.
    await mountCanvas()
    step()
    const undisturbed = distanceSum(lastFrameIcons(), 600, 400)
    cleanup()

    calls = []
    resetRandom()
    await mountCanvas()
    fireMouseMove(600, 400)
    step()
    expect(distanceSum(lastFrameIcons(), 600, 400)).toBeGreaterThan(undisturbed)
  })

  it('forgets the pointer once it leaves the document', async () => {
    // A pointer position left behind would hold a permanent hole in the field at
    // wherever the cursor happened to exit.
    await mountCanvas()
    step()
    const undisturbed = lastFrameIcons()
    cleanup()

    calls = []
    resetRandom()
    await mountCanvas()
    fireMouseMove(600, 400)
    act(() => void document.dispatchEvent(new MouseEvent('mouseleave')))
    step()
    expect(lastFrameIcons()).toEqual(undisturbed)
  })
})

describe('PhysicsCanvas — scroll', () => {
  it('carries the field along with a downward scroll', async () => {
    // Two runs from one seed, differing only in the scroll, so the comparison isolates
    // the scroll force from the drift the field has anyway.
    await mountCanvas()
    step()
    const undisturbed = lastFrameIcons()
    cleanup()

    calls = []
    resetRandom()
    await mountCanvas()
    fireScrollTo(100)
    step()
    expect(meanVerticalShift(undisturbed, lastFrameIcons())).toBeGreaterThan(0)
  })

  it('reads scrolling as a delta, so scrolling back undoes it', async () => {
    // Reading window.scrollY as an absolute would make every frame at the bottom of a
    // long page shove the whole field downward forever.
    await mountCanvas()
    step()
    const undisturbed = lastFrameIcons()
    cleanup()

    calls = []
    resetRandom()
    await mountCanvas()
    fireScrollTo(100)
    fireScrollTo(0)
    step()
    expect(lastFrameIcons()).toEqual(undisturbed)
  })

  it('spends a scroll delta on one frame rather than on every frame after it', async () => {
    // The accumulator has to be cleared as it is consumed. Left in place, one flick of
    // the wheel keeps adding the same force every frame and the field accelerates off
    // the bottom of the screen — the displacement would compound rather than stay
    // linear in the number of frames.
    await mountCanvas()
    step()
    const undisturbedFirst = lastFrameIcons()
    step(4)
    const undisturbedFifth = lastFrameIcons()
    cleanup()

    calls = []
    resetRandom()
    await mountCanvas()
    fireScrollTo(100)
    step()
    const scrolledFirst = lastFrameIcons()
    step(4)
    const scrolledFifth = lastFrameIcons()

    const afterOneFrame = meanVerticalShift(undisturbedFirst, scrolledFirst)
    const afterFiveFrames = meanVerticalShift(undisturbedFifth, scrolledFifth)
    expect(afterOneFrame).toBeGreaterThan(0)
    // Five frames of a spent delta drift roughly five times as far as one. Five frames
    // of an unspent one would be fifteen times as far.
    expect(afterFiveFrames).toBeLessThan(afterOneFrame * 8)
  })
})

describe('PhysicsCanvas — reduced motion', () => {
  beforeEach(() => {
    reducedMotion = true
  })

  it('never starts the loop for a visitor who asked for less motion', async () => {
    await mountCanvas()
    expect(pendingFrames.size).toBe(0)
    step(5)
    expect(pendingFrames.size).toBe(0)
  })

  it('still draws the field, as a still frame', async () => {
    // Reduced motion means no movement, not no decoration. The static frame used to be
    // drawn before the icons had loaded, which left the canvas permanently blank.
    await mountCanvas()
    expect(allDrawnIcons().length).toBeGreaterThan(0)
  })

  it('redraws the still frame after a resize, which clears the canvas', async () => {
    // Assigning to canvas.width wipes the buffer. With no loop to put the field back,
    // one resize is enough to leave the page blank until it is reloaded.
    await mountCanvas()
    calls = []
    setViewport(900, 700)
    fireResize()
    expect(allDrawnIcons().length).toBeGreaterThan(0)
  })
})

describe('PhysicsCanvas — building the field', () => {
  it('addresses every icon by canonical chain identifier', async () => {
    // A bare number cannot say which namespace it belongs to, so the same 501 can mean
    // two different chains. Every source the field builds has to carry the prefix.
    await mountCanvas()
    const sources = requestedSources()
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source).toMatch(/\/image\/[a-z0-9]+-\d+(\/0x[0-9a-f]+)?$/)
    }
  })

  it('mixes token icons in with the network icons', async () => {
    // Networks alone are a few dozen identical-looking chain logos. The token images
    // are what make the field look like the catalog it is advertising.
    await mountCanvas()
    const sources = requestedSources()
    expect(sources.some((source) => /\/image\/eip155-\d+$/.test(source))).toBe(true)
    expect(sources.some((source) => source.includes('/image/eip155-369/0x'))).toBe(true)
  })

  it('samples a bounded number of networks rather than one icon per chain', async () => {
    // The catalog has hundreds of networks and the field holds seventy icons. Taking
    // them all would build a source list most of which is never used, and would make
    // the field a slice of the alphabet rather than a mixture.
    networkCount = 30
    await mountCanvas()
    const networkSources = new Set(requestedSources().filter((source) => /\/image\/eip155-\d+$/.test(source)))
    expect(networkSources.size).toBe(25)
  })

  it('drops a provider whose token list fails and keeps the rest', async () => {
    // One provider being down must not take the whole field with it.
    failingProviders = ['beta']
    await mountCanvas()
    const sources = requestedSources()
    expect(sources.some((source) => source.includes('0xaaa'))).toBe(true)
    expect(sources.some((source) => source.includes('0xbbb'))).toBe(false)
    expect(sources.some((source) => /\/image\/eip155-\d+$/.test(source))).toBe(true)
  })

  it('keeps the field when a provider answers without a token list', async () => {
    // An empty or reshaped body is a server change, not a crash: the field should thin
    // out to the network icons rather than throw during the read.
    emptyProviders = ['alpha', 'beta']
    await mountCanvas()
    expect(requestedSources().every((source) => /\/image\/eip155-\d+$/.test(source))).toBe(true)
    expect(requestedImages.length).toBeGreaterThan(0)
  })

  it('keeps the field when the provider list itself is malformed', async () => {
    // The provider list is read straight out of a response body. One null entry would
    // otherwise throw inside the effect and take the whole canvas down with it.
    malformedProviderList = true
    await mountCanvas()
    expect(requestedImages.length).toBeGreaterThan(0)
  })

  it('assumes a ratio of one when the browser reports no pixel density', async () => {
    // Reading the ratio as undefined would make the backing store NaN wide, which is a
    // canvas that silently draws nothing at all.
    vi.stubGlobal('devicePixelRatio', undefined)
    const { container } = await mountCanvas()
    expect(canvasOf(container).width).toBe(VIEWPORT_WIDTH)
    expect(canvasOf(container).style.width).toBe(`${VIEWPORT_WIDTH}px`)
  })

  it('draws nothing at all when there are too few distinct icons to fill a field', async () => {
    // Seventy copies of three icons reads as a bug rather than as decoration, so the
    // component would rather show nothing.
    networkCount = 3
    failingProviders = ['alpha', 'beta']
    const { container } = await mountEmptyCanvas()
    step(3)
    expect(requestedImages.length).toBe(0)
    expect(allDrawnIcons().length).toBe(0)
    // The canvas is still mounted and sized — only the field is empty.
    expect(canvasOf(container).width).toBe(VIEWPORT_WIDTH * PIXEL_RATIO)
  })
})
