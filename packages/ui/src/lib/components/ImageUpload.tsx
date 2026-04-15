import { useRef, useCallback } from 'react'
import { validateImageFile, readFileAsDataUri } from '../utils/image-upload'

interface ImageUploadProps {
  onUpload: (dataUri: string) => void
  /** Currently set image URL — shows preview when provided */
  currentImage?: string
  /** Pixel size of the upload area (default 32) */
  size?: number
}

/**
 * Compact inline image upload widget sized to fit within a token row.
 * Click to browse or drag-and-drop a file.
 * Validates type and size, then calls onUpload with the data URI.
 */
export default function ImageUpload({ onUpload, currentImage, size = 32 }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      const error = validateImageFile(file)
      if (error) {
        // Surface validation errors as a non-blocking console warning;
        // callers that need UI feedback can wrap with their own error handling
        console.warn('[ImageUpload]', error)
        return
      }
      const dataUri = await readFileAsDataUri(file)
      onUpload(dataUri)
    },
    [onUpload],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files)
      // Reset so re-selecting the same file triggers onChange again
      e.target.value = ''
    },
    [handleFiles],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault()
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{ width: size, height: size }}
        className={[
          'flex flex-shrink-0 items-center justify-center rounded-full transition-colors',
          currentImage
            ? 'overflow-hidden ring-2 ring-transparent hover:ring-accent-500/40'
            : 'border border-dashed border-gray-300 bg-gray-50 hover:border-accent-500/60 hover:bg-accent-500/5 dark:border-white/20 dark:bg-surface-2 dark:hover:border-accent-500/60',
        ].join(' ')}
        title="Upload token image"
        aria-label="Upload token image"
      >
        {currentImage ? (
          <img
            src={currentImage}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <i
            className="fas fa-camera text-gray-400 dark:text-white/30"
            style={{ fontSize: Math.max(10, size * 0.4) }}
          />
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        onChange={handleChange}
        className="hidden"
        aria-hidden="true"
      />
    </>
  )
}
