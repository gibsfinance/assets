import { useCallback, useState } from 'react'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useStudio } from '../contexts/StudioContext'
import { useImageMetadata } from '../hooks/useImageMetadata'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import Image from './Image'
import type { Token } from '../types'

interface TokenDetailModalProps {
  token: Token | null
  onClose: () => void
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDimensions(
  format: string,
  width: number | null,
  height: number | null,
): string {
  if (format === 'SVG') return 'Scalable'
  if (width && height) return `${width} × ${height} px`
  return 'Unknown'
}

interface CopyButtonProps {
  text: string
}

function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-white/40 transition-all hover:bg-accent-500/10 hover:text-accent-500"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      <i className={`fas ${copied ? 'fa-check text-accent-500' : 'fa-copy'} text-xs`} />
    </button>
  )
}

interface MetadataRowProps {
  label: string
  value: string
}

function MetadataRow({ label, value }: MetadataRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-xs font-medium text-white/80">{value}</span>
    </div>
  )
}

export default function TokenDetailModal({ token, onClose }: TokenDetailModalProps) {
  const { selectToken } = useStudio()

  const imageUrl = token
    ? getApiUrl(`/image/${token.chainId}/${token.address}`)
    : null

  const { metadata, isLoading } = useImageMetadata(imageUrl)

  const handleConfigureInStudio = useCallback(() => {
    if (!token) return
    selectToken(token)
    onClose()
  }, [token, selectToken, onClose])

  const handleCopyUrl = useCallback(async () => {
    if (!imageUrl) return
    await navigator.clipboard.writeText(imageUrl)
  }, [imageUrl])

  return (
    <Dialog open={token !== null} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="elevated-card w-full max-w-[480px] overflow-hidden p-6">
          {token && (
            <>
              {/* Close button */}
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-surface-2 hover:text-white/80"
                aria-label="Close"
              >
                <i className="fas fa-times text-sm" />
              </button>

              {/* Hero */}
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
                  <Image
                    src={imageUrl!}
                    alt={token.symbol}
                    size={48}
                    className="rounded-full object-contain"
                  />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white/95">{token.name}</h2>
                  <p className="text-sm text-white/50">
                    {token.symbol} &middot; {getNetworkName(token.chainId)}
                  </p>
                </div>
              </div>

              {/* Image metadata grid */}
              <div className="mb-4 rounded-xl bg-surface-2 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">
                  Image Metadata
                </p>
                {isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <i className="fas fa-spinner fa-spin" />
                    Loading metadata…
                  </div>
                ) : metadata ? (
                  <div className="flex flex-col gap-2">
                    <MetadataRow label="Format" value={metadata.format} />
                    <MetadataRow
                      label="Dimensions"
                      value={formatDimensions(metadata.format, metadata.width, metadata.height)}
                    />
                    <MetadataRow label="File Size" value={formatFileSize(metadata.fileSize)} />

                    {/* SVG resolution-independent badge */}
                    {metadata.format === 'SVG' && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/15 px-2.5 py-1 text-xs font-medium text-accent-500">
                          <i className="fas fa-check-circle text-[10px]" />
                          Resolution Independent
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-white/30">Metadata unavailable</p>
                )}
              </div>

              {/* List presence */}
              <div className="mb-4 rounded-xl bg-surface-2 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">
                  Source List
                </p>
                <span className="inline-flex items-center rounded-full bg-surface-3 px-3 py-1 text-xs font-medium text-white/70 ring-1 ring-white/10">
                  {token.sourceList}
                </span>
              </div>

              {/* API endpoint */}
              <div className="mb-6 rounded-xl bg-surface-2 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">
                  API Endpoint
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-surface-base px-3 py-2 font-mono text-xs text-accent-400">
                    {`/image/${token.chainId}/${token.address}`}
                  </code>
                  <CopyButton text={imageUrl!} />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleConfigureInStudio}
                  className="btn-primary flex-1 text-sm"
                >
                  <i className="fas fa-sliders-h mr-2" />
                  Configure in Studio
                </button>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="btn-secondary text-sm"
                  title="Copy image URL"
                >
                  <i className="fas fa-copy mr-2" />
                  Copy URL
                </button>
              </div>
            </>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
