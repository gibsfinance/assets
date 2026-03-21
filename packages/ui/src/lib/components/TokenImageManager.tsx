import { useState, useRef, useCallback } from 'react'
import Image from './Image'
import { getApiUrl } from '../utils'

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
    currentImageUri || getApiUrl(`/image/${chainId}/${address}`),
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
    const defaultUri = getApiUrl(`/image/${chainId}/${address}`)
    setPreviewUri(defaultUri)
    onImageChange(defaultUri)
  }, [chainId, address, onImageChange])

  const format = previewUri.startsWith('data:')
    ? previewUri.split(';')[0].split('/')[1] || 'unknown'
    : previewUri.match(/\.(svg|png|webp|jpg|jpeg|gif)(\?|$)/i)?.[1] || 'auto'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-surface-3 dark:bg-surface-1">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white">Token Image</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/80"
        >
          <i className="fas fa-times text-xs" />
        </button>
      </div>

      {/* Multi-size preview */}
      <div className="mb-3 flex items-end gap-3">
        {PREVIEW_SIZES.map((size) => (
          <div key={size} className="flex flex-col items-center gap-1">
            <Image
              src={
                previewUri.startsWith('data:')
                  ? previewUri
                  : `${previewUri}${previewUri.includes('?') ? '&' : '?'}w=${size}&h=${size}`
              }
              size={size}
              skeleton
              shape="circle"
              className="rounded-full border border-gray-100 dark:border-surface-3"
            />
            <span className="text-[9px] text-gray-400 dark:text-white/30">{size}px</span>
          </div>
        ))}
      </div>

      {/* Format badge */}
      <div className="mb-3">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500 dark:bg-surface-2 dark:text-white/40">
          {format}
        </span>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {/* Upload file */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 transition-colors hover:border-accent-500/40 hover:bg-accent-500/5 dark:border-surface-3 dark:text-white/60 dark:hover:border-accent-500/40"
        >
          <i className="fas fa-upload text-gray-400" />
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
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 dark:border-surface-3 dark:bg-surface-2 dark:text-white dark:placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={handleUrlSubmit}
            disabled={!customUrl.trim()}
            className="rounded-lg bg-gray-100 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50 dark:bg-surface-2 dark:text-white/60 dark:hover:bg-surface-3"
          >
            Set
          </button>
        </div>

        {/* Reset to default */}
        <button
          type="button"
          onClick={handleReset}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600 dark:border-surface-3 dark:text-white/30 dark:hover:text-white/60"
        >
          Reset to default
        </button>
      </div>
    </div>
  )
}
