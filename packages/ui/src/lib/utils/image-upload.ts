import { getApiUrl } from './index'

export interface ImageSubmitResult {
  imageHash: string
  imageUrl: string
}

/**
 * POST a token image to the server for storage.
 * Returns the canonical image hash and URL on success.
 * Throws with a descriptive message on failure.
 */
export async function submitImage(
  chainId: number,
  address: string,
  dataUri: string,
): Promise<ImageSubmitResult> {
  const res = await fetch(getApiUrl('/api/images/submit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId,
      address,
      image: dataUri,
      submittedBy: 'anon',
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error((err as { error?: string }).error || `Upload failed: ${res.status}`)
  }
  return res.json() as Promise<ImageSubmitResult>
}

const MAX_SIZE = 512 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

/**
 * Validate a File before upload.
 * Returns null if valid, or a human-readable error message string if invalid.
 */
export function validateImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Unsupported format: ${file.type}. Use PNG, JPG, GIF, WebP, or SVG.`
  }
  if (file.size > MAX_SIZE) {
    return `Image too large (${Math.round(file.size / 1024)}KB). Max 512KB.`
  }
  return null
}

/**
 * Read a File as a base64-encoded data URI string.
 */
export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
