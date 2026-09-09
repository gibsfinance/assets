/**
 * The simulation step and icon factory.
 *
 * stepPhysics is where the ordering matters: forces, then integration, then walls, then
 * collisions. Asserting the composed result is the only way to catch a stage being
 * dropped or reordered, since each individual force is already covered in forces.test.ts.
 *
 * createIcon takes its randomness as an argument. The tests below that stub
 * `Math.random` check the default path; the ones that pass a source of their own
 * check where each drawn number lands, which a global stub cannot express — with
 * one value for every call, every field looks alike.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { stepPhysics, createIcon } from './engine'
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

afterEach(() => vi.restoreAllMocks())

describe('stepPhysics', () => {
  it('integrates velocity into position', () => {
    const i = icon({ position: { x: 100, y: 100 }, velocity: { x: 5, y: -3 } })
    stepPhysics([i], config({ damping: 1 }), null, 0)
    expect(i.position.x).toBeCloseTo(105)
    expect(i.position.y).toBeCloseTo(97)
  })

  it('bleeds speed off through damping every step', () => {
    const i = icon({ velocity: { x: 10, y: 0 } })
    stepPhysics([i], config({ damping: 0.5 }), null, 0)
    expect(i.velocity.x).toBeCloseTo(5)
  })

  it('applies damping before integrating, not after', () => {
    // Order is observable: damped-then-moved advances by 5, moved-then-damped by 10.
    // Kept well clear of the walls so the bounce stage cannot supply the position.
    const i = icon({ position: { x: 100, y: 100 }, velocity: { x: 10, y: 0 } })
    stepPhysics([i], config({ damping: 0.5 }), null, 0)
    expect(i.position.x).toBeCloseTo(105)
  })

  it('keeps icons inside the canvas by running the wall bounce after integration', () => {
    // Without the wall stage in the same step, this icon ends the frame outside the
    // canvas and is drawn clipped before anything corrects it.
    const i = icon({ position: { x: 995, y: 400 }, velocity: { x: 50, y: 0 }, radius: 10 })
    stepPhysics([i], config({ damping: 1 }), null, 0)
    expect(i.position.x).toBeLessThanOrEqual(990)
    expect(i.velocity.x).toBeLessThan(0)
  })

  it('leaves velocity untouched by scroll when the delta is zero', () => {
    const i = icon({ position: { x: 900, y: 400 }, velocity: { x: 0, y: 0 } })
    stepPhysics([i], config({ damping: 1 }), null, 0)
    expect(i.velocity.x).toBeCloseTo(0)
    expect(i.velocity.y).toBeCloseTo(0)
  })

  it('feeds a non-zero scroll delta through to velocity', () => {
    const i = icon({ position: { x: 500, y: 400 }, velocity: { x: 0, y: 0 } })
    stepPhysics([i], config({ damping: 1, scrollForceMultiplier: 0.02 }), null, 100)
    expect(i.velocity.y).toBeCloseTo(2)
  })

  it('repels from the pointer when one is supplied', () => {
    const i = icon({ position: { x: 500, y: 400 } })
    stepPhysics([i], config({ damping: 1, mouseRepelRadius: 120, mouseRepelStrength: 1 }), { x: 440, y: 400 }, 0)
    expect(i.velocity.x).toBeGreaterThan(0)
  })

  it('resolves a collision between two overlapping icons on the same layer', () => {
    const a = icon({ id: 1, position: { x: 100, y: 100 }, radius: 10, mass: 10, layer: 'middle' })
    const b = icon({ id: 2, position: { x: 108, y: 100 }, radius: 10, mass: 10, layer: 'middle' })
    stepPhysics([a, b], config({ damping: 1 }), null, 0)
    expect(b.position.x - a.position.x).toBeGreaterThan(8)
  })

  it('never collides icons on different layers, which is what makes the parallax read', () => {
    // Background and foreground icons share screen space by design. Colliding across
    // layers would make distant icons shove near ones and destroy the depth illusion.
    const a = icon({ id: 1, position: { x: 100, y: 100 }, radius: 10, mass: 10, layer: 'background' })
    const b = icon({ id: 2, position: { x: 102, y: 100 }, radius: 10, mass: 10, layer: 'foreground' })
    stepPhysics([a, b], config({ damping: 1 }), null, 0)
    expect(a.position.x).toBeCloseTo(100)
    expect(b.position.x).toBeCloseTo(102)
  })

  it('finds collisions across neighbouring grid cells, not just within one', () => {
    // The grid is 100px; a pair straddling a boundary lands in different cells and is
    // only caught because neighbours are scanned too.
    const a = icon({ id: 1, position: { x: 98, y: 100 }, radius: 10, mass: 10 })
    const b = icon({ id: 2, position: { x: 105, y: 100 }, radius: 10, mass: 10 })
    stepPhysics([a, b], config({ damping: 1 }), null, 0)
    expect(b.position.x - a.position.x).toBeGreaterThan(7)
  })

  it('leaves distant icons alone', () => {
    const a = icon({ id: 1, position: { x: 100, y: 100 }, radius: 10 })
    const b = icon({ id: 2, position: { x: 700, y: 600 }, radius: 10 })
    stepPhysics([a, b], config({ damping: 1 }), null, 0)
    expect(a.position).toEqual({ x: 100, y: 100 })
    expect(b.position).toEqual({ x: 700, y: 600 })
  })

  it('handles an empty field without throwing', () => {
    expect(() => stepPhysics([], config(), null, 0)).not.toThrow()
  })
})

describe('createIcon', () => {
  /**
   * Hands back the given numbers in order, then repeats the last one.
   *
   * createIcon draws six times, in a fixed order. Giving each draw a distinct
   * value is what makes it possible to say which field received which number,
   * so a size written into opacity, or an x written into y, has somewhere to show.
   */
  const scriptedRandom = (values: number[]) => {
    let call = 0
    return () => values[Math.min(call++, values.length - 1)]
  }

  it('reads the six draws in a fixed order, so no field can take another one\'s number', () => {
    // Six distinct values. Any swap between fields moves a number somewhere it
    // does not belong, and the assertions below stop agreeing.
    const random = scriptedRandom([0, 0.5, 1, 0, 0.25, 0.75])
    const icon = createIcon(1, '', 'middle', config({ width: 1000, height: 800 }), random)

    // Draw one is size: 0 of the middle band's 40 to 60 gives 40, halved to a radius of 20.
    expect(icon.mass).toBeCloseTo(40)
    expect(icon.radius).toBeCloseTo(20)
    // Draw two is speed: 0.5 of 0.4 to 0.6 gives 0.5, which is the velocity's magnitude.
    expect(Math.hypot(icon.velocity.x, icon.velocity.y)).toBeCloseTo(0.5)
    // Draw three is opacity: 1 of 0.3 to 0.5 gives 0.5.
    expect(icon.opacity).toBeCloseTo(0.5)
    // Draws five and six place the icon across the canvas it was given.
    expect(icon.position.x).toBeCloseTo(250)
    expect(icon.position.y).toBeCloseTo(600)
  })

  it('places an icon inside the canvas it was given, not inside a fixed one', () => {
    // A source of nearly one must land just short of the far edge. Reading a
    // hard-coded width here would put icons off screen on any other canvas.
    const random = scriptedRandom([0, 0, 0, 0, 0.999, 0.999])
    const icon = createIcon(1, '', 'middle', config({ width: 300, height: 120 }), random)
    expect(icon.position.x).toBeGreaterThan(299)
    expect(icon.position.x).toBeLessThan(300)
    expect(icon.position.y).toBeGreaterThan(119)
    expect(icon.position.y).toBeLessThan(120)
  })

  it('turns the fourth draw into a direction, leaving the speed alone', () => {
    // An angle of zero points along the positive x axis. The whole speed goes
    // into x and none into y, which is what proves the angle steers direction
    // rather than magnitude.
    const random = scriptedRandom([0, 0, 0, 0, 0, 0])
    const icon = createIcon(1, '', 'background', config(), random)
    expect(icon.velocity.x).toBeCloseTo(0.2)
    expect(icon.velocity.y).toBeCloseTo(0)
  })

  it('falls back to the global generator when no source is given', () => {
    // The production call site passes no source. If the default were dropped,
    // every icon would land at the same place with the same size.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const first = createIcon(1, '', 'middle', config())
    const second = createIcon(2, '', 'middle', config())
    expect(first.mass).toBeCloseTo(50)
    expect(first.position).toEqual(second.position)
  })

  it('derives radius and mass from one size, so heavier always means bigger', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const i = createIcon(7, '/icon.png', 'middle', config())
    expect(i.radius).toBeCloseTo(i.mass / 2)
  })

  it('carries through the identity it was given', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const i = createIcon(42, '/token.svg', 'foreground', config())
    expect(i.id).toBe(42)
    expect(i.imgSrc).toBe('/token.svg')
    expect(i.layer).toBe('foreground')
    expect(i.imgElement).toBeNull()
  })

  it('sizes each layer into its own band, which is what creates depth', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const back = createIcon(1, '', 'background', config())
    const mid = createIcon(2, '', 'middle', config())
    const front = createIcon(3, '', 'foreground', config())
    expect(back.mass).toBeLessThan(mid.mass)
    expect(mid.mass).toBeLessThan(front.mass)
  })

  it('makes nearer layers both larger and more opaque', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const back = createIcon(1, '', 'background', config())
    const front = createIcon(2, '', 'foreground', config())
    expect(back.opacity).toBeLessThan(front.opacity)
  })

  it('takes the low end of every range when random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const i = createIcon(1, '', 'middle', config())
    expect(i.mass).toBeCloseTo(40)
    expect(i.opacity).toBeCloseTo(0.3)
  })

  it('takes the top of every range as random approaches 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const i = createIcon(1, '', 'middle', config())
    expect(i.mass).toBeCloseTo(60)
    expect(i.opacity).toBeCloseTo(0.5)
  })

  it('gives velocity the layer speed as its magnitude, in some direction', () => {
    // Direction is an angle so components vary, but the speed must not — otherwise
    // icons drift at rates unrelated to their layer.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const i = createIcon(1, '', 'middle', config())
    const speed = Math.hypot(i.velocity.x, i.velocity.y)
    expect(speed).toBeCloseTo(0.4)
  })

  it('places icons inside the canvas', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const c = config({ width: 1000, height: 800 })
    const i = createIcon(1, '', 'middle', c)
    expect(i.position.x).toBeGreaterThanOrEqual(0)
    expect(i.position.x).toBeLessThanOrEqual(c.width)
    expect(i.position.y).toBeGreaterThanOrEqual(0)
    expect(i.position.y).toBeLessThanOrEqual(c.height)
  })
})
