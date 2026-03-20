import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const MAX_ICONS = 80
const INITIAL_BATCH = 50
const SPAWN_INTERVAL_MS = 150
const SCROLL_SPEED_FACTOR = 0.015
const PIPE_HEIGHT = 100
const OVERFLOW_PX = 40

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

function createStreamIcon(sources: string[]): StreamIcon {
  const layer = pickLayer()
  const config = LAYER_CONFIG[layer]
  const size = Math.floor(randomBetween(config.sizeMin, config.sizeMax))
  const baseSpeed = layer === 'background' ? randomBetween(20, 35)
    : layer === 'middle' ? randomBetween(35, 55)
    : randomBetween(55, 80)
  const totalRange = PIPE_HEIGHT + OVERFLOW_PX * 2
  const y = -OVERFLOW_PX + Math.random() * (totalRange - size)

  return { id: nextId++, src: sources[Math.floor(Math.random() * sources.length)], size, speed: baseSpeed, y, x: 0, layer }
}

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<StreamIcon[]>([])
  const [renderList, setRenderList] = useState<StreamIcon[]>([])
  const scrollVelocityRef = useRef(0)
  const lastScrollYRef = useRef(0)
  const animFrameRef = useRef(0)
  const lastTsRef = useRef(0)

  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const iconSources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  // Register element ref and immediately set its position
  const refCallback = useCallback((el: HTMLImageElement | null) => {
    if (!el) return
    const id = Number(el.dataset.iconId)
    const icon = dataRef.current.find((ic) => ic.id === id)
    if (icon) {
      el.style.transform = `translate3d(${icon.x}px, 0, 0)`
    }
  }, [])

  // Init icons
  useEffect(() => {
    if (iconSources.length === 0) return
    const container = containerRef.current
    if (!container) return
    const width = container.offsetWidth

    const initial: StreamIcon[] = []
    for (let i = 0; i < INITIAL_BATCH; i++) {
      const icon = createStreamIcon(iconSources)
      icon.x = randomBetween(-icon.size * 0.5, width + icon.size * 0.5)
      initial.push(icon)
    }
    dataRef.current = initial
    setRenderList([...initial])

    let spawned = INITIAL_BATCH
    const timer = setInterval(() => {
      if (spawned >= MAX_ICONS) { clearInterval(timer); return }
      const icon = createStreamIcon(iconSources)
      icon.x = randomBetween(-icon.size * 2, -icon.size)
      dataRef.current.push(icon)
      setRenderList([...dataRef.current])
      spawned++
    }, SPAWN_INTERVAL_MS)

    // Reinitialize on resize
    const observer = new ResizeObserver(() => {
      const w = container.offsetWidth
      for (const icon of dataRef.current) {
        if (icon.x > w + icon.size) {
          icon.x = randomBetween(-icon.size * 2, -icon.size)
        }
      }
    })
    observer.observe(container)

    return () => { clearInterval(timer); observer.disconnect() }
  }, [iconSources])

  // Animation: direct DOM updates via querySelectorAll
  useEffect(() => {
    if (prefersReducedMotion || iconSources.length === 0) return

    const handleScroll = () => {
      scrollVelocityRef.current = Math.abs(window.scrollY - lastScrollYRef.current)
      lastScrollYRef.current = window.scrollY
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    const decay = setInterval(() => { scrollVelocityRef.current *= 0.85 }, 80)

    let running = true
    let needsSync = false

    const animate = (ts: number) => {
      if (!running) return
      const container = containerRef.current
      if (!container) { animFrameRef.current = requestAnimationFrame(animate); return }
      const cw = container.offsetWidth

      if (lastTsRef.current === 0) { lastTsRef.current = ts; animFrameRef.current = requestAnimationFrame(animate); return }
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.1)
      lastTsRef.current = ts
      const sm = 1 + scrollVelocityRef.current * SCROLL_SPEED_FACTOR

      // Update positions in data array
      for (let i = 0; i < dataRef.current.length; i++) {
        const icon = dataRef.current[i]
        icon.x += icon.speed * dt * sm

        if (icon.x > cw + icon.size) {
          const fresh = createStreamIcon(iconSources)
          fresh.x = randomBetween(-fresh.size * 2, -fresh.size)
          dataRef.current[i] = fresh
          needsSync = true
        }
      }

      // Update DOM directly
      const imgs = container.querySelectorAll<HTMLImageElement>('img[data-icon-id]')
      for (const img of imgs) {
        const id = Number(img.dataset.iconId)
        const icon = dataRef.current.find((ic) => ic.id === id)
        if (icon) {
          img.style.transform = `translate3d(${icon.x}px, 0, 0)`
        }
      }

      // Sync React when icons get replaced
      if (needsSync) {
        needsSync = false
        setRenderList([...dataRef.current])
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('scroll', handleScroll)
      clearInterval(decay)
      lastTsRef.current = 0
    }
  }, [prefersReducedMotion, iconSources])

  return (
    <div
      ref={containerRef}
      className={`relative w-full pointer-events-none ${className ?? ''}`}
      style={{ height: PIPE_HEIGHT, clipPath: `inset(${-OVERFLOW_PX}px 0px ${-OVERFLOW_PX}px 0px)` }}
      aria-hidden="true"
    >
      {renderList.map((icon) => (
        <img
          key={icon.id}
          ref={refCallback}
          data-icon-id={icon.id}
          src={icon.src}
          alt=""
          draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          className="absolute rounded-full"
          style={{
            top: `${icon.y}px`,
            left: 0,
            width: icon.size,
            height: icon.size,
            transform: `translate3d(${icon.x}px, 0, 0)`,
            willChange: prefersReducedMotion ? 'auto' : 'transform',
            zIndex: LAYER_CONFIG[icon.layer].zIndex,
          }}
        />
      ))}
    </div>
  )
}
