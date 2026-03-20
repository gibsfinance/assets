import { useState, useEffect } from 'react'
import type { ImageMetadata } from '../types'

const cache = new Map<string, ImageMetadata>()
const pending = new Map<string, Promise<ImageMetadata>>()

async function fetchMetadata(url: string): Promise<ImageMetadata> {
  const cached = cache.get(url)
  if (cached) return cached

  const inflight = pending.get(url)
  if (inflight) return inflight

  const promise = (async () => {
    let format = 'unknown'
    let fileSize: number | null = null
    let contentType = 'unknown'

    try {
      const res = await fetch(url, { method: 'HEAD' })
      contentType = res.headers.get('content-type') ?? 'unknown'
      const cl = res.headers.get('content-length')
      fileSize = cl ? parseInt(cl, 10) : null

      if (contentType.includes('svg')) format = 'SVG'
      else if (contentType.includes('png')) format = 'PNG'
      else if (contentType.includes('webp')) format = 'WEBP'
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) format = 'JPEG'
      else if (contentType.includes('gif')) format = 'GIF'
    } catch {
      // HEAD failed, fall back to image decode for dimensions
    }

    let width: number | null = null
    let height: number | null = null

    if (format !== 'SVG') {
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Image load failed'))
          img.src = url
        })
        width = img.naturalWidth
        height = img.naturalHeight
      } catch {
        // Image decode failed
      }
    }

    const metadata: ImageMetadata = { format, width, height, fileSize, contentType }
    cache.set(url, metadata)
    pending.delete(url)
    return metadata
  })()

  pending.set(url, promise)
  return promise
}

export function useImageMetadata(url: string | null): {
  metadata: ImageMetadata | null
  isLoading: boolean
} {
  const [metadata, setMetadata] = useState<ImageMetadata | null>(
    url ? cache.get(url) ?? null : null,
  )
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!url) {
      setMetadata(null)
      return
    }

    const cached = cache.get(url)
    if (cached) {
      setMetadata(cached)
      return
    }

    setIsLoading(true)
    fetchMetadata(url).then((m) => {
      setMetadata(m)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [url])

  return { metadata, isLoading }
}
