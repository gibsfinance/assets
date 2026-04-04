export interface Vector2D {
  x: number
  y: number
}

export interface PhysicsIcon {
  id: number
  position: Vector2D
  velocity: Vector2D
  radius: number
  mass: number
  layer: 'background' | 'middle' | 'foreground'
  opacity: number
  imgSrc: string
  imgElement: HTMLImageElement | null
}

export interface PhysicsConfig {
  width: number
  height: number
  damping: number
  wallDamping: number
  collisionDamping: number
  edgeFadePercent: number
  mouseRepelRadius: number
  mouseRepelStrength: number
  scrollForceMultiplier: number
}

export interface SpatialCell {
  icons: PhysicsIcon[]
}

export const DEFAULT_CONFIG: PhysicsConfig = {
  width: 0,
  height: 0,
  damping: 0.999,
  wallDamping: 0.9,
  collisionDamping: 0.85,
  edgeFadePercent: 0.05,
  mouseRepelRadius: 120,
  mouseRepelStrength: 0.5,
  scrollForceMultiplier: 0.02,
}
