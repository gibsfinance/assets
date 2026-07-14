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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import StudioConfigurator from './StudioConfigurator'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import { ThemeProvider } from '../contexts/ThemeContext'

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

function renderConfigurator() {
  return render(
    <ThemeProvider>
      <StudioProvider>
        <StudioConfigurator />
        <AppearanceProbe />
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

beforeEach(() => {
  localStorage.clear()

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

  // CodePanel measures its content with a ResizeObserver
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
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
