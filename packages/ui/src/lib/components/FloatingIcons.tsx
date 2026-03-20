import { useMemo } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

const PIPE_HEIGHT = 100
const OVERFLOW_PX = 40
const ICONS_PER_ROW = 20
const ROWS = 3

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

interface IconRow {
  icons: { src: string; size: number; y: number; key: string }[]
  duration: number
}

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()

  const sources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 30).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  const rows = useMemo((): IconRow[] => {
    if (sources.length === 0) return []
    const totalRange = PIPE_HEIGHT + OVERFLOW_PX * 2
    return Array.from({ length: ROWS }, (_, rowIdx) => {
      const sizes = rowIdx === 0 ? [20, 30] : rowIdx === 1 ? [36, 52] : [56, 72]
      const duration = rowIdx === 0 ? 60 : rowIdx === 1 ? 40 : 25
      const icons = Array.from({ length: ICONS_PER_ROW }, (_, i) => {
        const size = Math.floor(randomBetween(sizes[0], sizes[1]))
        const y = -OVERFLOW_PX + Math.random() * (totalRange - size)
        return {
          src: sources[(rowIdx * ICONS_PER_ROW + i) % sources.length],
          size,
          y,
          key: `${rowIdx}-${i}`,
        }
      })
      return { icons, duration }
    })
  }, [sources])

  if (rows.length === 0) return null

  return (
    <div
      className={`relative w-full pointer-events-none select-none ${className ?? ''}`}
      style={{
        height: PIPE_HEIGHT,
        clipPath: `inset(${-OVERFLOW_PX}px 0px ${-OVERFLOW_PX}px 0px)`,
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="absolute inset-0"
          style={{ zIndex: rowIdx }}
        >
          {/* Two copies side by side for seamless looping */}
          <div
            className="flex items-start gap-4 animate-scroll"
            style={{
              animationDuration: `${row.duration}s`,
              width: 'max-content',
            }}
          >
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-start gap-4 shrink-0">
                {row.icons.map((icon) => (
                  <img
                    key={`${icon.key}-${copy}`}
                    src={icon.src}
                    alt=""
                    draggable={false}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    className="rounded-full shrink-0"
                    style={{
                      width: icon.size,
                      height: icon.size,
                      marginTop: icon.y + OVERFLOW_PX,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
