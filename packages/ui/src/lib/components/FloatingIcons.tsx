import { useEffect, useRef, useState, useMemo } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const ICONS_PER_ROW = 40
const SIZES = [24, 28, 32]
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

/** Preload an image — resolves with the URL if it loads, rejects if it fails */
function preloadImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = () => reject()
    img.src = url
  })
}

/** Shuffle array in place */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()
  const row0 = useRef<HTMLDivElement>(null)
  const row1 = useRef<HTMLDivElement>(null)
  const row2 = useRef<HTMLDivElement>(null)
  const rowRefs = [row0, row1, row2]
  const [validSources, setValidSources] = useState<string[]>([])

  // Gather candidate URLs
  const candidates = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  // Preload network icons, then fetch + preload token icons
  useEffect(() => {
    if (candidates.length === 0) return
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      // Phase 1: validate network icons
      const networkResults = await Promise.allSettled(candidates.map(preloadImage))
      const good: string[] = networkResults
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value)

      if (cancelled) return
      if (good.length > 0) setValidSources(shuffle([...good]))

      // Phase 2: fetch token lists for more icons
      try {
        const res = await fetch(getApiUrl('/list'), { signal: controller.signal })
        if (!res.ok) return
        const lists = await res.json() as Array<{ providerKey: string; key: string }>
        const chainIds = ['1', '369', '56', '137', '42161']
        const tokenUrls = new Set<string>()

        for (const list of lists.slice(0, 5)) {
          for (const chainId of chainIds) {
            if (tokenUrls.size >= 500 || cancelled) break
            try {
              const listRes = await fetch(
                getApiUrl(`/list/${list.providerKey}/${list.key}?chainId=${chainId}`),
                { signal: controller.signal },
              )
              if (!listRes.ok) continue
              const tokens = await listRes.json() as Array<{ chainId: number; address: string }>
              for (const t of tokens.slice(0, 50)) {
                tokenUrls.add(getApiUrl(`/image/${t.chainId}/${t.address}`))
              }
            } catch { /* skip */ }
          }
        }

        if (cancelled) return

        // Preload token icons in batches of 20
        const urlArr = [...tokenUrls]
        const tokenGood: string[] = []
        for (let i = 0; i < urlArr.length; i += 20) {
          const batch = urlArr.slice(i, i + 20)
          const results = await Promise.allSettled(batch.map(preloadImage))
          for (const r of results) {
            if (r.status === 'fulfilled') tokenGood.push(r.value)
          }
          // Update as we go so the conveyor fills up progressively
          if (!cancelled && tokenGood.length > 0) {
            setValidSources(shuffle([...good, ...tokenGood]))
          }
        }
      } catch { /* aborted */ }
    }

    void load()
    return () => { cancelled = true; controller.abort() }
  }, [candidates])

  // Apply animation via JS
  useEffect(() => {
    ensureKeyframes()
    for (let i = 0; i < rowRefs.length; i++) {
      const el = rowRefs[i].current
      if (!el) continue
      el.style.setProperty('animation', `conveyor ${DURATIONS[i]}s linear infinite ${DIRECTIONS[i]}`, 'important')
    }
  })

  if (validSources.length === 0) return null

  return (
    <div className={`overflow-hidden space-y-1 ${className ?? ''}`} aria-hidden="true">
      {[0, 1, 2].map((rowIdx) => {
        const perRow = ICONS_PER_ROW * 2
        const rowIcons: string[] = []
        for (let i = 0; i < perRow; i++) {
          rowIcons.push(validSources[(rowIdx * perRow + i) % validSources.length])
        }
        return (
          <div key={rowIdx} className="overflow-hidden">
            <div
              ref={rowRefs[rowIdx]}
              className="flex gap-3 items-center"
              style={{ width: 'max-content' }}
            >
              {rowIcons.map((src, i) => (
                <img
                  key={`${rowIdx}-${i}`}
                  src={src}
                  alt=""
                  draggable={false}
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
