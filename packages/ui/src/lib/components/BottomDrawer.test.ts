import { describe, it, expect } from 'vitest'
import {
  nextState,
  getTranslateY,
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
