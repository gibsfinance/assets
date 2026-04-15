import type { PhysicsIcon, PhysicsConfig, Vector2D, SpatialCell } from './types'
import { applyWallBounce, applyMouseRepel, applyScrollForce, resolveCollision } from './forces'

const CELL_SIZE = 100

function buildSpatialGrid(icons: PhysicsIcon[]): Map<string, SpatialCell> {
  const grid = new Map<string, SpatialCell>()
  for (const icon of icons) {
    const cx = Math.floor(icon.position.x / CELL_SIZE)
    const cy = Math.floor(icon.position.y / CELL_SIZE)
    const key = `${cx},${cy}`
    let cell = grid.get(key)
    if (!cell) {
      cell = { icons: [] }
      grid.set(key, cell)
    }
    cell.icons.push(icon)
  }
  return grid
}

function checkCollisionsInGrid(
  grid: Map<string, SpatialCell>,
  config: PhysicsConfig,
): void {
  const checked = new Set<string>()
  for (const [key, cell] of grid) {
    const [cx, cy] = key.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${cx + dx},${cy + dy}`
        if (checked.has(`${key}-${neighborKey}`)) continue
        checked.add(`${key}-${neighborKey}`)
        checked.add(`${neighborKey}-${key}`)
        const neighbor = grid.get(neighborKey)
        if (!neighbor) continue
        const iconsA = cell.icons
        const iconsB = key === neighborKey ? iconsA : neighbor.icons
        for (let i = 0; i < iconsA.length; i++) {
          const startJ = key === neighborKey ? i + 1 : 0
          for (let j = startJ; j < iconsB.length; j++) {
            if (iconsA[i].layer !== iconsB[j].layer) continue
            resolveCollision(iconsA[i], iconsB[j], config.collisionDamping)
          }
        }
      }
    }
  }
}

export function stepPhysics(
  icons: PhysicsIcon[],
  config: PhysicsConfig,
  mousePos: Vector2D | null,
  scrollDelta: number,
): void {
  for (const icon of icons) {
    applyMouseRepel(icon, mousePos, config)
    if (scrollDelta !== 0) {
      applyScrollForce(icon, scrollDelta, config)
    }
  }

  for (const icon of icons) {
    icon.velocity.x *= config.damping
    icon.velocity.y *= config.damping
    icon.position.x += icon.velocity.x
    icon.position.y += icon.velocity.y
    applyWallBounce(icon, config)
  }

  const grid = buildSpatialGrid(icons)
  checkCollisionsInGrid(grid, config)
}

export function createIcon(
  id: number,
  imgSrc: string,
  layer: PhysicsIcon['layer'],
  config: PhysicsConfig,
): PhysicsIcon {
  const layerConfig = {
    background: { sizeRange: [20, 30], speedRange: [0.2, 0.4], opacity: [0.15, 0.25] },
    middle: { sizeRange: [40, 60], speedRange: [0.4, 0.6], opacity: [0.3, 0.5] },
    foreground: { sizeRange: [60, 80], speedRange: [0.6, 0.8], opacity: [0.5, 0.7] },
  }[layer]

  const size = layerConfig.sizeRange[0] + Math.random() * (layerConfig.sizeRange[1] - layerConfig.sizeRange[0])
  const speed = layerConfig.speedRange[0] + Math.random() * (layerConfig.speedRange[1] - layerConfig.speedRange[0])
  const opacity = layerConfig.opacity[0] + Math.random() * (layerConfig.opacity[1] - layerConfig.opacity[0])
  const angle = Math.random() * Math.PI * 2

  return {
    id,
    position: {
      x: Math.random() * config.width,
      y: Math.random() * config.height,
    },
    velocity: {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    },
    radius: size / 2,
    mass: size,
    layer,
    opacity,
    imgSrc,
    imgElement: null,
  }
}
