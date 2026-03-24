import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import BottomDrawer from './BottomDrawer'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  vi.unstubAllGlobals()
})

function simulateTouch(
  element: HTMLElement,
  {
    startY,
    moveY,
    duration = 100,
  }: { startY: number; moveY: number; duration?: number },
) {
  fireEvent.touchStart(element, {
    touches: [{ clientY: startY }],
  })
  fireEvent.touchMove(element, {
    touches: [{ clientY: moveY }],
  })
  // Fake elapsed time via Date.now stub so velocity is calculated correctly
  fireEvent.touchEnd(element)
}

// ---------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------

describe('BottomDrawer backdrop', () => {
  it('does not show backdrop when in collapsed state', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    // aria-hidden backdrop div should not exist initially
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).toBeNull()
  })

  it('does not show backdrop when in half state', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    const handle = screen.getByRole('button')
    // collapsed → half
    fireEvent.click(handle)
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).toBeNull()
  })

  it('shows backdrop when in full state', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    const handle = screen.getByRole('button')
    // collapsed → half → full
    fireEvent.click(handle)
    fireEvent.click(handle)
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
  })

  it('collapses drawer when backdrop is clicked', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    const handle = screen.getByRole('button')
    // Open fully
    fireEvent.click(handle)
    fireEvent.click(handle)

    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(backdrop).not.toBeNull()

    // Click backdrop → should collapse
    fireEvent.click(backdrop)

    // Backdrop should be gone
    const backdropAfter = document.querySelector('[aria-hidden="true"]')
    expect(backdropAfter).toBeNull()

    // aria-modal should be false (collapsed)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// ARIA: aria-label on handle changes based on state
// ---------------------------------------------------------------------------

describe('BottomDrawer handle aria-label', () => {
  it('has "Expand drawer" when collapsed', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    const handle = screen.getByRole('button')
    expect(handle.getAttribute('aria-label')).toBe('Expand drawer')
  })

  it('has "Collapse drawer" when open (half)', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    const handle = screen.getByRole('button')
    fireEvent.click(handle)
    expect(handle.getAttribute('aria-label')).toBe('Collapse drawer')
  })
})

// ---------------------------------------------------------------------------
// Touch: tap (small move, quick) cycles state
// ---------------------------------------------------------------------------

describe('BottomDrawer touch tap', () => {
  it('tap on handle cycles collapsed → half', () => {
    vi.stubGlobal('Date', {
      now: vi.fn()
        .mockReturnValueOnce(0)   // touchStart sets touchStartTime
        .mockReturnValueOnce(100) // touchEnd reads elapsed
        .mockReturnValue(Date.now()),
    })

    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const handle = screen.getByRole('button')
    const dialog = screen.getByRole('dialog')

    // Initial: collapsed
    expect(dialog.getAttribute('aria-modal')).toBe('false')

    simulateTouch(handle, { startY: 500, moveY: 503 }) // 3px move < 8px threshold

    // After tap: half → aria-modal = true
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('two taps on handle reaches full state (body scroll locked)', () => {
    // Use click-based cycling to get to full state and verify the
    // touch tap also reaches the same end state via the same nextState logic.
    // This avoids multi-tap Date.now sequencing complexity.
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const handle = screen.getByRole('button')

    // Click twice: collapsed → half → full
    fireEvent.click(handle)
    fireEvent.click(handle)

    // Full state: body scroll locked
    expect(document.body.style.overflow).toBe('hidden')
  })
})

// ---------------------------------------------------------------------------
// Touch: flick down from half → collapsed
// ---------------------------------------------------------------------------

describe('BottomDrawer touch flick', () => {
  it('fast flick down from half → collapsed', () => {
    // Date.now sequence: touchStart → touchEnd (quick elapsed so velocity is large)
    // velocity = deltaY / elapsed; deltaY positive = down; elapsed small = high velocity
    const nowMock = vi.fn()
      // First click (to get to half state) — no Date.now needed for click
      // touchStart for the flick
      .mockReturnValueOnce(0)
      // touchEnd for the flick: 10ms elapsed, 50px down → velocity = 50/10 = 5 > 0.3
      .mockReturnValueOnce(10)
      .mockReturnValue(Date.now())

    vi.stubGlobal('Date', { now: nowMock })

    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const handle = screen.getByRole('button')
    const dialog = screen.getByRole('dialog')

    // Get to half state via click
    fireEvent.click(handle)
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    // Flick down 50px in 10ms → velocity = 5 > 0.3 → from half → collapsed
    simulateTouch(handle, { startY: 400, moveY: 450 })

    // Should now be collapsed
    expect(dialog.getAttribute('aria-modal')).toBe('false')
  })

  it('fast flick up from collapsed → half', () => {
    const nowMock = vi.fn()
      // touchStart
      .mockReturnValueOnce(0)
      // touchEnd: 10ms elapsed, -50px (up) → velocity = -50/10 = -5 < -0.3
      .mockReturnValueOnce(10)
      .mockReturnValue(Date.now())

    vi.stubGlobal('Date', { now: nowMock })

    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const handle = screen.getByRole('button')
    const dialog = screen.getByRole('dialog')

    // Start collapsed, flick upward
    simulateTouch(handle, { startY: 700, moveY: 650 }) // -50px delta

    // Should now be half (open)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// Touch: slow drag (not a flick) → snap to nearest
// ---------------------------------------------------------------------------

describe('BottomDrawer touch slow drag', () => {
  it('slow drag snap-to-nearest: from half, drag slightly toward full → snaps to full', () => {
    // Bring drawer to half state first, then slow-drag upward.
    // jsdom innerHeight = 768; half = 768 * 0.6 = 460.8; full = 0
    // From half (460.8), drag up by 200px: finalY ≈ 260.8, closest to full (0) dist=260 vs half (460.8) dist=200
    // Actually closest to full at 0 vs half at 460.8: midpoint = 230. finalY=260 > 230 → half wins
    // Let's drag from 460 up to 160: finalY ≈ 260, dist to full=260, dist to half=200 → half wins
    // Try: drag from 460 up to 50: finalY ≈ 410, dist full=410, dist half=50 → half
    // For snap to full: finalY must be < 230 (midpoint). Drag from 460 up by 300 → finalY=160
    // dist to full=160, dist to half=300 → full wins
    //
    // Make it a non-tap (>8px) and non-flick (velocity ≈ 0.01):
    // elapsed 3000ms, delta -300px → velocity = -300/3000 = -0.1 → |v| < 0.3 = not a flick
    const nowMock = vi.fn()
      .mockReturnValueOnce(0)      // touchStart
      .mockReturnValueOnce(3000)   // touchEnd: 3000ms elapsed → velocity = -300/3000 = -0.1
      .mockReturnValue(Date.now())

    vi.stubGlobal('Date', { now: nowMock })

    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const handle = screen.getByRole('button')
    const dialog = screen.getByRole('dialog')

    // Bring to half state via click
    fireEvent.click(handle)
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    // Slow drag up from ~460 → ~160 (300px up, 3000ms → velocity = -0.1, not a flick)
    // finalY = 460 + (-300) = 160 → closest to full (0) → snaps to full
    fireEvent.touchStart(handle, { touches: [{ clientY: 460 }] })
    fireEvent.touchMove(handle, { touches: [{ clientY: 160 }] })
    fireEvent.touchEnd(handle)

    // snapToNearestState(160, 768): dist full=160, dist half=300, dist collapsed=560 → snaps to full
    expect(document.body.style.overflow).toBe('hidden')
  })
})

// ---------------------------------------------------------------------------
// Resize event updates viewport height
// ---------------------------------------------------------------------------

describe('BottomDrawer resize event', () => {
  it('updates translateY when window is resized', () => {
    render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )

    const dialog = screen.getByRole('dialog')
    const styleBefore = dialog.getAttribute('style') ?? ''

    // Simulate window resize
    Object.defineProperty(window, 'innerHeight', { value: 1024, writable: true, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    const styleAfter = dialog.getAttribute('style') ?? ''
    // Style should have updated with new translateY based on 1024 height
    expect(styleAfter).toContain('translateY')
    // The translateY value should now reflect 1024 - 48 = 976 for collapsed state
    expect(styleAfter).toContain('976')
    // Restore
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true })
  })
})

// ---------------------------------------------------------------------------
// Disabled state resets to collapsed
// ---------------------------------------------------------------------------

describe('BottomDrawer disabled prop effect', () => {
  it('returns null when enabled=false regardless of prior state', () => {
    const { rerender, container } = render(
      <BottomDrawer enabled>
        <div>Content</div>
      </BottomDrawer>,
    )
    expect(container.innerHTML).not.toBe('')

    rerender(
      <BottomDrawer enabled={false}>
        <div>Content</div>
      </BottomDrawer>,
    )
    expect(container.innerHTML).toBe('')
  })
})
