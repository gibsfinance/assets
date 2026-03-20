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

function preloadImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(url)
    img.onerror = () => reject()
    img.src = url
  })
}

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
  const animApplied = useRef(false)

  const candidates = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  // Load and validate icons — only update state twice: once for network icons, once when all tokens are done
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
      if (good.length > 0) {
        animApplied.current = false
        setValidSources(shuffle([...good]))
      }

      // Phase 2: fetch token lists
      try {
        const res = await fetch(getApiUrl('/list'), { signal: controller.signal })
        if (!res.ok) return
        const allLists = await res.json() as Array<{ providerKey: string; key: string; chainId: string }>
        const targetChains = ['1', '369', '56', '137', '42161', '10', '8453']
        const picked: Array<{ providerKey: string; key: string }> = []
        for (const chainId of targetChains) {
          const match = allLists.find((l) => l.chainId === chainId)
          if (match) picked.push(match)
          if (picked.length >= 7) break
        }

        const tokenUrls = new Set<string>()
        for (const list of picked) {
          if (tokenUrls.size >= 500 || cancelled) break
          try {
            const listRes = await fetch(
              getApiUrl(`/list/${list.providerKey}/${list.key}`),
              { signal: controller.signal },
            )
            if (!listRes.ok) continue
            const data = await listRes.json()
            const tokens = (data.tokens || data) as Array<{ chainId: number; address: string }>
            if (!Array.isArray(tokens)) continue
            for (const t of tokens.slice(0, 100)) {
              if (t.chainId && t.address) {
                tokenUrls.add(getApiUrl(`/image/${t.chainId}/${t.address}`))
              }
            }
          } catch { /* skip */ }
        }

        if (cancelled) return

        // Preload ALL token icons, then update once
        const urlArr = [...tokenUrls]
        const tokenGood: string[] = []
        for (let i = 0; i < urlArr.length; i += 20) {
          if (cancelled) break
          const batch = urlArr.slice(i, i + 20)
          const results = await Promise.allSettled(batch.map(preloadImage))
          for (const r of results) {
            if (r.status === 'fulfilled') tokenGood.push(r.value)
          }
        }

        // Single update when all tokens are validated
        if (!cancelled && tokenGood.length > 0) {
          animApplied.current = false
          setValidSources(shuffle([...good, ...tokenGood]))
        }
      } catch { /* aborted */ }
    }

    void load()
    return () => { cancelled = true; controller.abort() }
  }, [candidates])

  // Memoize row icon arrays so they don't change on re-render
  const rowIcons = useMemo(() => {
    if (validSources.length === 0) return [[], [], []]
    return [0, 1, 2].map((rowIdx) => {
      const perRow = ICONS_PER_ROW * 2
      const icons: string[] = []
      for (let i = 0; i < perRow; i++) {
        icons.push(validSources[(rowIdx * perRow + i) % validSources.length])
      }
      return icons
    })
  }, [validSources])

  // Apply animation only when sources change (not every render)
  useEffect(() => {
    if (validSources.length === 0 || animApplied.current) return
    ensureKeyframes()
    // Small delay to let React commit the DOM first
    requestAnimationFrame(() => {
      for (let i = 0; i < rowRefs.length; i++) {
        const el = rowRefs[i].current
        if (!el) continue
        el.style.setProperty('animation', 'none', 'important')
        // Force reflow to restart animation cleanly
        void el.offsetHeight
        el.style.setProperty('animation', `conveyor ${DURATIONS[i]}s linear infinite ${DIRECTIONS[i]}`, 'important')
      }
      animApplied.current = true
    })
  }, [validSources])

  if (validSources.length === 0) return null

  return (
    <div className={`overflow-hidden space-y-1 ${className ?? ''}`} aria-hidden="true">
      {rowIcons.map((icons, rowIdx) => (
        <div key={rowIdx} className="overflow-hidden">
          <div
            ref={rowRefs[rowIdx]}
            className="flex gap-3 items-center"
            style={{ width: 'max-content' }}
          >
            {icons.map((src, i) => (
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
      ))}
    </div>
  )
}
