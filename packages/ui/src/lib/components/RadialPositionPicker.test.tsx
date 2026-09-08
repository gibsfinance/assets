/**
 * Behavioral tests for RadialPositionPicker.
 *
 * This is the circular control BadgeConfigurator uses to place a badge on a
 * token image. Its whole job is to turn a pointer position into an angle, and
 * an angle back into a pointer position, using one fixed convention: zero
 * degrees is top center, ninety is right, one hundred eighty is bottom, and
 * two hundred seventy is left. Every test below protects a way that
 * convention, or the drag lifecycle around it, could quietly break and still
 * look fine on screen — the badge would just land in the wrong place on
 * every token image.
 *
 * jsdom returns an all-zero rectangle from getBoundingClientRect, so each
 * test that drags the circle stubs the rectangle first, giving the circle a
 * known center to measure pointer positions against.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RadialPositionPicker from './RadialPositionPicker'

afterEach(() => {
  cleanup()
})

/** The circle is 120 by 120, so its center sits 60 from its left and top edges. */
const CIRCLE_SIZE = 120
const CENTER = CIRCLE_SIZE / 2

/**
 * Gives the circle element a known bounding rectangle. Without this, jsdom
 * reports every edge as zero, which would put the center at (0, 0) and make
 * every pointer direction land on the same angle.
 */
function stubCircleRect(circle: HTMLElement) {
  circle.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: CIRCLE_SIZE,
      bottom: CIRCLE_SIZE,
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      x: 0,
      y: 0,
      toJSON: () => {},
    }) as DOMRect
}

/** Renders the picker and returns its draggable circle, with a known rectangle stubbed in. */
function renderPicker(angleDeg: number, onChange = vi.fn()) {
  render(<RadialPositionPicker angleDeg={angleDeg} onChange={onChange} />)
  const circle = screen.getByLabelText('Badge angle')
  stubCircleRect(circle)
  return { circle, onChange }
}

describe('angle convention', () => {
  // Each case points the pointer directly at one cardinal direction from the
  // circle's center and checks the angle the picker reports for it. A
  // refactor that dropped or changed the plus-ninety offset in
  // angleFromPointer would still compile and still move the handle, but it
  // would report a different corner for every one of these — the fault that
  // would put a badge on the wrong side of a token image without any error.
  const cases: Array<[string, number, number, number]> = [
    ['a pointer directly above the center reports zero degrees', CENTER, 0, 0],
    ['a pointer directly right of the center reports ninety degrees', CIRCLE_SIZE, CENTER, 90],
    ['a pointer directly below the center reports one hundred eighty degrees', CENTER, CIRCLE_SIZE, 180],
    ['a pointer directly left of the center reports two hundred seventy degrees', 0, CENTER, 270],
  ]

  it.each(cases)('%s', (_description, clientX, clientY, expectedAngle) => {
    const { circle, onChange } = renderPicker(0)
    fireEvent.pointerDown(circle)
    fireEvent.pointerMove(window, { clientX, clientY })
    expect(onChange).toHaveBeenCalledWith(expectedAngle)
  })
})

describe('drag lifecycle', () => {
  it('reports nothing while the pointer has not been pressed on the circle', () => {
    // A pointer move that happens before any pointer down must not move the
    // badge. If this guard regressed, the badge would chase the cursor
    // around the whole page instead of only while the user is dragging.
    const { onChange } = renderPicker(0)
    fireEvent.pointerMove(window, { clientX: CIRCLE_SIZE, clientY: CENTER })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports the angle while the pointer is held down', () => {
    const { circle, onChange } = renderPicker(0)
    fireEvent.pointerDown(circle)
    fireEvent.pointerMove(window, { clientX: CIRCLE_SIZE, clientY: CENTER })
    expect(onChange).toHaveBeenCalledWith(90)
  })

  it('stops reporting after the pointer is released', () => {
    const { circle, onChange } = renderPicker(0)
    fireEvent.pointerDown(circle)
    fireEvent.pointerMove(window, { clientX: CIRCLE_SIZE, clientY: CENTER })
    expect(onChange).toHaveBeenCalledTimes(1)

    fireEvent.pointerUp(window)
    onChange.mockClear()

    fireEvent.pointerMove(window, { clientX: CENTER, clientY: 0 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('actually removes its window listeners on pointer up, not just its own dragging flag', () => {
    // The no-more-reports test above would also pass if the component left
    // its listeners attached and only flipped an internal flag, because that
    // flag is checked before onChange runs either way. That would still be a
    // leak: every future drag would add another listener on top of the one
    // never removed, so a single pointer move would eventually call onChange
    // once for every drag ever started. This test watches the real
    // window.removeEventListener calls to catch that leak directly.
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { circle } = renderPicker(0)

    fireEvent.pointerDown(circle)
    fireEvent.pointerUp(window)

    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    removeSpy.mockRestore()
  })
})

describe('degree input', () => {
  it('wraps a negative value into the zero to three hundred fifty nine range', () => {
    // Typing a negative angle is a real path — the input has no min
    // enforcement of its own, so the wrap has to do the work. A clamp
    // instead of a wrap would stick this at zero rather than the correct
    // two hundred seventy.
    const onChange = vi.fn()
    render(<RadialPositionPicker angleDeg={0} onChange={onChange} />)
    const input = screen.getByLabelText('Angle in degrees')
    fireEvent.change(input, { target: { value: '-90' } })
    expect(onChange).toHaveBeenCalledWith(270)
  })

  it('wraps a value past three hundred sixty back into range', () => {
    const onChange = vi.fn()
    render(<RadialPositionPicker angleDeg={0} onChange={onChange} />)
    const input = screen.getByLabelText('Angle in degrees')
    fireEvent.change(input, { target: { value: '450' } })
    expect(onChange).toHaveBeenCalledWith(90)
  })

  // The field is type="number", and jsdom enforces the same value-sanitizing
  // rule real browsers do: assigning a non-numeric string to a number
  // input's value coerces it to an empty string before any change event is
  // even raised, so the component's own Number.isNaN guard can never see a
  // NaN coming from user input. Confirmed directly against this project's
  // jsdom setup — a change to "abc" never reaches the component's onChange
  // handler at all. The reachable path is clearing the field: that produces
  // an empty string, and Number('') is zero, not NaN, so the guard passes
  // and the angle resets to zero rather than the change being dropped.
  it('resolves a cleared field to zero rather than leaving the angle unchanged', () => {
    const onChange = vi.fn()
    render(<RadialPositionPicker angleDeg={40} onChange={onChange} />)
    const input = screen.getByLabelText('Angle in degrees')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})

describe('snap-to-corner buttons', () => {
  it('reports its own angle when each corner button is clicked', () => {
    const onChange = vi.fn()
    render(<RadialPositionPicker angleDeg={0} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('Snap to TL (315°)'))
    expect(onChange).toHaveBeenLastCalledWith(315)

    fireEvent.click(screen.getByLabelText('Snap to TR (45°)'))
    expect(onChange).toHaveBeenLastCalledWith(45)

    fireEvent.click(screen.getByLabelText('Snap to BL (225°)'))
    expect(onChange).toHaveBeenLastCalledWith(225)

    fireEvent.click(screen.getByLabelText('Snap to BR (135°)'))
    expect(onChange).toHaveBeenLastCalledWith(135)
  })

  it('marks only the button matching the current angle as active', () => {
    // The active corner is the visual confirmation that a snap click landed.
    // Without this, a user could click a corner and see nothing acknowledge
    // it, or see the wrong corner light up.
    render(<RadialPositionPicker angleDeg={315} onChange={vi.fn()} />)
    const topLeft = screen.getByLabelText('Snap to TL (315°)')
    const topRight = screen.getByLabelText('Snap to TR (45°)')

    expect(topLeft.className).toContain('bg-accent-500/20')
    expect(topRight.className).not.toContain('bg-accent-500/20')
  })
})

describe('slider accessibility', () => {
  it('carries the current angle as its slider value', () => {
    // The circle has no visible number on it — a screen reader user relies
    // entirely on aria-valuenow to know the current angle.
    render(<RadialPositionPicker angleDeg={222} onChange={vi.fn()} />)
    const slider = screen.getByRole('slider')
    expect(slider.getAttribute('aria-valuenow')).toBe('222')
  })
})

describe('handle position on the circumference', () => {
  it('places the handle above center at zero degrees and below center at one hundred eighty', () => {
    // handlePosition's trigonometry is not worth restating in a test — doing
    // so would just check the formula against itself. What matters is the
    // documented convention it implements: zero degrees is top, one hundred
    // eighty is bottom. This confirms the handle actually moves to the side
    // of the circle the angle says it should.
    const topRender = render(<RadialPositionPicker angleDeg={0} onChange={vi.fn()} />)
    const topHandle = topRender.container.querySelector('[class*="shadow-glow-green"]') as HTMLElement
    const topPosition = parseFloat(topHandle.style.top)
    topRender.unmount()

    const bottomRender = render(<RadialPositionPicker angleDeg={180} onChange={vi.fn()} />)
    const bottomHandle = bottomRender.container.querySelector('[class*="shadow-glow-green"]') as HTMLElement
    const bottomPosition = parseFloat(bottomHandle.style.top)
    bottomRender.unmount()

    expect(topPosition).toBeLessThan(CENTER)
    expect(bottomPosition).toBeGreaterThan(CENTER)
  })
})
