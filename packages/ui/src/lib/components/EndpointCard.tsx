import { useState, useCallback, useEffect, useRef } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import CodeBlock from './CodeBlock'
import Image from './Image'

interface EndpointCardProps {
  method: string
  path: string
  description: string
  example?: string
}

function PathDisplay({ path }: { path: string }) {
  const parts = path.split(/(\{[^}]+\})/)
  return (
    <span className="font-mono text-sm">
      {parts.map((part, index) => {
        const isParam = /^\{[^}]+\}$/.test(part)
        return isParam ? (
          <span key={index} className="text-accent-500">{part}</span>
        ) : (
          <span key={index} className="text-gray-900 dark:text-white">{part}</span>
        )
      })}
    </span>
  )
}

function isImageEndpoint(url: string): boolean {
  return /\/image\//.test(url) || /\/sprite\//.test(url)
}

interface ResponseStats {
  status: number
  duration: number
  size: number
  cacheHit: boolean
  contentType: string
  resultCount: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatsPanel({ stats, loading, error }: { stats: ResponseStats | null; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="text-xs text-gray-400 dark:text-white/30">
        <i className="fas fa-spinner fa-spin mr-1" /> Fetching...
      </div>
    )
  }

  if (error) {
    return <div className="text-xs text-red-400">{error}</div>
  }

  if (!stats) return null

  const rows: [string, string][] = [
    ['Status', String(stats.status)],
    ['Time', `${stats.duration}ms`],
    ['Size', formatBytes(stats.size)],
    ['Cache', stats.cacheHit ? 'HIT' : 'MISS'],
    ['Type', stats.contentType.split(';')[0]],
  ]
  if (stats.resultCount !== null) {
    rows.push(['Results', stats.resultCount.toLocaleString()])
  }

  return (
    <div className="space-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-white/30">{label}</span>
          <span className={`font-mono text-xs ${
            label === 'Status' && stats.status >= 400 ? 'text-red-400' :
            label === 'Cache' && stats.cacheHit ? 'text-green-400' :
            'text-gray-700 dark:text-white/70'
          }`}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function countResults(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if ('total' in obj && typeof obj.total === 'number') return obj.total
  if ('tokens' in obj && Array.isArray(obj.tokens)) return obj.tokens.length
  if (Array.isArray(data)) return data.length
  return null
}

function ResponsePanel({ url }: { url: string }) {
  const [json, setJson] = useState<unknown>(null)
  const [stats, setStats] = useState<ResponseStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setJson(null)
    setStats(null)

    const isImage = isImageEndpoint(url)
    const start = performance.now()

    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        const duration = Math.round(performance.now() - start)
        const cacheHeader = r.headers.get('cf-cache-status') || r.headers.get('x-cache') || ''
        const cacheHit = /HIT/i.test(cacheHeader)
        const contentType = r.headers.get('content-type') || ''

        if (isImage) {
          const blob = await r.blob()
          if (ac.signal.aborted) return
          setStats({
            status: r.status,
            duration,
            size: blob.size,
            cacheHit,
            contentType,
            resultCount: null,
          })
          return
        }

        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const text = await r.text()
        if (ac.signal.aborted) return
        const data = JSON.parse(text)
        setJson(data)
        setStats({
          status: r.status,
          duration,
          size: text.length,
          cacheHit,
          contentType,
          resultCount: countResults(data),
        })
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [url])

  const isImage = isImageEndpoint(url)

  return (
    <div className="flex gap-4">
      <div className="w-32 shrink-0 border-r border-border-light dark:border-border-dark pr-4">
        <StatsPanel stats={stats} loading={loading} error={error} />
      </div>
      <div className="min-w-0 flex-1">
        {isImage ? (
          <div className="flex items-center gap-3">
            <Image src={url} alt="Preview" size={48} className="rounded-lg" />
          </div>
        ) : loading ? (
          <div className="text-xs text-gray-400 dark:text-white/30">
            <i className="fas fa-spinner fa-spin mr-1" /> Loading response...
          </div>
        ) : error ? (
          <div className="text-xs text-red-400">{error}</div>
        ) : json ? (
          (() => {
            const formatted = JSON.stringify(json, null, 2)
            const truncated = formatted.length > 2000 ? formatted.slice(0, 2000) + '\n  ...' : formatted
            return <CodeBlock code={truncated} lang="js" classes="text-xs max-h-64 overflow-auto" />
          })()
        ) : null}
      </div>
    </div>
  )
}

export default function EndpointCard({ method, path, description, example }: EndpointCardProps) {
  const [url, setUrl] = useState(example ?? '')

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0 rounded-full bg-accent-500/15 px-2.5 py-0.5 text-xs font-semibold text-accent-500 ring-1 ring-accent-500/30">
          {method}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <PathDisplay path={path} />
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
      </div>

      {example && (
        <Disclosure>
          {({ open }) => (
            <>
              <DisclosureButton className="flex w-full items-center justify-between border-t border-border-light dark:border-border-dark px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 transition-colors hover:bg-white/[0.02] hover:text-gray-700 dark:hover:text-gray-300">
                <span>Try it</span>
                <i className={`fas fa-chevron-down text-[10px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </DisclosureButton>
              <DisclosurePanel className="border-t border-border-light dark:border-border-dark bg-surface-light-1 dark:bg-surface-1 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">GET</span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 rounded border border-border-light dark:border-border-dark bg-white dark:bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-gray-900 dark:text-white/80 outline-none focus:ring-1 focus:ring-accent-500/50"
                  />
                </div>
                <ResponsePanel url={url} />
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </div>
  )
}
