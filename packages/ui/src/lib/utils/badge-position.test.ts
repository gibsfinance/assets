import { describe, it, expect } from 'vitest'
import { badgePositionToCSS } from './badge-position'

describe('badgePositionToCSS', () => {
  describe('badge size', () => {
    it('computes badgeSize as containerSize * sizeRatio', () => {
      const result = badgePositionToCSS(100, 0, 0.3, 0)
      expect(result.badgeSize).toBe(30)
    })

    it('returns 0 badge size when sizeRatio is 0', () => {
      const result = badgePositionToCSS(100, 0, 0, 0)
      expect(result.badgeSize).toBe(0)
    })

    it('returns full container size when sizeRatio is 1', () => {
      const result = badgePositionToCSS(64, 0, 1, 0)
      expect(result.badgeSize).toBe(64)
    })
  })

  describe('angle positioning', () => {
    it('places badge at top (12 o\'clock) when angle is 0', () => {
      const result = badgePositionToCSS(100, 0, 0.3, 0)
      // At 0 degrees (top): rad = -90 deg, cos(-90)=0, sin(-90)=-1
      // So left should be centered, top should be above center
      expect(result.left).toBeCloseTo(50 - 15, 5) // center - badge/2
      expect(result.top).toBeLessThan(50)
    })

    it('places badge at right (3 o\'clock) when angle is 90', () => {
      const result = badgePositionToCSS(100, 90, 0.3, 0)
      // At 90 degrees (right): rad = 0, cos(0)=1, sin(0)=0
      // So left should be to the right of center, top should be centered
      expect(result.left).toBeGreaterThan(50)
      expect(result.top).toBeCloseTo(50 - 15, 5)
    })

    it('places badge at bottom (6 o\'clock) when angle is 180', () => {
      const result = badgePositionToCSS(100, 180, 0.3, 0)
      // At 180 degrees (bottom): rad = 90 deg, cos(90)=0, sin(90)=1
      // So left should be centered, top should be below center
      expect(result.left).toBeCloseTo(50 - 15, 5)
      expect(result.top).toBeGreaterThan(50)
    })

    it('places badge at left (9 o\'clock) when angle is 270', () => {
      const result = badgePositionToCSS(100, 270, 0.3, 0)
      // At 270 degrees (left): rad = 180 deg, cos(180)=-1, sin(180)=0
      // So left should be to the left of center, top should be centered
      expect(result.left).toBeLessThan(50)
      expect(result.top).toBeCloseTo(50 - 15, 5)
    })
  })

  describe('overlap factor', () => {
    it('produces consistent results with overlap = 0 (touching edge)', () => {
      const result = badgePositionToCSS(100, 90, 0.3, 0)
      // radius = 50 + 15 * (1 - 0) = 65
      // left = 50 + 65 - 15 = 100
      expect(result.left).toBeCloseTo(100, 5)
    })

    it('moves badge inward with positive overlap', () => {
      const noOverlap = badgePositionToCSS(100, 90, 0.3, 0)
      const withOverlap = badgePositionToCSS(100, 90, 0.3, 0.5)
      // Positive overlap brings the badge closer to center
      expect(withOverlap.left).toBeLessThan(noOverlap.left)
    })

    it('moves badge outward with negative overlap', () => {
      const noOverlap = badgePositionToCSS(100, 90, 0.3, 0)
      const negOverlap = badgePositionToCSS(100, 90, 0.3, -0.5)
      // Negative overlap pushes the badge further out
      expect(negOverlap.left).toBeGreaterThan(noOverlap.left)
    })

    it('computes correct radius formula', () => {
      // radius = containerSize/2 + (badgeSize/2) * (1 - overlap*2)
      // For container=100, sizeRatio=0.4, overlap=0.25:
      //   badgeSize = 40
      //   radius = 50 + 20 * (1 - 0.5) = 50 + 10 = 60
      const result = badgePositionToCSS(100, 90, 0.4, 0.25)
      // At angle 90 (right): left = 50 + 60*cos(0) - 20 = 50 + 60 - 20 = 90
      expect(result.left).toBeCloseTo(90, 5)
      // top = 50 + 60*sin(0) - 20 = 50 - 20 = 30
      expect(result.top).toBeCloseTo(30, 5)
    })
  })

  describe('various container sizes', () => {
    it('scales proportionally with container size', () => {
      const small = badgePositionToCSS(50, 45, 0.3, 0)
      const large = badgePositionToCSS(100, 45, 0.3, 0)
      // Positions should scale by 2x
      expect(large.left / small.left).toBeCloseTo(2, 1)
      expect(large.top / small.top).toBeCloseTo(2, 1)
      expect(large.badgeSize).toBe(small.badgeSize * 2)
    })

    it('works with very small container', () => {
      const result = badgePositionToCSS(16, 135, 0.25, 0.5)
      expect(typeof result.top).toBe('number')
      expect(typeof result.left).toBe('number')
      expect(result.badgeSize).toBe(4)
    })
  })

  describe('edge cases', () => {
    it('handles angle of 360 (same as 0)', () => {
      const at0 = badgePositionToCSS(100, 0, 0.3, 0)
      const at360 = badgePositionToCSS(100, 360, 0.3, 0)
      expect(at360.left).toBeCloseTo(at0.left, 5)
      expect(at360.top).toBeCloseTo(at0.top, 5)
    })

    it('handles negative angles', () => {
      // -90 degrees should be same as 270 degrees
      const neg90 = badgePositionToCSS(100, -90, 0.3, 0)
      const pos270 = badgePositionToCSS(100, 270, 0.3, 0)
      expect(neg90.left).toBeCloseTo(pos270.left, 5)
      expect(neg90.top).toBeCloseTo(pos270.top, 5)
    })

    it('handles sizeRatio greater than 1', () => {
      const result = badgePositionToCSS(100, 0, 1.5, 0)
      expect(result.badgeSize).toBe(150)
      // Still computes without error
      expect(typeof result.top).toBe('number')
      expect(typeof result.left).toBe('number')
    })
  })
})
