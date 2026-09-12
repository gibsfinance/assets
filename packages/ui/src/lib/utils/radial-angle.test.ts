import { describe, expect, it } from 'vitest'
import {
  CENTER,
  CIRCLE_SIZE,
  RADIUS,
  angleFromPointer,
  handlePosition,
  normalizeAngle,
  type TrackOrigin,
} from './radial-angle'

const ZERO_ORIGIN: TrackOrigin = { left: 0, top: 0 }

describe('angleFromPointer', () => {
  it('reads 0 degrees for a pointer at the top of the track', () => {
    expect(angleFromPointer(CENTER, 0, ZERO_ORIGIN)).toBe(0)
  })

  it('reads 90 degrees for a pointer at the right of the track', () => {
    expect(angleFromPointer(CIRCLE_SIZE, CENTER, ZERO_ORIGIN)).toBe(90)
  })

  it('reads 180 degrees for a pointer at the bottom of the track', () => {
    expect(angleFromPointer(CENTER, CIRCLE_SIZE, ZERO_ORIGIN)).toBe(180)
  })

  it('reads 270 degrees for a pointer at the left of the track', () => {
    expect(angleFromPointer(0, CENTER, ZERO_ORIGIN)).toBe(270)
  })

  it('changes the reading when the track origin moves, for the same pointer position', () => {
    const pointer = { clientX: 80, clientY: 60 }
    const atZeroOrigin = angleFromPointer(pointer.clientX, pointer.clientY, ZERO_ORIGIN)
    const atShiftedOrigin = angleFromPointer(pointer.clientX, pointer.clientY, { left: 100, top: 50 })
    expect(atShiftedOrigin).not.toBe(atZeroOrigin)
  })

  it('gives the same reading when the pointer and the origin move by the same amount', () => {
    const origin: TrackOrigin = { left: 100, top: 50 }
    const pointer = { clientX: 80, clientY: 60 }
    const shift = { dx: 30, dy: -20 }

    const baseline = angleFromPointer(pointer.clientX, pointer.clientY, origin)
    const shifted = angleFromPointer(pointer.clientX + shift.dx, pointer.clientY + shift.dy, {
      left: origin.left + shift.dx,
      top: origin.top + shift.dy,
    })

    expect(shifted).toBe(baseline)
  })

  it('never returns a value outside 0-359, for a pointer up and to the left of centre', () => {
    const angle = angleFromPointer(0, 0, ZERO_ORIGIN)
    expect(angle).toBeGreaterThanOrEqual(0)
    expect(angle).toBeLessThan(360)
    expect(angle).toBe(315)
  })
})

describe('normalizeAngle', () => {
  it('maps -90 to 270, wrapping a negative angle into range', () => {
    expect(normalizeAngle(-90)).toBe(270)
  })

  it('maps 450 to 90, wrapping an angle past a full turn', () => {
    expect(normalizeAngle(450)).toBe(90)
  })

  it('leaves an angle already inside 0-359 unchanged', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(180)).toBe(180)
    expect(normalizeAngle(359)).toBe(359)
  })
})

describe('handlePosition', () => {
  it('places the handle at the top of the track for 0 degrees', () => {
    const position = handlePosition(0)
    expect(position.x).toBeCloseTo(CENTER)
    expect(position.y).toBeCloseTo(CENTER - RADIUS)
  })

  it('places the handle at the right of the track for 90 degrees', () => {
    const position = handlePosition(90)
    expect(position.x).toBeCloseTo(CENTER + RADIUS)
    expect(position.y).toBeCloseTo(CENTER)
  })

  it('places the handle at the bottom of the track for 180 degrees', () => {
    const position = handlePosition(180)
    expect(position.x).toBeCloseTo(CENTER)
    expect(position.y).toBeCloseTo(CENTER + RADIUS)
  })

  it('places the handle at the left of the track for 270 degrees', () => {
    const position = handlePosition(270)
    expect(position.x).toBeCloseTo(CENTER - RADIUS)
    expect(position.y).toBeCloseTo(CENTER)
  })

  it('keeps the handle at distance RADIUS from centre for any angle', () => {
    const angles = [0, 45, 90, 135, 180, 225, 270, 333]
    for (const angle of angles) {
      const position = handlePosition(angle)
      const distanceFromCenter = Math.sqrt((position.x - CENTER) ** 2 + (position.y - CENTER) ** 2)
      expect(distanceFromCenter).toBeCloseTo(RADIUS)
    }
  })

  it('inverts angleFromPointer, so the round trip returns the original angle', () => {
    const angles = [0, 45, 90, 135, 180, 225, 270, 315]
    for (const angle of angles) {
      const position = handlePosition(angle)
      const roundTripped = angleFromPointer(position.x, position.y, ZERO_ORIGIN)
      expect(roundTripped).toBeCloseTo(angle)
    }
  })
})
