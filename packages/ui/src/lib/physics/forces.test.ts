/**
 * The force primitives behind the landing-page icon field.
 *
 * These are pure and deterministic, so they can be pinned exactly rather than smoke
 * tested. That matters more than it looks: the module had no tests at all, and
 * resolveCollision's approach/separate guard was inverted the whole time — a defect
 * invisible in review because the impulse arithmetic around it is textbook correct.
 * The collision tests below assert the direction of the velocity change, which is the
 * only thing that would have caught it.
 */
import { describe, it, expect } from 'vitest'
import {
  applyWallBounce,
  applyMouseRepel,
  applyScrollForce,
  resolveCollision,
  computeEdgeOpacity,
} from './forces'
import { DEFAULT_CONFIG } from './types'
import type { PhysicsIcon, PhysicsConfig } from './types'

const config = (overrides: Partial<PhysicsConfig> = {}): PhysicsConfig => ({
  ...DEFAULT_CONFIG,
  width: 1000,
  height: 800,
  ...overrides,
})

const icon = (overrides: Partial<PhysicsIcon> = {}): PhysicsIcon => ({
  id: 1,
  position: { x: 500, y: 400 },
  velocity: { x: 0, y: 0 },
  radius: 10,
  mass: 20,
  layer: 'middle',
  opacity: 1,
  imgSrc: '',
  imgElement: null,
  ...overrides,
})

describe('applyWallBounce', () => {
  it('leaves an icon clear of every wall untouched', () => {
    const i = icon({ velocity: { x: 3, y: -2 } })
    applyWallBounce(i, config())
    expect(i.position).toEqual({ x: 500, y: 400 })
    expect(i.velocity).toEqual({ x: 3, y: -2 })
  })

  it('pushes an icon off the left wall and sends it inward, damped', () => {
    // Math.abs is load-bearing: an icon can reach the wall already moving away, and
    // negating its velocity would drive it back through.
    const i = icon({ position: { x: 4, y: 400 }, velocity: { x: -5, y: 0 } })
    applyWallBounce(i, config({ wallDamping: 0.9 }))
    expect(i.position.x).toBe(10)
    expect(i.velocity.x).toBeCloseTo(4.5)
  })

  it('sends an icon off the right wall inward, damped', () => {
    const i = icon({ position: { x: 995, y: 400 }, velocity: { x: 5, y: 0 } })
    applyWallBounce(i, config({ wallDamping: 0.9 }))
    expect(i.position.x).toBe(990)
    expect(i.velocity.x).toBeCloseTo(-4.5)
  })

  it('bounces the top and bottom walls on the vertical axis only', () => {
    const top = icon({ position: { x: 500, y: 3 }, velocity: { x: 7, y: -4 } })
    applyWallBounce(top, config({ wallDamping: 0.5 }))
    expect(top.position.y).toBe(10)
    expect(top.velocity.y).toBeCloseTo(2)
    expect(top.velocity.x).toBe(7)

    const bottom = icon({ position: { x: 500, y: 795 }, velocity: { x: 0, y: 4 } })
    applyWallBounce(bottom, config({ wallDamping: 0.5 }))
    expect(bottom.position.y).toBe(790)
    expect(bottom.velocity.y).toBeCloseTo(-2)
  })

  it('resolves a corner on both axes in one call', () => {
    const i = icon({ position: { x: 2, y: 2 }, velocity: { x: -1, y: -1 } })
    applyWallBounce(i, config({ wallDamping: 1 }))
    expect(i.position).toEqual({ x: 10, y: 10 })
    expect(i.velocity).toEqual({ x: 1, y: 1 })
  })
})

describe('applyMouseRepel', () => {
  it('does nothing when the pointer has left the canvas', () => {
    const i = icon({ velocity: { x: 1, y: 1 } })
    applyMouseRepel(i, null, config())
    expect(i.velocity).toEqual({ x: 1, y: 1 })
  })

  it('does nothing beyond the repel radius', () => {
    const i = icon({ position: { x: 500, y: 400 } })
    applyMouseRepel(i, { x: 500 + 121, y: 400 }, config({ mouseRepelRadius: 120 }))
    expect(i.velocity).toEqual({ x: 0, y: 0 })
  })

  it('pushes directly away from the pointer', () => {
    const i = icon({ position: { x: 500, y: 400 } })
    applyMouseRepel(i, { x: 440, y: 400 }, config({ mouseRepelRadius: 120, mouseRepelStrength: 1 }))
    // 60px away on a 120px radius: half strength, entirely along +x.
    expect(i.velocity.x).toBeCloseTo(0.5)
    expect(i.velocity.y).toBeCloseTo(0)
  })

  it('pushes harder the closer the pointer gets', () => {
    const near = icon()
    const far = icon()
    const c = config({ mouseRepelRadius: 120, mouseRepelStrength: 1 })
    applyMouseRepel(near, { x: 470, y: 400 }, c)
    applyMouseRepel(far, { x: 410, y: 400 }, c)
    expect(near.velocity.x).toBeGreaterThan(far.velocity.x)
  })

  it('ignores a pointer sitting on the icon, which would divide by ~zero', () => {
    // distSq < 1 short-circuits. Without it the normalisation explodes and the icon is
    // launched off-canvas the instant the cursor crosses its centre.
    const i = icon({ position: { x: 500, y: 400 } })
    applyMouseRepel(i, { x: 500, y: 400 }, config())
    expect(i.velocity).toEqual({ x: 0, y: 0 })
    expect(Number.isFinite(i.velocity.x)).toBe(true)
  })
})

describe('applyScrollForce', () => {
  it('drags icons along the scroll direction', () => {
    const i = icon({ position: { x: 500, y: 400 } })
    applyScrollForce(i, 100, config({ scrollForceMultiplier: 0.02 }))
    expect(i.velocity.y).toBeCloseTo(2)
  })

  it('fans icons away from the horizontal centre, not toward it', () => {
    const right = icon({ position: { x: 900, y: 400 } })
    const left = icon({ position: { x: 100, y: 400 } })
    const c = config({ width: 1000, scrollForceMultiplier: 0.02 })
    applyScrollForce(right, 100, c)
    applyScrollForce(left, 100, c)
    expect(right.velocity.x).toBeGreaterThan(0)
    expect(left.velocity.x).toBeLessThan(0)
  })

  it('fans outward regardless of scroll direction, since magnitude drives it', () => {
    const up = icon({ position: { x: 900, y: 400 } })
    const down = icon({ position: { x: 900, y: 400 } })
    const c = config({ width: 1000, scrollForceMultiplier: 0.02 })
    applyScrollForce(up, -100, c)
    applyScrollForce(down, 100, c)
    expect(up.velocity.x).toBeCloseTo(down.velocity.x)
    expect(up.velocity.y).toBeCloseTo(-down.velocity.y)
  })
})

describe('resolveCollision', () => {
  /** Two equal icons on the x axis, overlapping by 10 when 10 apart. */
  const pair = (aVx: number, bVx: number) => ({
    a: icon({ id: 1, position: { x: 0, y: 0 }, velocity: { x: aVx, y: 0 }, radius: 10, mass: 10 }),
    b: icon({ id: 2, position: { x: 10, y: 0 }, velocity: { x: bVx, y: 0 }, radius: 10, mass: 10 }),
  })

  it('ignores icons that are not touching', () => {
    const a = icon({ position: { x: 0, y: 0 }, radius: 10, velocity: { x: 1, y: 0 } })
    const b = icon({ position: { x: 100, y: 0 }, radius: 10, velocity: { x: -1, y: 0 } })
    resolveCollision(a, b, 0.85)
    expect(a.position.x).toBe(0)
    expect(a.velocity.x).toBe(1)
  })

  it('separates overlapping icons to exactly touching', () => {
    const { a, b } = pair(0, 0)
    resolveCollision(a, b, 0.85)
    expect(b.position.x - a.position.x).toBeCloseTo(20)
  })

  it('splits the separation by mass, so the heavier icon yields less', () => {
    const a = icon({ position: { x: 0, y: 0 }, radius: 10, mass: 30 })
    const b = icon({ position: { x: 10, y: 0 }, radius: 10, mass: 10 })
    resolveCollision(a, b, 0.85)
    expect(Math.abs(a.position.x - 0)).toBeLessThan(Math.abs(b.position.x - 10))
  })

  it('reverses approaching icons — the bounce itself', () => {
    // The regression that motivated these tests. Previously the guard skipped this case
    // entirely: the pair was pushed apart but kept closing, so they re-collided every
    // frame and appeared stuck together.
    const { a, b } = pair(1, -1)
    resolveCollision(a, b, 0.85)
    expect(a.velocity.x).toBeLessThan(0)
    expect(b.velocity.x).toBeGreaterThan(0)
  })

  it('bounces with restitution e = 2 * damping - 1', () => {
    const { a, b } = pair(1, -1)
    resolveCollision(a, b, 0.85)
    expect(a.velocity.x).toBeCloseTo(-0.7)
    expect(b.velocity.x).toBeCloseTo(0.7)
  })

  it('leaves already-separating icons alone', () => {
    // The other half of the inverted guard: these used to be flung back together.
    const { a, b } = pair(-1, 1)
    resolveCollision(a, b, 0.85)
    expect(a.velocity.x).toBe(-1)
    expect(b.velocity.x).toBe(1)
  })

  it('conserves momentum through the bounce', () => {
    const { a, b } = pair(3, -1)
    const before = a.mass * a.velocity.x + b.mass * b.velocity.x
    resolveCollision(a, b, 0.85)
    expect(a.mass * a.velocity.x + b.mass * b.velocity.x).toBeCloseTo(before)
  })

  it('ignores coincident icons rather than dividing by ~zero', () => {
    const a = icon({ position: { x: 0, y: 0 }, radius: 10, velocity: { x: 1, y: 0 } })
    const b = icon({ position: { x: 0, y: 0 }, radius: 10, velocity: { x: -1, y: 0 } })
    resolveCollision(a, b, 0.85)
    expect(Number.isFinite(a.position.x)).toBe(true)
    expect(a.velocity.x).toBe(1)
  })
})

describe('computeEdgeOpacity', () => {
  it('leaves an icon in open space at its own opacity', () => {
    const i = icon({ position: { x: 500, y: 400 }, opacity: 0.6 })
    expect(computeEdgeOpacity(i, config({ edgeFadePercent: 0.05 }))).toBeCloseTo(0.6)
  })

  it('fades toward zero as an icon nears an edge', () => {
    const c = config({ edgeFadePercent: 0.1 })
    const near = icon({ position: { x: 20, y: 400 }, opacity: 1 })
    const nearer = icon({ position: { x: 12, y: 400 }, opacity: 1 })
    expect(computeEdgeOpacity(nearer, c)).toBeLessThan(computeEdgeOpacity(near, c))
  })

  it('never returns a negative opacity for an icon past the edge', () => {
    // Canvas treats a negative alpha as invalid; clamping is what keeps it drawable.
    const i = icon({ position: { x: -50, y: 400 }, opacity: 1 })
    expect(computeEdgeOpacity(i, config({ edgeFadePercent: 0.1 }))).toBe(0)
  })

  it('clamps to 1 even if an icon carries a higher opacity', () => {
    const i = icon({ position: { x: 500, y: 400 }, opacity: 3 })
    expect(computeEdgeOpacity(i, config())).toBe(1)
  })

  it('compounds the fade in a corner', () => {
    const c = config({ edgeFadePercent: 0.1 })
    const edge = icon({ position: { x: 30, y: 400 }, opacity: 1 })
    const corner = icon({ position: { x: 30, y: 30 }, opacity: 1 })
    expect(computeEdgeOpacity(corner, c)).toBeLessThan(computeEdgeOpacity(edge, c))
  })

  it('fades against the far edges too', () => {
    const c = config({ edgeFadePercent: 0.1 })
    const i = icon({ position: { x: 985, y: 790 }, opacity: 1 })
    expect(computeEdgeOpacity(i, c)).toBeLessThan(1)
    expect(computeEdgeOpacity(i, c)).toBeGreaterThanOrEqual(0)
  })
})
