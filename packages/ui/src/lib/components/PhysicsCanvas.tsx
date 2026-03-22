import { useEffect, useRef, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'
import { stepPhysics, createIcon } from '../physics/engine'
import { computeEdgeOpacity } from '../physics/forces'
import type { PhysicsIcon, PhysicsConfig, Vector2D } from '../physics/types'
import { DEFAULT_CONFIG } from '../physics/types'

const ICON_COUNT = 70
const MONSTER_CHANCE = 0.04
const MONSTER_SIZE = 168

export default function PhysicsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iconsRef = useRef<PhysicsIcon[]>([])
  const configRef = useRef<PhysicsConfig>({ ...DEFAULT_CONFIG })
  const mousePosRef = useRef<Vector2D | null>(null)
  const scrollDeltaRef = useRef(0)
  const lastScrollY = useRef(0)
  const animFrameRef = useRef<number>(0)
  const { metrics, providers: contextProviders, fetchProviders } = useMetricsContext()

  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const buildIconSources = useCallback(
    async (tokenSources: string[]): Promise<string[]> => {
      if (!metrics) return []

      const networkSources = metrics.networks.supported
        .slice(0, 25)
        .map((net) => getApiUrl(`/image/${net.chainId}`))

      return [...networkSources, ...tokenSources]
    },
    [metrics],
  )

  const fetchTokenSources = useCallback(async (): Promise<string[]> => {
    try {
      const providersList = contextProviders.length ? contextProviders : await fetchProviders()
      if (!providersList.length) return []

      const firstProviders = providersList.slice(0, 3).map((p) => p.providerKey)

      const tokenAddresses: string[] = []
      await Promise.all(
        firstProviders.map(async (providerKey) => {
          try {
            const listResponse = await fetch(getApiUrl(`/list/${providerKey}`))
            if (!listResponse.ok) return
            const data = (await listResponse.json()) as { tokens: Array<{ chainId: number; address: string }> }
            const tokens = data.tokens ?? []
            for (const token of tokens.slice(0, 10)) {
              tokenAddresses.push(getApiUrl(`/image/${token.chainId}/${token.address}`))
            }
          } catch {
            // skip failed provider
          }
        }),
      )

      return tokenAddresses
    } catch {
      return []
    }
  }, [])

  const initIcons = useCallback(async () => {
    if (!metrics) return

    const config = configRef.current
    const tokenSources = await fetchTokenSources()
    const sources = await buildIconSources(tokenSources)

    if (sources.length < 10) return

    const icons: PhysicsIcon[] = []
    for (let i = 0; i < ICON_COUNT; i++) {
      const src = sources[i % sources.length]
      const isMonster = Math.random() < MONSTER_CHANCE
      const layerRoll = Math.random()
      const layer: PhysicsIcon['layer'] =
        layerRoll < 0.3 ? 'background' : layerRoll < 0.65 ? 'middle' : 'foreground'

      const icon = createIcon(i, src, layer, config)

      if (isMonster) {
        icon.radius = MONSTER_SIZE / 2
        icon.mass = MONSTER_SIZE
        icon.opacity = 0.4
      }

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = icon.imgSrc
      img.onload = () => {
        icon.imgElement = img
      }
      icons.push(icon)
    }

    iconsRef.current = icons
  }, [metrics, fetchTokenSources, buildIconSources])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const config = configRef.current

    ctx.clearRect(0, 0, config.width, config.height)

    const layers: PhysicsIcon['layer'][] = ['background', 'middle', 'foreground']
    for (const layer of layers) {
      for (const icon of iconsRef.current) {
        if (icon.layer !== layer || !icon.imgElement) continue
        const alpha = computeEdgeOpacity(icon, config)
        if (alpha <= 0) continue
        ctx.globalAlpha = alpha
        const size = icon.radius * 2
        ctx.save()
        ctx.beginPath()
        ctx.arc(icon.position.x, icon.position.y, icon.radius, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(
          icon.imgElement,
          icon.position.x - icon.radius,
          icon.position.y - icon.radius,
          size,
          size,
        )
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }, [])

  const loop = useCallback(() => {
    if (prefersReducedMotion.current) return

    const scrollDelta = scrollDeltaRef.current
    scrollDeltaRef.current = 0

    stepPhysics(iconsRef.current, configRef.current, mousePosRef.current, scrollDelta)
    render()
    animFrameRef.current = requestAnimationFrame(loop)
  }, [render])

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      configRef.current.width = window.innerWidth
      configRef.current.height = window.innerHeight
    }

    const handleScroll = () => {
      const delta = window.scrollY - lastScrollY.current
      scrollDeltaRef.current += delta
      lastScrollY.current = window.scrollY
    }

    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseLeave = () => {
      mousePosRef.current = null
    }

    handleResize()
    void initIcons()

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)

    if (!prefersReducedMotion.current) {
      animFrameRef.current = requestAnimationFrame(loop)
    } else {
      render()
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [initIcons, loop, render])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  )
}
