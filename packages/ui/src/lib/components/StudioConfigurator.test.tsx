/**
 * Behavioral tests for StudioConfigurator.
 *
 * Why: the configurator's toolbar is the primary way a user shapes a token
 * preview — size (with an aspect-ratio link), padding, shape, border radius,
 * shadow and background colour, plus the badge / resolution-order / code
 * popovers. Each control writes through `useStudio()` into shared context that
 * the canvas and code generators read back. These tests assert the wiring end
 * to end: an interaction with a toolbar control must produce the matching,
 * observable change in context state — proving the control "does its job"
 * rather than merely rendering.
 *
 * Several controls live behind Headless UI menus / popovers, which mount their
 * panels lazily on click; the tests open the relevant panel first, then act on
 * the control inside it.
 *
 * Observation strategy: a sibling "probe" reads the live appearance / badge
 * slices from context and serialises them into the DOM, so assertions run
 * against the real shared value rather than a spy.
 *
 * Environment shims: this component pulls in ThemeProvider (needs
 * window.matchMedia) and a CodePanel that measures itself with ResizeObserver —
 * neither exists in the default jsdom, so both are stubbed at the network/host
 * boundary in beforeEach. No application source is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import StudioConfigurator from './StudioConfigurator'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import type { Token } from '../types'

// ---------------------------------------------------------------------------
// Deterministic API base, so the image address assertions below check a fixed
// string rather than whatever PUBLIC_BASE_URL happens to resolve to under
// Vitest. Only getApiUrl is overridden; everything else in ../utils passes
// through untouched. Mirrors the pattern already used in StudioBrowser.test.tsx.
// ---------------------------------------------------------------------------
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getApiUrl: (path: string) => `https://api.test${path}`,
  }
})

// ---------------------------------------------------------------------------
// Probe: surfaces the live appearance slice from context
// ---------------------------------------------------------------------------

function AppearanceProbe() {
  const { appearance, badge } = useStudio()
  return (
    <div>
      <pre data-testid="appearance">{JSON.stringify(appearance)}</pre>
      <pre data-testid="badge">{JSON.stringify(badge)}</pre>
    </div>
  )
}

/** A token on PulseChain, used by every test that needs a preview on the canvas. */
const TEST_TOKEN: Token = {
  chainId: 369,
  chainIdentifier: 'eip155-369',
  address: '0x95b303987a60c71504d99aa1b13b4da07b0790a',
  name: 'Test Token',
  symbol: 'TEST',
  decimals: 18,
  hasIcon: true,
  sourceList: 'test-list',
}

/**
 * Action buttons that reach into context the same way a real control does, so
 * tests can put the studio into a state (a selected token, a resolution
 * order, a badge configuration) without depending on the exact toolbar
 * interaction that a differently-scoped test already covers.
 */
function StudioActions() {
  const { selectToken, setResolutionOrder, updateBadge } = useStudio()
  return (
    <div>
      <button type="button" onClick={() => selectToken(TEST_TOKEN)}>
        select test token
      </button>
      <button type="button" onClick={() => setResolutionOrder(['coingecko', 'trustwallet'])}>
        set resolution order
      </button>
      <button type="button" onClick={() => setResolutionOrder(null)}>
        clear resolution order
      </button>
      <button
        type="button"
        onClick={() => updateBadge({ enabled: true, ringEnabled: false, badgePadding: 0 })}
      >
        enable badge without ring or padding
      </button>
      <button
        type="button"
        onClick={() =>
          updateBadge({ enabled: true, ringEnabled: true, ringThickness: 5, badgePadding: 3 })
        }
      >
        enable badge with ring and padding
      </button>
    </div>
  )
}

function renderConfigurator() {
  return render(
    <ThemeProvider>
      <StudioProvider>
        <StudioConfigurator />
        <AppearanceProbe />
        <StudioActions />
      </StudioProvider>
    </ThemeProvider>,
  )
}

function readAppearance(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('appearance').textContent ?? '{}')
}

function readBadge(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('badge').textContent ?? '{}')
}

// ---------------------------------------------------------------------------
// Environment shims (host-API boundary, not application source)
// ---------------------------------------------------------------------------

/**
 * One captured ResizeObserver stub instance: keeps the callback the component
 * registered and a spy on disconnect, so a test can drive a resize manually
 * and confirm the observer is torn down on unmount. Reset before every test.
 */
interface CapturedResizeObserver {
  callback: ResizeObserverCallback
  observedElement: Element | null
  disconnect: ReturnType<typeof vi.fn>
}

let resizeObserverInstances: CapturedResizeObserver[] = []

/** Invokes the most recently created ResizeObserver's callback with one content height. */
function triggerResize(height: number) {
  const observer = resizeObserverInstances[resizeObserverInstances.length - 1]
  const entry = { contentRect: { height } } as ResizeObserverEntry
  // A real ResizeObserver fires asynchronously, outside of any React event
  // handler, so the resulting setState has to be wrapped in `act` by hand for
  // the DOM update to be visible before the next assertion runs.
  act(() => {
    observer.callback([entry], observer as unknown as ResizeObserver)
  })
}

beforeEach(() => {
  localStorage.clear()
  resizeObserverInstances = []

  // ThemeProvider reads the OS colour-scheme preference on mount
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )

  // CodePanel measures its content with a ResizeObserver. This stub records
  // every instance so a test can trigger its callback directly and confirm
  // its disconnect method actually runs, rather than only stubbing the
  // constructor away so CodePanel does not crash.
  class ResizeObserverStub implements CapturedResizeObserver {
    callback: ResizeObserverCallback
    observedElement: Element | null = null
    disconnect = vi.fn()

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      resizeObserverInstances.push(this)
    }

    observe(element: Element) {
      this.observedElement = element
    }

    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Size control + aspect-ratio link
// ---------------------------------------------------------------------------

describe('size control', () => {
  it('renders the width and height steppers seeded from the default appearance', () => {
    renderConfigurator()
    // Width stepper is labelled "W", height "H"; both default to 64
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    const values = inputs.map((input) => input.value)
    expect(values).toContain('64')
    expect(readAppearance().width).toBe(64)
    expect(readAppearance().height).toBe(64)
  })

  it('keeps width and height in lockstep while the aspect ratio is linked (default)', () => {
    renderConfigurator()
    // The aspect-link starts linked; changing the width input also moves height.
    const widthInput = findStepperInput('64', 0)
    fireEvent.change(widthInput, { target: { value: '128' } })
    expect(readAppearance().width).toBe(128)
    expect(readAppearance().height).toBe(128)
  })

  it('decouples width from height after the aspect link is toggled off', () => {
    renderConfigurator()
    // Toggle the link off, then change width only — height must stay put.
    fireEvent.click(screen.getByLabelText('Unlink aspect ratio'))
    const widthInput = findStepperInput('64', 0)
    fireEvent.change(widthInput, { target: { value: '200' } })
    expect(readAppearance().width).toBe(200)
    expect(readAppearance().height).toBe(64)
  })

  it('clamps the width stepper to its maximum of 512', () => {
    renderConfigurator()
    const widthInput = findStepperInput('64', 0)
    fireEvent.change(widthInput, { target: { value: '9999' } })
    expect(readAppearance().width).toBe(512)
  })

  it('clamps the width stepper to its minimum of 16', () => {
    renderConfigurator()
    // unlink so the change targets width only and we read a clean clamp
    fireEvent.click(screen.getByLabelText('Unlink aspect ratio'))
    const widthInput = findStepperInput('64', 0)
    fireEvent.change(widthInput, { target: { value: '1' } })
    expect(readAppearance().width).toBe(16)
  })

  // The height stepper mirrors the width one exactly (its own aspect-linked
  // branch), but nothing above drives it — every prior test changes width.
  // A regression that broke handleHeightChange specifically (as opposed to
  // handleWidthChange) would pass every test above and still ship broken.
  it('keeps width and height in lockstep when the HEIGHT input changes while linked', () => {
    renderConfigurator()
    const heightInput = findStepperInput('64', 1)
    fireEvent.change(heightInput, { target: { value: '128' } })
    expect(readAppearance().height).toBe(128)
    expect(readAppearance().width).toBe(128)
  })

  it('decouples height from width after the aspect link is toggled off', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Unlink aspect ratio'))
    const heightInput = findStepperInput('64', 1)
    fireEvent.change(heightInput, { target: { value: '200' } })
    expect(readAppearance().height).toBe(200)
    expect(readAppearance().width).toBe(64)
  })
})

/**
 * The size + padding steppers all render an identical text input. We locate
 * one by its current value and ordinal position among inputs that hold it.
 */
function findStepperInput(currentValue: string, ordinal: number): HTMLInputElement {
  const matches = (screen.getAllByRole('textbox') as HTMLInputElement[]).filter(
    (input) => input.value === currentValue,
  )
  return matches[ordinal]
}

// ---------------------------------------------------------------------------
// Padding control
// ---------------------------------------------------------------------------

describe('padding control', () => {
  it('writes the padding value to context when its stepper changes', () => {
    renderConfigurator()
    // Padding stepper is labelled "Pad" and defaults to 0
    const padInput = findStepperInput('0', 0)
    fireEvent.change(padInput, { target: { value: '12' } })
    expect(readAppearance().padding).toBe(12)
  })

  it('clamps padding to its maximum of 64', () => {
    renderConfigurator()
    const padInput = findStepperInput('0', 0)
    fireEvent.change(padInput, { target: { value: '500' } })
    expect(readAppearance().padding).toBe(64)
  })
})

// ---------------------------------------------------------------------------
// Shape dropdown + conditional border-radius stepper
// ---------------------------------------------------------------------------

describe('shape dropdown', () => {
  it('sets the shape to square when the Square menu item is chosen', () => {
    renderConfigurator()
    // Open the shape menu (its trigger button shows the current label "Circle").
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    // Headless UI renders each option as a button carrying role="menuitem".
    fireEvent.click(screen.getByRole('menuitem', { name: 'Square' }))
    expect(readAppearance().shape).toBe('square')
  })

  it('reveals a border-radius stepper only for the rounded shape and writes its value', () => {
    renderConfigurator()
    // No border-radius stepper while shape is the default circle.
    const inputsBefore = screen.getAllByRole('textbox').length

    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rounded' }))
    expect(readAppearance().shape).toBe('rounded')

    // A new stepper input appears for the border radius (default 8).
    const inputsAfter = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputsAfter.length).toBe(inputsBefore + 1)
    const radiusInput = inputsAfter.find((input) => input.value === '8')!
    fireEvent.change(radiusInput, { target: { value: '20' } })
    expect(readAppearance().borderRadius).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Shadow dropdown
// ---------------------------------------------------------------------------

describe('shadow dropdown', () => {
  it('sets the shadow level from the menu', () => {
    renderConfigurator()
    // Shadow menu trigger shows the current label "None".
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Strong' }))
    expect(readAppearance().shadow).toBe('strong')
  })

  it('can cycle through to a different shadow level', () => {
    renderConfigurator()
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Subtle' }))
    expect(readAppearance().shadow).toBe('subtle')
  })
})

// ---------------------------------------------------------------------------
// Background popover: swatches + custom colour
// ---------------------------------------------------------------------------

describe('background popover', () => {
  it('selects a preset swatch and writes the colour to context', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Background color'))
    // The "Black" swatch sets backgroundColor to #000000
    fireEvent.click(screen.getByLabelText('Black'))
    expect(readAppearance().backgroundColor).toBe('#000000')
  })

  it('sets a custom background colour through the colour input', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Background color'))
    fireEvent.change(screen.getByLabelText('Custom background color'), {
      target: { value: '#abcdef' },
    })
    expect(readAppearance().backgroundColor).toBe('#abcdef')
  })

  it('offers an "Add padding" shortcut when a visible background has no padding, and applies it', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Background color'))
    // Choosing a solid background with padding still 0 surfaces the hint.
    fireEvent.click(screen.getByLabelText('White'))
    expect(readAppearance().backgroundColor).toBe('#ffffff')
    expect(readAppearance().padding).toBe(0)

    const addPadding = screen.getByRole('button', { name: 'Add padding' })
    fireEvent.click(addPadding)
    expect(readAppearance().padding).toBe(8)
  })

  // The hint offers a second shortcut, "round corners", only for a square
  // shape — rounding a circle makes no visual sense. It writes both the
  // shape and a starting border radius in one click.
  it('offers a "round corners" shortcut for a square shape with a visible background and no padding', () => {
    renderConfigurator()
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Square' }))
    expect(readAppearance().shape).toBe('square')

    fireEvent.click(screen.getByLabelText('Background color'))
    fireEvent.click(screen.getByLabelText('White'))
    expect(readAppearance().padding).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'round corners' }))
    expect(readAppearance().shape).toBe('rounded')
    expect(readAppearance().borderRadius).toBe(12)
  })

  it('returns the background to transparent via the transparent swatch', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Background color'))
    fireEvent.click(screen.getByLabelText('Black'))
    expect(readAppearance().backgroundColor).toBe('#000000')

    fireEvent.click(screen.getByLabelText('Transparent'))
    expect(readAppearance().backgroundColor).toBe('transparent')
  })
})

// ---------------------------------------------------------------------------
// Badge popover toggle (the embedded BadgeConfigurator owns the detail controls)
// ---------------------------------------------------------------------------

describe('badge popover', () => {
  it('toggles the badge enabled flag from its popover switch', () => {
    renderConfigurator()
    expect(readBadge().enabled).toBe(false)
    // Open the badge popover
    fireEvent.click(screen.getByLabelText('Badge settings'))
    // The enable switch is labelled by its action
    fireEvent.click(screen.getByLabelText('Enable badge'))
    expect(readBadge().enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Code panel toggle
// ---------------------------------------------------------------------------

describe('code output toggle', () => {
  it('flips the code toggle button pressed state when clicked', () => {
    renderConfigurator()
    const codeButton = screen.getByLabelText('Show code output')
    expect(codeButton.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(codeButton)
    // After opening, its accessible label + pressed state flip
    const opened = screen.getByLabelText('Hide code output')
    expect(opened.getAttribute('aria-pressed')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// Empty-canvas affordance
// ---------------------------------------------------------------------------

describe('canvas empty state', () => {
  it('prompts the user to select a token when none is chosen', () => {
    renderConfigurator()
    expect(screen.getByText('Select a token to preview')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Canvas zoom controls — clampZoom keeps the preview from vanishing (too far
// out) or filling the screen with one pixel (too far in), and "Reset view"
// is the reader's only way back to a known-good state after zooming around.
// ---------------------------------------------------------------------------

describe('canvas zoom controls', () => {
  it('zooms in by 25% per click, reported as a rounded percentage', () => {
    renderConfigurator()
    expect(screen.getByText('100')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Zoom in'))
    expect(screen.getByText('125')).toBeTruthy()
  })

  it('zooms out symmetrically and returns to 100% via Reset view', () => {
    renderConfigurator()
    fireEvent.click(screen.getByLabelText('Zoom out'))
    expect(screen.getByText('80')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Reset view'))
    expect(screen.getByText('100')).toBeTruthy()
  })

  // clampZoom's whole job: no amount of clicking should push the preview past
  // the 400% ceiling this asserts, or a runaway zoom would eventually render
  // the preview off-canvas at a magnification nobody can use.
  it('stops zooming in at the 400% ceiling no matter how many more clicks arrive', () => {
    renderConfigurator()
    const zoomIn = screen.getByLabelText('Zoom in')
    for (let i = 0; i < 20; i += 1) fireEvent.click(zoomIn)
    expect(screen.getByText('400')).toBeTruthy()
  })

  it('stops zooming out at the 25% floor no matter how many more clicks arrive', () => {
    renderConfigurator()
    const zoomOut = screen.getByLabelText('Zoom out')
    for (let i = 0; i < 20; i += 1) fireEvent.click(zoomOut)
    expect(screen.getByText('25')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Canvas image address — the resolution-order editor's whole reason to exist.
// A user who reorders providers must see the preview request the fallback
// chain, or the editor would appear to do nothing.
// ---------------------------------------------------------------------------

describe('canvas image address', () => {
  it('requests the fallback path, in order, when a resolution order is set', () => {
    renderConfigurator()
    fireEvent.click(screen.getByText('select test token'))
    fireEvent.click(screen.getByText('set resolution order'))

    const image = screen.getByAltText('Test Token') as HTMLImageElement
    expect(image.src).toBe(
      'https://api.test/image/fallback/coingecko,trustwallet/eip155-369/0x95b303987a60c71504d99aa1b13b4da07b0790a',
    )
  })

  it('requests the plain chain address when no resolution order is set', () => {
    renderConfigurator()
    fireEvent.click(screen.getByText('select test token'))

    const image = screen.getByAltText('Test Token') as HTMLImageElement
    expect(image.src).toBe(
      'https://api.test/image/eip155-369/0x95b303987a60c71504d99aa1b13b4da07b0790a',
    )
  })

  it('drops the fallback path again once the resolution order is cleared', () => {
    renderConfigurator()
    fireEvent.click(screen.getByText('select test token'))
    fireEvent.click(screen.getByText('set resolution order'))
    fireEvent.click(screen.getByText('clear resolution order'))

    const image = screen.getByAltText('Test Token') as HTMLImageElement
    expect(image.src).toBe(
      'https://api.test/image/eip155-369/0x95b303987a60c71504d99aa1b13b4da07b0790a',
    )
  })
})

// ---------------------------------------------------------------------------
// Canvas panning + wheel zoom helpers
// ---------------------------------------------------------------------------

/** The pannable/zoomable surface: the div carrying the pointer and wheel handlers. */
function getCanvasSurface(container: HTMLElement): HTMLElement {
  return container.querySelector('.cursor-grab') as HTMLElement
}

/** The inner div whose inline transform actually pans and zooms the preview. */
function getCanvasTransformElement(container: HTMLElement): HTMLElement {
  return container.querySelector('.cursor-grab > .absolute.inset-0 > div') as HTMLElement
}

/** Reads the translate x/y, in pixels, out of the canvas transform's inline style. */
function readCanvasTranslate(container: HTMLElement): { x: number; y: number } {
  const style = getCanvasTransformElement(container).style.transform
  const match = style.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
  if (!match) throw new Error(`could not find a translate in canvas transform "${style}"`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** Reads the scale factor out of the canvas transform's inline style. */
function readCanvasScale(container: HTMLElement): number {
  const style = getCanvasTransformElement(container).style.transform
  const match = style.match(/scale\(([-\d.]+)\)/)
  if (!match) throw new Error(`could not find a scale in canvas transform "${style}"`)
  return Number(match[1])
}

/** Gives the canvas surface a known bounding rectangle, for pointer-offset maths in tests. */
function stubSurfaceRect(
  surface: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
) {
  surface.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => {},
    }) as DOMRect
}

// ---------------------------------------------------------------------------
// Canvas panning — a pointer drag must move the preview by exactly the
// pointer's own delta, and must keep accumulating from wherever the pointer
// last was, not from where the drag started.
// ---------------------------------------------------------------------------

describe('canvas panning', () => {
  it('translates the canvas by exactly the pointer delta after a press and move', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(surface, { clientX: 130, clientY: 145 })
    expect(readCanvasTranslate(container)).toEqual({ x: 30, y: 45 })
  })

  it("accumulates a second move from the pointer's last position, not the original press point", () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(surface, { clientX: 130, clientY: 100 })
    // A version that measured every move against the original press point
    // (100, 100) instead of the previous move (130, 100) would compute this
    // second delta as (50, -10) rather than (20, -10), and the canvas would
    // end up at (80, -10) rather than the correct (50, -10).
    fireEvent.pointerMove(surface, { clientX: 150, clientY: 90 })
    expect(readCanvasTranslate(container)).toEqual({ x: 50, y: -10 })
  })

  it('leaves the canvas in place when a pointer move arrives with no press first', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    fireEvent.pointerMove(surface, { clientX: 999, clientY: 999 })
    expect(readCanvasTranslate(container)).toEqual({ x: 0, y: 0 })
  })

  it('stops panning once the pointer is released, so a later move has no effect', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(surface, { clientX: 130, clientY: 100 })
    fireEvent.pointerUp(surface)
    fireEvent.pointerMove(surface, { clientX: 500, clientY: 500 })
    // Only the one move that happened while the pointer was held down counts.
    expect(readCanvasTranslate(container)).toEqual({ x: 30, y: 0 })
  })
})

// ---------------------------------------------------------------------------
// Canvas wheel zoom — the classic zoom bug is content sliding away from the
// cursor. These assert the point under the pointer stays on screen across a
// zoom, and that clampZoom holds its ceiling and floor under repeated wheel
// events so the preview cannot invert or vanish.
// ---------------------------------------------------------------------------

describe('canvas wheel zoom', () => {
  it('keeps the point under the pointer stationary on screen while zooming toward it', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    stubSurfaceRect(surface, { left: 20, top: 10, width: 200, height: 200 })

    // The pointer sits at (70, 40) on screen, which is (50, 30) inside the
    // surface once the stubbed rectangle's offset is subtracted. The canvas
    // starts untransformed, so the content point under the pointer is
    // exactly that same (50, 30).
    const pointerXInSurface = 50
    const pointerYInSurface = 30
    fireEvent.wheel(surface, { clientX: 70, clientY: 40, deltaY: -200 })

    const { x, y } = readCanvasTranslate(container)
    const zoom = readCanvasScale(container)

    // If zooming toward the pointer holds, mapping that same content point
    // through the new transform lands back on the same screen position --
    // the reason the image does not slide out from under the cursor.
    expect(pointerXInSurface * zoom + x).toBeCloseTo(pointerXInSurface, 5)
    expect(pointerYInSurface * zoom + y).toBeCloseTo(pointerYInSurface, 5)
    // And zooming actually happened, so the check above is not trivially
    // true at an unchanged zoom of 1.
    expect(zoom).toBeGreaterThan(1)
  })

  it('stops zooming in at the ceiling no matter how many more wheel events arrive', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    stubSurfaceRect(surface, { left: 0, top: 0, width: 200, height: 200 })
    for (let i = 0; i < 20; i += 1) {
      fireEvent.wheel(surface, { clientX: 50, clientY: 50, deltaY: -1000 })
    }
    expect(readCanvasScale(container)).toBe(4)
  })

  it('stops zooming out at the floor no matter how many more wheel events arrive', () => {
    const { container } = renderConfigurator()
    const surface = getCanvasSurface(container)
    stubSurfaceRect(surface, { left: 0, top: 0, width: 200, height: 200 })
    for (let i = 0; i < 20; i += 1) {
      fireEvent.wheel(surface, { clientX: 50, clientY: 50, deltaY: 1000 })
    }
    expect(readCanvasScale(container)).toBe(0.25)
  })
})

// ---------------------------------------------------------------------------
// Badge overlay offset — the badge is positioned by its calculated point,
// then pulled back by the ring thickness plus the badge padding so the
// artwork stays centred on that point instead of drifting down and right by
// the border width.
// ---------------------------------------------------------------------------

describe('badge overlay offset', () => {
  it('pulls the badge back by exactly the ring thickness plus padding', () => {
    const { container: containerWithoutRing } = renderConfigurator()
    fireEvent.click(screen.getByText('select test token'))
    fireEvent.click(screen.getByText('enable badge without ring or padding'))
    const badgeWithoutRing = screen.getByAltText('PulseChain').closest('div') as HTMLElement
    const topWithoutRing = Number(badgeWithoutRing.style.top.replace('px', ''))
    const leftWithoutRing = Number(badgeWithoutRing.style.left.replace('px', ''))
    cleanup()

    renderConfigurator()
    fireEvent.click(screen.getByText('select test token'))
    fireEvent.click(screen.getByText('enable badge with ring and padding'))
    const badgeWithRing = screen.getByAltText('PulseChain').closest('div') as HTMLElement
    const topWithRing = Number(badgeWithRing.style.top.replace('px', ''))
    const leftWithRing = Number(badgeWithRing.style.left.replace('px', ''))

    // Ring thickness 5 plus badge padding 3 is 8 pixels of pull-back on each
    // axis. Both renders share the same angle, size ratio and container size,
    // so the calculated point itself is identical -- only the offset differs.
    expect(topWithoutRing - topWithRing).toBe(8)
    expect(leftWithoutRing - leftWithRing).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Code panel height measurement — the panel measures its own content with a
// ResizeObserver so the open/close transition has a real height to animate
// to, rather than snapping open with no motion.
// ---------------------------------------------------------------------------

describe('code panel height measurement', () => {
  /** Finds the outer code-panel div, the one whose max-height animates open and closed. */
  function getCodePanelOuterDiv(container: HTMLElement): HTMLElement {
    const candidates = Array.from(container.querySelectorAll('div')) as HTMLElement[]
    const found = candidates.find((div) => div.className.includes('transition-[max-height]'))
    if (!found) throw new Error('could not find the code panel outer div')
    return found
  }

  it('grows the panel to the measured content height once the resize observer reports it', () => {
    const { container } = renderConfigurator()
    fireEvent.click(screen.getByLabelText('Show code output'))
    expect(getCodePanelOuterDiv(container).style.maxHeight).toBe('0px')

    triggerResize(250)
    expect(getCodePanelOuterDiv(container).style.maxHeight).toBe('250px')
  })

  it('caps the panel height at 400 pixels even when the measured content is taller', () => {
    const { container } = renderConfigurator()
    fireEvent.click(screen.getByLabelText('Show code output'))

    triggerResize(900)
    expect(getCodePanelOuterDiv(container).style.maxHeight).toBe('400px')
  })

  it('collapses back to zero max-height when the code panel is closed, regardless of measured content', () => {
    const { container } = renderConfigurator()
    fireEvent.click(screen.getByLabelText('Show code output'))
    triggerResize(250)
    expect(getCodePanelOuterDiv(container).style.maxHeight).toBe('250px')

    fireEvent.click(screen.getByLabelText('Hide code output'))
    expect(getCodePanelOuterDiv(container).style.maxHeight).toBe('0px')
  })

  it('disconnects its resize observer when the component unmounts', () => {
    const { unmount } = renderConfigurator()
    const observer = resizeObserverInstances[resizeObserverInstances.length - 1]
    expect(observer.disconnect).not.toHaveBeenCalled()

    unmount()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
