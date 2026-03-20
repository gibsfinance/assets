import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const MAX_ICONS = 40
const INITIAL_BATCH = 5
const SPAWN_INTERVAL_MS = 300
const SCROLL_SPEED_FACTOR = 0.015
const PIPE_HEIGHT = 120
const OVERFLOW_PX = 20

type Layer = 'background' | 'middle' | 'foreground'

interface StreamIcon {
  id: number
  src: string
  size: number
  speed: number
  y: number
  x: number
  layer: Layer
}

const LAYER_CONFIG: Record<Layer, { sizeMin: number; sizeMax: number; zIndex: number }> = {
  background: { sizeMin: 20, sizeMax: 30, zIndex: 0 },
  middle: { sizeMin: 36, sizeMax: 52, zIndex: 1 },
  foreground: { sizeMin: 56, sizeMax: 72, zIndex: 2 },
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickLayer(): Layer {
  const roll = Math.random()
  if (roll < 0.35) return 'background'
  if (roll < 0.7) return 'middle'
  return 'foreground'
}

let nextId = 0

function createStreamIcon(sources: string[], size?: number): StreamIcon {
  const layer = pickLayer()
  const config = LAYER_CONFIG[layer]
  const iconSize = size ?? Math.floor(randomBetween(config.sizeMin, config.sizeMax))

  const baseSpeed = layer === 'background' ? randomBetween(20, 35)
    : layer === 'middle' ? randomBetween(35, 55)
    : randomBetween(55, 80)

  // y ranges from -OVERFLOW_PX to PIPE_HEIGHT + OVERFLOW_PX (icons can poke out top and bottom)
  const totalRange = PIPE_HEIGHT + OVERFLOW_PX * 2
  const y = -OVERFLOW_PX + Math.random() * (totalRange - iconSize)

  return {
    id: nextId++,
    src: sources[Math.floor(Math.random() * sources.length)],
    size: iconSize,
    speed: baseSpeed,
    y,
    x: 0, // always spawn at left edge (caller sets actual x)
    layer,
  }
}

interface FloatingIconsProps {
  className?: string
}

export default function FloatingIcons({ className }: FloatingIconsProps) {
  const { metrics } = useMetricsContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const iconsRef = useRef<StreamIcon[]>([])
  const elementsRef = useRef<Map<number, HTMLImageElement>>(new Map())
  const animFrameRef = useRef(0)
  const lastTimestampRef = useRef(0)
  const scrollVelocityRef = useRef(0)
  const lastScrollYRef = useRef(0)
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [_renderKey, setRenderKey] = useState(0)
  const triggerRender = useCallback(() => setRenderKey((k) => k + 1), [])

  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const iconSources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  const setElementRef = useCallback((id: number, element: HTMLImageElement | null) => {
    if (element) {
      elementsRef.current.set(id, element)
    } else {
      elementsRef.current.delete(id)
    }
  }, [])

  // Staggered initialization: start with a few, add more over time
  useEffect(() => {
    if (iconSources.length === 0) return
    const container = containerRef.current
    if (!container) return

    // Start with initial batch spread across the left half
    const width = container.offsetWidth
    const icons: StreamIcon[] = []
    for (let i = 0; i < INITIAL_BATCH; i++) {
      const icon = createStreamIcon(iconSources)
      icon.x = randomBetween(-icon.size, width * 0.4)
      icons.push(icon)
    }
    iconsRef.current = icons
    triggerRender()

    // Gradually add more icons from the left
    let spawned = INITIAL_BATCH
    spawnTimerRef.current = setInterval(() => {
      if (spawned >= MAX_ICONS) {
        if (spawnTimerRef.current) clearInterval(spawnTimerRef.current)
        return
      }
      const icon = createStreamIcon(iconSources)
      icon.x = randomBetween(-icon.size * 2, -icon.size)
      iconsRef.current.push(icon)
      spawned++
      triggerRender()
    }, SPAWN_INTERVAL_MS)

    return () => {
      if (spawnTimerRef.current) clearInterval(spawnTimerRef.current)
    }
  }, [iconSources, triggerRender])

  // Animation loop
  useEffect(() => {
    if (prefersReducedMotion.current) return

    const handleScroll = () => {
      const currentY = window.scrollY
      scrollVelocityRef.current = Math.abs(currentY - lastScrollYRef.current)
      lastScrollYRef.current = currentY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    const decayInterval = setInterval(() => {
      scrollVelocityRef.current *= 0.85
    }, 80)

    let running = true
    let needsReactSync = false

    const animate = (timestamp: number) => {
      if (!running) return
      const container = containerRef.current
      if (!container) {
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const containerWidth = container.offsetWidth

      if (lastTimestampRef.current === 0) {
        lastTimestampRef.current = timestamp
        animFrameRef.current = requestAnimationFrame(animate)
        return
      }

      const deltaSeconds = Math.min((timestamp - lastTimestampRef.current) / 1000, 0.1)
      lastTimestampRef.current = timestamp

      const scrollMultiplier = 1 + scrollVelocityRef.current * SCROLL_SPEED_FACTOR

      for (let i = iconsRef.current.length - 1; i >= 0; i--) {
        const icon = iconsRef.current[i]
        icon.x += icon.speed * deltaSeconds * scrollMultiplier

        // Icon exited right side — replace with new one entering from left
        if (icon.x > containerWidth + icon.size) {
          elementsRef.current.delete(icon.id)

          const newIcon = createStreamIcon(iconSources)
          newIcon.x = randomBetween(-newIcon.size * 2, -newIcon.size)
          iconsRef.current[i] = newIcon
          needsReactSync = true
          continue
        }

        const element = elementsRef.current.get(icon.id)
        if (!element) continue

        element.style.transform = `translate3d(${icon.x}px, 0, 0)`
      }

      if (needsReactSync) {
        needsReactSync = false
        triggerRender()
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('scroll', handleScroll)
      clearInterval(decayInterval)
      lastTimestampRef.current = 0
    }
  }, [iconSources, triggerRender])

  const currentIcons = iconsRef.current

  return (
    <div
      ref={containerRef}
      className={`relative w-full pointer-events-none ${className ?? ''}`}
      style={{
        height: PIPE_HEIGHT,
        // Clip left/right but allow top/bottom overflow for the conveyor effect
        clipPath: `inset(${-OVERFLOW_PX}px 0px ${-OVERFLOW_PX}px 0px)`,
      }}
      aria-hidden="true"
    >
      {currentIcons.map((icon) => (
        <img
          key={icon.id}
          ref={(el) => setElementRef(icon.id, el)}
          src={icon.src}
          alt=""
          draggable={false}
          className="absolute rounded-full"
          style={{
            top: icon.y,
            left: 0,
            width: icon.size,
            height: icon.size,
            transform: `translate3d(${icon.x}px, 0, 0)`,
            willChange: prefersReducedMotion.current ? 'auto' : 'transform',
            zIndex: LAYER_CONFIG[icon.layer].zIndex,
          }}
        />
      ))}
    </div>
  )
}
