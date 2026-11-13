import { useState, useRef, useCallback } from 'react'
import Image from './Image'
import { getApiUrl } from '../utils'
import { detectImageFormat, buildImageUrlWithSize } from '../utils/formatting'
import { toChainIdentifier } from '../utils/chain-identifier'
import { faUpload, faXmark } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

interface TokenImageManagerProps {
  chainId: number
  address: string
  currentImageUri?: string
  onImageChange: (uri: string) => void
  onClose: () => void
}

const PREVIEW_SIZES = [32, 64, 128, 256]

export default function TokenImageManager({
  chainId,
  address,
  currentImageUri,
  onImageChange,
  onClose,
}: TokenImageManagerProps) {
  const [previewUri, setPreviewUri] = useState(
    currentImageUri || getApiUrl(`/image/${toChainIdentifier(chainId)}/${address}`),
  )
  const [customUrl, setCustomUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUri = reader.result as string
        setPreviewUri(dataUri)
        onImageChange(dataUri)
      }
      reader.readAsDataURL(file)
    },
    [onImageChange],
  )

  const handleUrlSubmit = useCallback(() => {
    if (!customUrl.trim()) return
    setPreviewUri(customUrl.trim())
    onImageChange(customUrl.trim())
    setCustomUrl('')
  }, [customUrl, onImageChange])

  const handleReset = useCallback(() => {
    const defaultUri = getApiUrl(`/image/${toChainIdentifier(chainId)}/${address}`)
    setPreviewUri(defaultUri)
    onImageChange(defaultUri)
  }, [chainId, address, onImageChange])

  const format = detectImageFormat(previewUri)

  return (
    <div className="rounded-lg border border-border-strong bg-surface-raised p-4 shadow-lg">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-content-strong">Token Image</h4>
        <button type="button" onClick={onClose} className="text-content-faint hover:text-content-secondary">
          <Icon icon={faXmark} className="text-xs" />
        </button>
      </div>

      {/* Multi-size preview */}
      <div className="mb-3 flex items-end gap-3">
        {PREVIEW_SIZES.map((size) => (
          <div key={size} className="flex flex-col items-center gap-1">
            <Image
              src={buildImageUrlWithSize(previewUri, size, size)}
              size={size}
              skeleton
              shape="circle"
              className="rounded-full border border-border-strong"
            />
            <span className="text-[9px] text-content-faint">{size}px</span>
          </div>
        ))}
      </div>

      {/* Format badge */}
      <div className="mb-3">
        <span className="rounded bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium uppercase text-content-subtle">
          {format}
        </span>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {/* Upload file */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs text-content-muted transition-colors hover:border-accent/40 hover:bg-accent/5">
          <Icon icon={faUpload} className="text-content-faint" />
          Upload image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/svg+xml,image/png,image/webp,image/jpeg"
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* URL input */}
        <div className="flex gap-1.5">
          <input
            type="url"
            placeholder="Image URL..."
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            className="flex-1 rounded-lg border border-border-strong bg-surface-inset px-2 py-1.5 text-xs text-content-strong placeholder:text-content-faint"
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={!customUrl.trim()}
            className="rounded-lg bg-surface-inset px-2 py-1.5 text-xs text-content-muted hover:bg-surface-active disabled:opacity-50">
            Set
          </button>
        </div>

        {/* Reset to default */}
        <button
          type="button"
          onClick={handleReset}
          className="w-full rounded-lg border border-border-strong px-3 py-1.5 text-xs text-content-faint transition-colors hover:text-content-muted">
          Reset to default
        </button>
      </div>
    </div>
  )
}
