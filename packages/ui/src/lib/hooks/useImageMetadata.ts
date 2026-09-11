import { useQuery } from '@tanstack/react-query'
import type { ImageMetadata } from '../types'

export async function fetchImageMetadata(url: string): Promise<ImageMetadata> {
  let format = 'unknown'
  let fileSize: number | null = null
  let contentType = 'unknown'
  // Whether anything at all was learned. Both readings below are allowed to fail
  // on their own, because either one alone still tells the reader something. What
  // is not reported is both of them failing: this used to return
  // `format: 'unknown'` with every field empty, so a total failure rendered a
  // table of the word "Unknown" instead of the "Metadata unavailable" line the
  // caller already had written for exactly that case.
  let learnedSomething = false

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
    learnedSomething = true
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
      learnedSomething = true
    } catch {
      // Image decode failed
    }
  }

  if (!learnedSomething) {
    // Nothing answered. Raised rather than returned so the caller can say the
    // metadata is unavailable, which is true, instead of presenting empty fields
    // as though they were the answer.
    throw new Error(`no metadata available for ${url}`)
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
