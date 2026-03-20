import { useMemo, useEffect, useRef } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const ICONS_PER_ROW = 40
const SIZES = [32, 40, 48]
const DURATIONS = [35, 45, 30]
const DIRECTIONS: Array<'normal' | 'reverse'> = ['normal', 'reverse', 'normal']

// Inject keyframes once into document head
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

  const sources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

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
        const icons = Array.from({ length: ICONS_PER_ROW }, (_, i) =>
          sources[(rowIdx * ICONS_PER_ROW + i) % sources.length]
        )
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
