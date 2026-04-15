import { useQuery } from '@tanstack/react-query'
import type { ImageMetadata } from '../types'

export async function fetchImageMetadata(url: string): Promise<ImageMetadata> {
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
    // HEAD failed — fall back to image decode for dimensions
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

  return { format, width, height, fileSize, contentType }
}

export function useImageMetadata(url: string | null): {
  metadata: ImageMetadata | null
  isLoading: boolean
} {
  const { data, isLoading } = useQuery({
    queryKey: ['imageMetadata', url],
    queryFn: () => fetchImageMetadata(url!),
    enabled: !!url,
    staleTime: Infinity,
  })

  return { metadata: data ?? null, isLoading }
}
