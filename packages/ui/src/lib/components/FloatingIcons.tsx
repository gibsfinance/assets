import { useMemo } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'

export default function FloatingIcons({ className }: { className?: string }) {
  const { metrics } = useMetricsContext()

  const sources = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported.slice(0, 20).map((net) => getApiUrl(`/image/${net.chainId}`))
  }, [metrics])

  if (sources.length === 0) return null

  // Duplicate icons so the loop is seamless
  const icons = [...sources, ...sources]

  return (
    <div className={`overflow-hidden ${className ?? ''}`} aria-hidden="true">
      <style>{`
        @keyframes conveyor-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      <div
        className="flex gap-6"
        style={{
          width: 'max-content',
          animation: 'conveyor-scroll 30s linear infinite',
        }}
      >
        {icons.map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            className="w-12 h-12 rounded-full shrink-0"
          />
        ))}
      </div>
    </div>
  )
}
