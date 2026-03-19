import { useState } from 'react'

interface UrlDisplayProps {
  url: string
}

export default function UrlDisplay({ url }: UrlDisplayProps) {
  const [copied, setCopied] = useState(false)

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="card variant-ghost space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Generated URL</span>
        <button className="variant-soft btn btn-sm" onClick={copyToClipboard}>
          {copied ? (
            <>
              <i className="fas fa-check mr-2"></i>
              Copied!
            </>
          ) : (
            <>
              <i className="fas fa-copy mr-2"></i>
              Copy
            </>
          )}
        </button>
      </div>
      <code className="break-all text-sm">{url}</code>
    </div>
  )
}
