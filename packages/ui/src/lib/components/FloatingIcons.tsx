import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const ICON_COUNT_MIN = 20
const ICON_COUNT_MAX = 30
const MONSTER_CHANCE = 0.04
const MONSTER_SIZE = 168
const EDGE_FADE_PERCENT = 0.05
const IDLE_TRAVERSAL_SECONDS_MIN = 80
const IDLE_TRAVERSAL_SECONDS_MAX = 110
const SCROLL_SPEED_FACTOR = 0.02

type Layer = 'background' | 'middle' | 'foreground'

interface FloatingIcon {
  id: number
  src: string
  size: number
  speed: number
  direction: 1 | -1
  y: number
  x: number
  baseOpacity: number
  layer: Layer
}

const LAYER_CONFIG: Record<Layer, { sizeMin: number; sizeMax: number; opacity: number; zIndex: number }> = {
  background: { sizeMin: 20, sizeMax: 30, opacity: 0.15, zIndex: 0 },
  middle: { sizeMin: 40, sizeMax: 60, opacity: 0.25, zIndex: 1 },
  foreground: { sizeMin: 60, sizeMax: 80, opacity: 0.35, zIndex: 2 },
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickLayer(): Layer {
  const roll = Math.random()
  if (roll < 0.3) return 'background'
  if (roll < 0.65) return 'middle'
  return 'foreground'
}

function computeEdgeOpacity(x: number, size: number, containerWidth: number): number {
  if (containerWidth <= 0) return 0

  const fadeDistance = containerWidth * EDGE_FADE_PERCENT
  const iconCenter = x + size / 2

  if (iconCenter < fadeDistance) {
    return Math.max(0, iconCenter / fadeDistance)
  }

  if (iconCenter > containerWidth - fadeDistance) {
    return Math.max(0, (containerWidth - iconCenter) / fadeDistance)
  }

  return 1
}

function generateIcons(sources: string[], containerWidth: number): FloatingIcon[] {
  if (sources.length === 0 || containerWidth <= 0) return []

  const count = Math.floor(randomBetween(ICON_COUNT_MIN, ICON_COUNT_MAX + 1))
  const icons: FloatingIcon[] = []

  for (let i = 0; i < count; i++) {
    const src = sources[i % sources.length]
    const isMonster = Math.random() < MONSTER_CHANCE
    const layer = pickLayer()
    const layerConfig = LAYER_CONFIG[layer]

    const size = isMonster ? MONSTER_SIZE : Math.floor(randomBetween(layerConfig.sizeMin, layerConfig.sizeMax))
    const baseOpacity = isMonster ? 0.4 : layerConfig.opacity

    const traversalTime = randomBetween(IDLE_TRAVERSAL_SECONDS_MIN, IDLE_TRAVERSAL_SECONDS_MAX)
    const speed = (containerWidth + size) / traversalTime

    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1

    icons.push({
      id: i,
      src,
      size,
      speed,
      direction,
      y: randomBetween(5, 90),
      x: randomBetween(-size, containerWidth),
      baseOpacity,
      layer,
    })
  }

  return icons
}

interface FloatingIconsProps {
  className?: string
}

export default function FloatingIcons({ className }: FloatingIconsProps) {
  const { metrics } = useMetricsContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const [icons, setIcons] = useState<FloatingIcon[]>([])
  const iconsRef = useRef<FloatingIcon[]>([])
  const elementsRef = useRef<Map<number, HTMLImageElement>>(new Map())
  const animFrameRef = useRef(0)
  const lastTimestampRef = useRef(0)
  const scrollVelocityRef = useRef(0)
  const lastScrollYRef = useRef(0)

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

  // Initialize icons when sources become available
  useEffect(() => {
    if (iconSources.length === 0) return

    const container = containerRef.current
    if (!container) return

    const width = container.offsetWidth
    const generated = generateIcons(iconSources, width)
    iconsRef.current = generated
    setIcons(generated)
  }, [iconSources])

  // Animation loop — updates DOM directly via refs, no React re-renders
  useEffect(() => {
    if (prefersReducedMotion.current) return

    const handleScroll = () => {
      const currentY = window.scrollY
      const delta = Math.abs(currentY - lastScrollYRef.current)
      scrollVelocityRef.current = delta
      lastScrollYRef.current = currentY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })

    const decayInterval = setInterval(() => {
      scrollVelocityRef.current *= 0.9
    }, 100)

    let running = true

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

      const deltaSeconds = (timestamp - lastTimestampRef.current) / 1000
      lastTimestampRef.current = timestamp

      // Cap delta to prevent huge jumps after tab switch
      const clampedDelta = Math.min(deltaSeconds, 0.1)
      const scrollMultiplier = 1 + scrollVelocityRef.current * SCROLL_SPEED_FACTOR

      for (const icon of iconsRef.current) {
        icon.x += icon.speed * icon.direction * clampedDelta * scrollMultiplier

        // Wrap around when icon fully exits
        if (icon.direction === 1 && icon.x > containerWidth + icon.size) {
          icon.x = -icon.size
        } else if (icon.direction === -1 && icon.x < -icon.size) {
          icon.x = containerWidth + icon.size
        }

        const element = elementsRef.current.get(icon.id)
        if (!element) continue

        const edgeOpacity = computeEdgeOpacity(icon.x, icon.size, containerWidth)
        const finalOpacity = icon.baseOpacity * edgeOpacity

        element.style.transform = `translate3d(${icon.x}px, 0, 0)`
        element.style.opacity = String(finalOpacity)
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
  }, [])

  // Re-generate icons on container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let skipFirst = true
    const observer = new ResizeObserver(() => {
      // Skip the initial observation (icons already generated in the init effect)
      if (skipFirst) {
        skipFirst = false
        return
      }
      if (iconSources.length === 0) return
      const width = container.offsetWidth
      const generated = generateIcons(iconSources, width)
      iconsRef.current = generated
      setIcons(generated)
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [iconSources])

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className ?? ''}`}
      aria-hidden="true"
    >
      {icons.map((icon) => (
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
            opacity: prefersReducedMotion.current ? icon.baseOpacity : 0,
            transform: `translate3d(${icon.x}px, 0, 0)`,
            willChange: prefersReducedMotion.current ? 'auto' : 'transform, opacity',
            zIndex: LAYER_CONFIG[icon.layer].zIndex,
          }}
        />
      ))}
    </div>
  )
}
