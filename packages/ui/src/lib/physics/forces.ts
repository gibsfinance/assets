import type { PhysicsIcon, PhysicsConfig, Vector2D } from './types'

export function applyWallBounce(icon: PhysicsIcon, config: PhysicsConfig): void {
  const { radius, position, velocity } = icon
  const { width, height, wallDamping } = config

  if (position.x - radius < 0) {
    position.x = radius
    velocity.x = Math.abs(velocity.x) * wallDamping
  } else if (position.x + radius > width) {
    position.x = width - radius
    velocity.x = -Math.abs(velocity.x) * wallDamping
  }

  if (position.y - radius < 0) {
    position.y = radius
    velocity.y = Math.abs(velocity.y) * wallDamping
  } else if (position.y + radius > height) {
    position.y = height - radius
    velocity.y = -Math.abs(velocity.y) * wallDamping
  }
}

export function applyMouseRepel(
  icon: PhysicsIcon,
  mousePos: Vector2D | null,
  config: PhysicsConfig,
): void {
  if (!mousePos) return
  const dx = icon.position.x - mousePos.x
  const dy = icon.position.y - mousePos.y
  const distSq = dx * dx + dy * dy
  const { mouseRepelRadius, mouseRepelStrength } = config
  if (distSq > mouseRepelRadius * mouseRepelRadius || distSq < 1) return
  const dist = Math.sqrt(distSq)
  const force = (mouseRepelStrength * (mouseRepelRadius - dist)) / mouseRepelRadius
  icon.velocity.x += (dx / dist) * force
  icon.velocity.y += (dy / dist) * force
}

export function applyScrollForce(
  icon: PhysicsIcon,
  scrollDelta: number,
  config: PhysicsConfig,
): void {
  icon.velocity.y += scrollDelta * config.scrollForceMultiplier
  const centerX = config.width / 2
  const dx = icon.position.x - centerX
  icon.velocity.x += Math.sign(dx) * Math.abs(scrollDelta) * config.scrollForceMultiplier * 0.3
}

export function resolveCollision(a: PhysicsIcon, b: PhysicsIcon, damping: number): void {
  const dx = b.position.x - a.position.x
  const dy = b.position.y - a.position.y
  const distSq = dx * dx + dy * dy
  const minDist = a.radius + b.radius
  if (distSq >= minDist * minDist || distSq < 1) return

  const dist = Math.sqrt(distSq)
  const nx = dx / dist
  const ny = dy / dist

  const overlap = minDist - dist
  const totalMass = a.mass + b.mass
  a.position.x -= (nx * overlap * b.mass) / totalMass
  a.position.y -= (ny * overlap * b.mass) / totalMass
  b.position.x += (nx * overlap * a.mass) / totalMass
  b.position.y += (ny * overlap * a.mass) / totalMass

  const dvx = a.velocity.x - b.velocity.x
  const dvy = a.velocity.y - b.velocity.y
  const dvDotN = dvx * nx + dvy * ny
  if (dvDotN > 0) return

  const impulse = ((2 * dvDotN) / totalMass) * damping
  a.velocity.x -= impulse * b.mass * nx
  a.velocity.y -= impulse * b.mass * ny
  b.velocity.x += impulse * a.mass * nx
  b.velocity.y += impulse * a.mass * ny
}

export function computeEdgeOpacity(
  icon: PhysicsIcon,
  config: PhysicsConfig,
): number {
  const { position, radius } = icon
  const { width, height, edgeFadePercent } = config
  const fadeX = width * edgeFadePercent
  const fadeY = height * edgeFadePercent

  let opacity = icon.opacity
  if (position.x - radius < fadeX) {
    opacity *= Math.max(0, (position.x - radius) / fadeX)
  }
  if (position.x + radius > width - fadeX) {
    opacity *= Math.max(0, (width - position.x - radius) / fadeX)
  }
  if (position.y - radius < fadeY) {
    opacity *= Math.max(0, (position.y - radius) / fadeY)
  }
  if (position.y + radius > height - fadeY) {
    opacity *= Math.max(0, (height - position.y - radius) / fadeY)
  }
  return Math.max(0, Math.min(1, opacity))
}
