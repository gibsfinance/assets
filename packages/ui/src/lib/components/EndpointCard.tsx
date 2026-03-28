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

/**
 * Splits an endpoint path into segments, highlighting `{param}` style
 * parameter tokens with accent color.
 */
function PathDisplay({ path }: { path: string }) {
  const parts = path.split(/(\{[^}]+\})/)

  return (
    <span className="font-mono text-sm">
      {parts.map((part, index) => {
        const isParam = /^\{[^}]+\}$/.test(part)
        return isParam ? (
          <span key={index} className="text-accent-500">
            {part}
          </span>
        ) : (
          <span key={index} className="text-gray-900 dark:text-white">
            {part}
          </span>
        )
      })}
    </span>
  )
}

function isImageEndpoint(url: string): boolean {
  return /\/image\//.test(url)
}

function ResponsePreview({ url }: { url: string }) {
  const [json, setJson] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (isImageEndpoint(url)) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setJson(null)

    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data) => {
        if (!ac.signal.aborted) setJson(data)
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [url])

  if (isImageEndpoint(url)) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Preview:</span>
        <Image
          src={url}
          alt="Endpoint example preview"
          size={32}
          className="rounded-full"
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="text-xs text-gray-400 dark:text-white/30">
        <i className="fas fa-spinner fa-spin mr-1" /> Loading...
      </div>
    )
  }

  if (error) {
    return <div className="text-xs text-red-400">{error}</div>
  }

  if (json) {
    const formatted = JSON.stringify(json, null, 2)
    const truncated = formatted.length > 2000 ? formatted.slice(0, 2000) + '\n  ...' : formatted
    return <CodeBlock code={truncated} lang="js" classes="text-xs max-h-64 overflow-auto" />
  }

  return null
}

export default function EndpointCard({ method, path, description, example }: EndpointCardProps) {
  const [url, setUrl] = useState(example ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

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
                    ref={inputRef}
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 rounded border border-border-light dark:border-border-dark bg-white dark:bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-gray-900 dark:text-white/80 outline-none focus:ring-1 focus:ring-accent-500/50"
                  />
                </div>
                <ResponsePreview url={url} />
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </div>
  )
}
