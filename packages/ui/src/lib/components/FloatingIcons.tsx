import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const VISIBLE_COUNT = 40
const SCROLL_SPEED_FACTOR = 0.015

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

function createStreamIcon(sources: string[], containerWidth: number, spawnAtLeft: boolean): StreamIcon {
  const layer = pickLayer()
  const config = LAYER_CONFIG[layer]
  const size = Math.floor(randomBetween(config.sizeMin, config.sizeMax))

  // Foreground icons move faster than background — creates depth/parallax
  const baseSpeed = layer === 'background' ? randomBetween(20, 35)
    : layer === 'middle' ? randomBetween(35, 55)
    : randomBetween(55, 80)

  return {
    id: nextId++,
    src: sources[Math.floor(Math.random() * sources.length)],
    size,
    speed: baseSpeed,
    y: randomBetween(5, 85),
    x: spawnAtLeft ? randomBetween(-size * 2, -size) : randomBetween(-size, containerWidth + size),
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

  // Initialize icons spread across the container
  useEffect(() => {
    if (iconSources.length === 0) return
    const container = containerRef.current
    if (!container) return
    const width = container.offsetWidth

    const icons: StreamIcon[] = []
    for (let i = 0; i < VISIBLE_COUNT; i++) {
      icons.push(createStreamIcon(iconSources, width, false))
    }
    iconsRef.current = icons
    triggerRender()
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

        // Icon exited right side — remove and spawn new one on left
        if (icon.x > containerWidth + icon.size) {
          elementsRef.current.delete(icon.id)

          const newIcon = createStreamIcon(iconSources, containerWidth, true)
          iconsRef.current[i] = newIcon
          needsReactSync = true
          continue
        }

        const element = elementsRef.current.get(icon.id)
        if (!element) continue

        element.style.transform = `translate3d(${icon.x}px, 0, 0)`
      }

      // Batch React sync for new icons
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

  // Sync React render with current icon state
  const currentIcons = iconsRef.current

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden pointer-events-none ${className ?? ''}`}
      style={{ height: 120 }}
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
            top: `${icon.y}%`,
            left: 0,
            width: icon.size,
            height: icon.size,
            opacity: 1,
            transform: `translate3d(${icon.x}px, 0, 0)`,
            willChange: prefersReducedMotion.current ? 'auto' : 'transform',
            zIndex: LAYER_CONFIG[icon.layer].zIndex,
          }}
        />
      ))}
    </div>
  )
}
