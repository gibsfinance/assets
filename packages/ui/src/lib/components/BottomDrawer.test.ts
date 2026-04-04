import { describe, it, expect } from 'vitest'
import type React from 'react'
import {
  nextState,
  getTranslateY,
  getFirstTouchY,
  resolveFlickState,
  snapToNearestState,
  resolveTouchEndState,
  COLLAPSED_HEIGHT,
  HALF_HEIGHT_RATIO,
  type DrawerState,
} from './BottomDrawer'

describe('BottomDrawer', () => {
  describe('nextState', () => {
    it('cycles collapsed → half', () => {
      expect(nextState('collapsed')).toBe('half')
    })

    it('cycles half → full', () => {
      expect(nextState('half')).toBe('full')
    })

    it('cycles full → collapsed', () => {
      expect(nextState('full')).toBe('collapsed')
    })

    it('cycles through all states in order', () => {
      let state: DrawerState = 'collapsed'
      state = nextState(state)
      expect(state).toBe('half')
      state = nextState(state)
      expect(state).toBe('full')
      state = nextState(state)
      expect(state).toBe('collapsed')
    })
  })

  describe('getTranslateY', () => {
    const viewportHeight = 800

    it('returns viewport - collapsed height for collapsed state', () => {
      const result = getTranslateY('collapsed', viewportHeight)
      expect(result).toBe(viewportHeight - COLLAPSED_HEIGHT)
      expect(result).toBe(752)
    })

    it('returns correct half-open position', () => {
      const result = getTranslateY('half', viewportHeight)
      expect(result).toBe(viewportHeight * (1 - HALF_HEIGHT_RATIO))
      expect(result).toBe(480)
    })

    it('returns 0 for full state (top of viewport)', () => {
      expect(getTranslateY('full', viewportHeight)).toBe(0)
    })

    it('scales with different viewport heights', () => {
      const smallViewport = 600
      const largeViewport = 1200

      // Collapsed: always viewportHeight - 48
      expect(getTranslateY('collapsed', smallViewport)).toBe(552)
      expect(getTranslateY('collapsed', largeViewport)).toBe(1152)

      // Half: always 60% down (40% visible)
      expect(getTranslateY('half', smallViewport)).toBe(360)
      expect(getTranslateY('half', largeViewport)).toBe(720)

      // Full: always 0
      expect(getTranslateY('full', smallViewport)).toBe(0)
      expect(getTranslateY('full', largeViewport)).toBe(0)
    })

    it('maintains state ordering: collapsed > half > full', () => {
      const vh = 1000
      const collapsed = getTranslateY('collapsed', vh)
      const half = getTranslateY('half', vh)
      const full = getTranslateY('full', vh)

      // Higher translateY = further down = more hidden
      expect(collapsed).toBeGreaterThan(half)
      expect(half).toBeGreaterThan(full)
    })
  })

  describe('constants', () => {
    it('COLLAPSED_HEIGHT is 48px (handle bar height)', () => {
      expect(COLLAPSED_HEIGHT).toBe(48)
    })

    it('HALF_HEIGHT_RATIO is 0.4 (40% of viewport visible)', () => {
      expect(HALF_HEIGHT_RATIO).toBe(0.4)
    })
  })
})

describe('resolveFlickState', () => {
  it('flick up from collapsed → half', () => {
    expect(resolveFlickState(-0.5, 'collapsed')).toBe('half')
  })

  it('flick up from half → full', () => {
    expect(resolveFlickState(-0.5, 'half')).toBe('full')
  })

  it('flick up from full stays full (already at top)', () => {
    expect(resolveFlickState(-0.5, 'full')).toBe('full')
  })

  it('flick down from full → half', () => {
    expect(resolveFlickState(0.5, 'full')).toBe('half')
  })

  it('flick down from half → collapsed', () => {
    expect(resolveFlickState(0.5, 'half')).toBe('collapsed')
  })

  it('flick down from collapsed stays collapsed (already at bottom)', () => {
    expect(resolveFlickState(0.5, 'collapsed')).toBe('collapsed')
  })

  it('slow drag returns null (not a flick)', () => {
    expect(resolveFlickState(0.1, 'half')).toBeNull()
    expect(resolveFlickState(-0.1, 'half')).toBeNull()
    expect(resolveFlickState(0, 'full')).toBeNull()
  })

  it('exact boundary -0.3 is not a flick (returns null)', () => {
    expect(resolveFlickState(-0.3, 'collapsed')).toBeNull()
  })

  it('exact boundary 0.3 is not a flick (returns null)', () => {
    expect(resolveFlickState(0.3, 'full')).toBeNull()
  })
})

describe('snapToNearestState', () => {
  const vh = 800

  it('position closest to full (0) → full', () => {
    // fullY = 0, halfY = 480, collapsedY = 752
    expect(snapToNearestState(50, vh)).toBe('full')
  })

  it('position closest to half → half', () => {
    // halfY = 480; midpoint between full(0) and half(480) = 240; midpoint between half(480) and collapsed(752) = 616
    expect(snapToNearestState(480, vh)).toBe('half')
    expect(snapToNearestState(400, vh)).toBe('half')
  })

  it('position closest to collapsed → collapsed', () => {
    // collapsedY = 752
    expect(snapToNearestState(752, vh)).toBe('collapsed')
    expect(snapToNearestState(700, vh)).toBe('collapsed')
  })

  it('equidistant between full and half prefers full', () => {
    // fullY = 0, halfY = 480; midpoint = 240
    // distToFull = distToHalf = 240; condition distToFull <= distToHalf is true → 'full'
    expect(snapToNearestState(240, vh)).toBe('full')
  })

  it('equidistant between half and collapsed prefers half', () => {
    // halfY = 480, collapsedY = 752; midpoint = 616
    // distToFull = 616, distToHalf = 136, distToCollapsed = 136
    // distToFull > distToHalf so falls through; distToHalf <= distToCollapsed → 'half'
    expect(snapToNearestState(616, vh)).toBe('half')
  })

  it('works correctly with a different viewport height', () => {
    const smallVh = 600
    // fullY = 0, halfY = 360, collapsedY = 552
    expect(snapToNearestState(10, smallVh)).toBe('full')
    expect(snapToNearestState(360, smallVh)).toBe('half')
    expect(snapToNearestState(550, smallVh)).toBe('collapsed')
  })

  it('works with a large viewport height', () => {
    const largeVh = 1200
    // fullY = 0, halfY = 720, collapsedY = 1152
    expect(snapToNearestState(100, largeVh)).toBe('full')
    expect(snapToNearestState(720, largeVh)).toBe('half')
    expect(snapToNearestState(1100, largeVh)).toBe('collapsed')
  })
})

describe('resolveTouchEndState', () => {
  const vh = 800
  // With vh=800: fullY=0, halfY=480, collapsedY=752

  it('returns tap when dragOffset is small and elapsed is short', () => {
    // |5| < 8 && 100 < 300 → tap
    const result = resolveTouchEndState(5, 100, 'collapsed', 752, vh)
    expect(result).toEqual({ type: 'tap' })
  })

  it('returns tap for negative small dragOffset', () => {
    // |-5| < 8 && 100 < 300 → tap
    const result = resolveTouchEndState(-5, 100, 'half', 480, vh)
    expect(result).toEqual({ type: 'tap' })
  })

  it('is NOT a tap when dragOffset is exactly 8 (boundary)', () => {
    // |8| < 8 is false → resolved
    const result = resolveTouchEndState(8, 100, 'collapsed', 752, vh)
    expect(result.type).toBe('resolved')
  })

  it('is NOT a tap when elapsed is exactly 300 (boundary)', () => {
    // elapsed < 300 is false → resolved
    const result = resolveTouchEndState(5, 300, 'collapsed', 752, vh)
    expect(result.type).toBe('resolved')
  })

  it('flick up: large negative offset in short time → resolved with flick target', () => {
    // dragOffset=-100, elapsed=50 → velocity = -100/50 = -2.0 (< -0.3)
    // currentState='collapsed' → resolveFlickState returns 'half'
    const result = resolveTouchEndState(-100, 50, 'collapsed', 752, vh)
    expect(result).toEqual({ type: 'resolved', state: 'half' })
  })

  it('flick up from half → full', () => {
    // dragOffset=-100, elapsed=50 → velocity=-2.0 (< -0.3)
    // currentState='half' → resolveFlickState returns 'full'
    const result = resolveTouchEndState(-100, 50, 'half', 480, vh)
    expect(result).toEqual({ type: 'resolved', state: 'full' })
  })

  it('flick down: large positive offset in short time → resolved with flick target', () => {
    // dragOffset=100, elapsed=50 → velocity=2.0 (> 0.3)
    // currentState='full' → resolveFlickState returns 'half'
    const result = resolveTouchEndState(100, 50, 'full', 0, vh)
    expect(result).toEqual({ type: 'resolved', state: 'half' })
  })

  it('flick down from half → collapsed', () => {
    // dragOffset=100, elapsed=50 → velocity=2.0 (> 0.3)
    // currentState='half' → resolveFlickState returns 'collapsed'
    const result = resolveTouchEndState(100, 50, 'half', 480, vh)
    expect(result).toEqual({ type: 'resolved', state: 'collapsed' })
  })

  it('slow drag uses snapToNearestState → resolved with snapped state', () => {
    // dragOffset=10, elapsed=500 → velocity=0.02 (not a flick)
    // currentTranslateY=480, finalY=490 → closest to halfY(480) → 'half'
    const result = resolveTouchEndState(10, 500, 'half', 480, vh)
    expect(result).toEqual({ type: 'resolved', state: 'half' })
  })

  it('from full state, slow drag near collapsed position → resolved collapsed', () => {
    // Drag from full (translateY=0) by 720px over 2000ms → velocity=0.36 which IS a flick
    // Use a very slow drag: dragOffset=720, elapsed=5000 → velocity=0.144 (not a flick)
    // finalY = 0 + 720 = 720 → closest to halfY(480)? dist=240; collapsedY(752)? dist=32 → collapsed
    // Actually 720 is closer to halfY=480 (dist 240) or collapsedY=752 (dist 32)? collapsedY wins
    const result = resolveTouchEndState(720, 5000, 'full', 0, vh)
    expect(result).toEqual({ type: 'resolved', state: 'collapsed' })
  })

  it('elapsed of 0 uses max(elapsed,1) to avoid division by zero', () => {
    // elapsed=0, dragOffset=200 → velocity = 200/1 = 200 (large positive flick)
    // currentState='full' → flick down → 'half'
    const result = resolveTouchEndState(200, 0, 'full', 0, vh)
    expect(result).toEqual({ type: 'resolved', state: 'half' })
  })
})

describe('getFirstTouchY', () => {
  it('returns clientY from the first touch', () => {
    const touches = [{ clientY: 250 }] as unknown as React.TouchList
    expect(getFirstTouchY(touches)).toBe(250)
  })

  it('returns null when touches list is empty', () => {
    const touches = [] as unknown as React.TouchList
    expect(getFirstTouchY(touches)).toBeNull()
  })

  it('returns null when first touch is undefined', () => {
    const touches = { 0: undefined, length: 0 } as unknown as React.TouchList
    expect(getFirstTouchY(touches)).toBeNull()
  })
})
