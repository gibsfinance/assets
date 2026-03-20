import { useMemo, useEffect, useRef, useState } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const ICONS_PER_ROW = 40
const SIZES = [32, 40, 48]
const DURATIONS = [35, 45, 30]
const DIRECTIONS: Array<'normal' | 'reverse'> = ['normal', 'reverse', 'normal']

let keyframesInjected = false
function ensureKeyframes() {
  if (keyframesInjected) return
  keyframesInjected = true
  const style = document.createElement('style')
  style.textContent = '@keyframes conveyor{from{transform:translateX(0)}to{transform:translateX(-50%)}}'
  document.head.appendChild(style)
}

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()
  const row0 = useRef<HTMLDivElement>(null)
  const row1 = useRef<HTMLDivElement>(null)
  const row2 = useRef<HTMLDivElement>(null)
  const rowRefs = [row0, row1, row2]
  const [tokenSources, setTokenSources] = useState<string[]>([])

  // Network icons (always available from metrics)
  const networkSources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  // Fetch token icons from a couple of lists for variety
  useEffect(() => {
    if (!metrics || networkSources.length === 0) return
    const controller = new AbortController()

    async function fetchTokenIcons() {
      try {
        const res = await fetch(getApiUrl('/list'), { signal: controller.signal })
        if (!res.ok) return
        const lists = await res.json() as Array<{ providerKey: string; key: string }>
        // Pick first 2 lists
        // Fetch from multiple lists across different chains for max diversity
        const chainIds = ['1', '369', '56', '137', '42161']
        const urls = new Set<string>()

        for (const list of lists.slice(0, 5)) {
          for (const chainId of chainIds) {
            if (urls.size >= 500) break
            try {
              const listRes = await fetch(
                getApiUrl(`/list/${list.providerKey}/${list.key}?chainId=${chainId}`),
                { signal: controller.signal },
              )
              if (!listRes.ok) continue
              const tokens = await listRes.json() as Array<{ chainId: number; address: string }>
              for (const t of tokens.slice(0, 50)) {
                urls.add(getApiUrl(`/image/${t.chainId}/${t.address}`))
              }
            } catch { /* skip */ }
          }
        }

        if (urls.size > 0) setTokenSources([...urls])
      } catch { /* aborted or failed */ }
    }

    void fetchTokenIcons()
    return () => controller.abort()
  }, [metrics, networkSources])

  // Combine network + token sources, shuffle
  const sources = useMemo(() => {
    const all = [...networkSources, ...tokenSources]
    if (all.length === 0) return []
    // Fisher-Yates shuffle
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[all[i], all[j]] = [all[j], all[i]]
    }
    return all
  }, [networkSources, tokenSources])

  // Inject keyframes and apply animation via JS to bypass Tailwind CSS layer overrides
  useEffect(() => {
    ensureKeyframes()
    for (let i = 0; i < rowRefs.length; i++) {
      const el = rowRefs[i].current
      if (!el) continue
      el.style.setProperty('animation', `conveyor ${DURATIONS[i]}s linear infinite ${DIRECTIONS[i]}`, 'important')
    }
  })

  if (sources.length === 0) return null

  return (
    <div className={`overflow-hidden space-y-2 ${className ?? ''}`} aria-hidden="true">
      {[0, 1, 2].map((rowIdx) => {
        // Each row draws unique icons — no repeats across all 3 rows if pool is big enough
        const start = rowIdx * ICONS_PER_ROW
        const icons = sources.length >= ICONS_PER_ROW * 3
          ? sources.slice(start, start + ICONS_PER_ROW)
          : Array.from({ length: ICONS_PER_ROW }, (_, i) => sources[(start + i) % sources.length])
        const doubled = [...icons, ...icons]
        return (
          <div key={rowIdx} className="overflow-hidden">
            <div
              ref={rowRefs[rowIdx]}
              className="flex gap-4 items-center"
              style={{ width: 'max-content' }}
            >
              {doubled.map((src, i) => (
                <img
                  key={`${rowIdx}-${i}`}
                  src={src}
                  alt=""
                  draggable={false}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  className="rounded-full shrink-0"
                  style={{ width: SIZES[rowIdx], height: SIZES[rowIdx] }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
