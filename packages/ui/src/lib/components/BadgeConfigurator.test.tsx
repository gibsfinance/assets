/**
 * Behavioral tests for BadgeConfigurator.
 *
 * Why: BadgeConfigurator is the panel that turns abstract badge state into
 * user-facing controls — the angle picker, size/overlap sliders, badge shape,
 * padding, background, and the ring (enable + colour + thickness). Every
 * control here writes through `updateBadge()` into Studio context, and several
 * controls are conditionally rendered or disabled depending on whether the
 * badge / ring is enabled. These tests pin that wiring: an interaction must
 * produce the matching observable change in context state, and the conditional
 * controls must appear/disappear (and enable/disable) as the source intends.
 *
 * Observation strategy: a sibling "probe" component reads the live badge slice
 * from `useStudio()` and serialises it into the DOM, so assertions are made
 * against the real context value the rest of the Studio would see — not against
 * a spy. A second probe button lets a test flip `enabled`/`ringEnabled` on
 * without depending on the control under test, since the configurator's own
 * inputs are `disabled` (and therefore reject events) while the badge is off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import BadgeConfigurator from './BadgeConfigurator'
import { StudioProvider, useStudio } from '../contexts/StudioContext'

// ---------------------------------------------------------------------------
// Probe: surfaces the live badge slice + a couple of escape-hatch buttons that
// drive context directly (so a test can enable the badge without going through
// the control it is trying to verify).
// ---------------------------------------------------------------------------

function BadgeProbe() {
  const { badge, updateBadge } = useStudio()
  return (
    <div>
      <pre data-testid="badge">{JSON.stringify(badge)}</pre>
      <button type="button" data-testid="probe-enable" onClick={() => updateBadge({ enabled: true })}>
        force-enable
      </button>
      <button
        type="button"
        data-testid="probe-ring-off"
        onClick={() => updateBadge({ ringEnabled: false })}
      >
        force-ring-off
      </button>
    </div>
  )
}

function renderConfigurator() {
  return render(
    <StudioProvider>
      <BadgeConfigurator />
      <BadgeProbe />
    </StudioProvider>,
  )
}

/** Parse the probe's serialised badge slice into an object */
function readBadge(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('badge').textContent ?? '{}')
}

/** Flip the badge on through the escape-hatch probe button (not a control under test) */
function enableBadge() {
  act(() => {
    fireEvent.click(screen.getByTestId('probe-enable'))
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Disabled vs enabled gating
// ---------------------------------------------------------------------------

describe('enabled gating', () => {
  it('disables every interactive control while the badge is off', () => {
    renderConfigurator()
    // sliders + colour inputs + shape buttons are all disabled when badge.enabled is false
    const ranges = document.querySelectorAll('input[type="range"]')
    expect(ranges.length).toBeGreaterThan(0)
    ranges.forEach((range) => expect((range as HTMLInputElement).disabled).toBe(true))

    const shapeButtons = [screen.getByText('Circle'), screen.getByText('Square')]
    shapeButtons.forEach((button) => expect((button as HTMLButtonElement).disabled).toBe(true))
  })

  it('enables the controls once the badge is turned on', () => {
    renderConfigurator()
    enableBadge()
    const ranges = document.querySelectorAll('input[type="range"]')
    ranges.forEach((range) => expect((range as HTMLInputElement).disabled).toBe(false))
    expect((screen.getByText('Square') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Angle (radial picker + numeric input)
// ---------------------------------------------------------------------------

describe('angle control', () => {
  it('starts at the default angle of 135 degrees', () => {
    renderConfigurator()
    expect(readBadge().angleDeg).toBe(135)
    // the numeric angle input mirrors the same value
    const angleInput = screen.getByLabelText('Angle in degrees') as HTMLInputElement
    expect(angleInput.value).toBe('135')
  })

  it('writes the chosen angle to context when a snap preset is clicked', () => {
    renderConfigurator()
    enableBadge()
    // "Snap to TL (315°)" preset
    fireEvent.click(screen.getByLabelText('Snap to TL (315°)'))
    expect(readBadge().angleDeg).toBe(315)
  })

  it('normalises an out-of-range numeric angle into 0–359 via modulo', () => {
    renderConfigurator()
    enableBadge()
    const angleInput = screen.getByLabelText('Angle in degrees')
    // 400 degrees should wrap to 40
    fireEvent.change(angleInput, { target: { value: '400' } })
    expect(readBadge().angleDeg).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// Size + overlap sliders
// ---------------------------------------------------------------------------

describe('size and overlap sliders', () => {
  it('updates the size ratio in context when the size slider moves', () => {
    renderConfigurator()
    enableBadge()
    // The size slider is the range whose min is 0.15 / max 0.6
    const sizeSlider = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).find((el) => (el as HTMLInputElement).max === '0.6') as HTMLInputElement
    expect(sizeSlider).toBeTruthy()
    fireEvent.change(sizeSlider, { target: { value: '0.45' } })
    expect(readBadge().sizeRatio).toBeCloseTo(0.45)
  })

  it('shows the size ratio as a rounded percentage next to the slider', () => {
    renderConfigurator()
    // default sizeRatio 0.3 → "30%"
    expect(screen.getByText('30%')).toBeTruthy()
  })

  it('updates the overlap (allowing negative values) when the overlap slider moves', () => {
    renderConfigurator()
    enableBadge()
    const overlapSlider = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).find((el) => (el as HTMLInputElement).min === '-0.5') as HTMLInputElement
    expect(overlapSlider).toBeTruthy()
    fireEvent.change(overlapSlider, { target: { value: '-0.5' } })
    expect(readBadge().overlap).toBeCloseTo(-0.5)
  })

  it('relabels the overlap row based on its value (Float / Edge / Inset)', () => {
    renderConfigurator()
    enableBadge()
    // default overlap 0 → "Edge"
    expect(screen.getByText('Edge')).toBeTruthy()

    const overlapSlider = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).find((el) => (el as HTMLInputElement).min === '-0.5') as HTMLInputElement
    fireEvent.change(overlapSlider, { target: { value: '-0.5' } })
    // -0.5 ≤ -0.4 → "Float"
    expect(screen.getByText('Float')).toBeTruthy()

    fireEvent.change(overlapSlider, { target: { value: '0.5' } })
    // 0.5 ≥ 0.4 → "Inset"
    expect(screen.getByText('Inset')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Badge shape
// ---------------------------------------------------------------------------

describe('badge shape', () => {
  it('switches the badge shape to square then back to circle', () => {
    renderConfigurator()
    enableBadge()
    expect(readBadge().badgeShape).toBe('circle')

    fireEvent.click(screen.getByText('Square'))
    expect(readBadge().badgeShape).toBe('square')

    fireEvent.click(screen.getByText('Circle'))
    expect(readBadge().badgeShape).toBe('circle')
  })
})

// ---------------------------------------------------------------------------
// Badge padding + background
// ---------------------------------------------------------------------------

describe('badge padding and background', () => {
  it('updates the badge padding when its slider moves', () => {
    renderConfigurator()
    enableBadge()
    const paddingSlider = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).find((el) => (el as HTMLInputElement).max === '4') as HTMLInputElement
    expect(paddingSlider).toBeTruthy()
    fireEvent.change(paddingSlider, { target: { value: '3' } })
    expect(readBadge().badgePadding).toBe(3)
  })

  it('sets a custom badge background colour via the colour input', () => {
    renderConfigurator()
    enableBadge()
    const colourInput = screen.getByLabelText('Badge background color') as HTMLInputElement
    fireEvent.change(colourInput, { target: { value: '#ff0000' } })
    expect(readBadge().badgeBackground).toBe('#ff0000')
  })

  it('resets the badge background to transparent via the transparent swatch', () => {
    renderConfigurator()
    enableBadge()
    // first set a custom colour, then click the transparent swatch
    fireEvent.change(screen.getByLabelText('Badge background color'), {
      target: { value: '#ff0000' },
    })
    expect(readBadge().badgeBackground).toBe('#ff0000')

    fireEvent.click(screen.getByLabelText('Transparent'))
    expect(readBadge().badgeBackground).toBe('transparent')
  })
})

// ---------------------------------------------------------------------------
// Ring: enable toggle reveals colour + thickness controls
// ---------------------------------------------------------------------------

describe('ring controls', () => {
  it('shows the ring colour and thickness controls only while the ring is enabled', () => {
    renderConfigurator()
    enableBadge()
    // ring is enabled by default → colour + thickness present
    expect(screen.queryByLabelText('Ring color')).not.toBeNull()
    expect(readBadge().ringEnabled).toBe(true)

    // turn the ring off via its own checkbox (the only unlabelled checkbox in the panel)
    const ringCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(ringCheckbox).toBeTruthy()
    fireEvent.click(ringCheckbox)
    expect(readBadge().ringEnabled).toBe(false)
    // colour + thickness controls disappear when the ring is off
    expect(screen.queryByLabelText('Ring color')).toBeNull()
  })

  it('re-enables the ring through its checkbox after it was turned off', () => {
    renderConfigurator()
    enableBadge()
    // force the ring off through the probe, independent of the checkbox under test
    act(() => {
      fireEvent.click(screen.getByTestId('probe-ring-off'))
    })
    expect(readBadge().ringEnabled).toBe(false)
    expect(screen.queryByLabelText('Ring color')).toBeNull()

    const ringCheckbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(ringCheckbox)
    expect(readBadge().ringEnabled).toBe(true)
    expect(screen.queryByLabelText('Ring color')).not.toBeNull()
  })

  it('updates the ring colour through the ring colour input', () => {
    renderConfigurator()
    enableBadge()
    const ringColour = screen.getByLabelText('Ring color') as HTMLInputElement
    fireEvent.change(ringColour, { target: { value: '#123456' } })
    expect(readBadge().ringColor).toBe('#123456')
  })

  it('updates the ring thickness through its slider and reflects it in the px label', () => {
    renderConfigurator()
    enableBadge()
    // the ring thickness slider is the range with min 1 / max 6
    const thicknessSlider = Array.from(
      document.querySelectorAll('input[type="range"]'),
    ).find(
      (el) =>
        (el as HTMLInputElement).min === '1' && (el as HTMLInputElement).max === '6',
    ) as HTMLInputElement
    expect(thicknessSlider).toBeTruthy()
    fireEvent.change(thicknessSlider, { target: { value: '5' } })
    expect(readBadge().ringThickness).toBe(5)
    // the adjacent label spells out the pixel value
    expect(screen.getByText('5px')).toBeTruthy()
  })
})
