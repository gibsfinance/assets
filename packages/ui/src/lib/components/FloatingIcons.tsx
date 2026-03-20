import { useMemo } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const ICONS_PER_ROW = 20
const SIZES = [32, 40, 48]
const DURATIONS = [35, 45, 30]

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()

  const sources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  if (sources.length === 0) return null

  const rows = [
    { size: SIZES[0], duration: DURATIONS[0], direction: 'right' as const },
    { size: SIZES[1], duration: DURATIONS[1], direction: 'left' as const },
    { size: SIZES[2], duration: DURATIONS[2], direction: 'right' as const },
  ]

  return (
    <div className={`overflow-hidden space-y-2 ${className ?? ''}`} aria-hidden="true">
      <style>{`
        @keyframes conveyor-right {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes conveyor-left {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .conveyor-row { animation: none !important; }
        }
      `}</style>
      {rows.map((row, rowIdx) => {
        const icons = Array.from({ length: ICONS_PER_ROW }, (_, i) =>
          sources[(rowIdx * ICONS_PER_ROW + i) % sources.length]
        )
        const doubled = [...icons, ...icons]

        return (
          <div key={rowIdx} className="overflow-hidden">
            <div
              className="conveyor-row flex gap-4 items-center"
              style={{
                width: 'max-content',
                animation: `conveyor-${row.direction} ${row.duration}s linear infinite`,
              }}
            >
              {doubled.map((src, i) => (
                <img
                  key={`${rowIdx}-${i}`}
                  src={src}
                  alt=""
                  draggable={false}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  className="rounded-full shrink-0"
                  style={{ width: row.size, height: row.size }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
