/**
 * @module formatting
 * Pure formatting and conversion utilities shared across UI components.
 *
 * Extracted from BadgeConfigurator, CountUpNumber, NumberStepper, EndpointCard,
 * TokenImageManager, ListTokenRow, and useVCSPublish to eliminate duplication.
 */

/** Format a 0-1 ratio as a percentage string, e.g. 0.75 → "75%" */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Semantic label for badge overlap amount */
export function overlapLabel(overlap: number): string {
  if (overlap <= -0.4) return 'Float'
  if (overlap >= 0.4) return 'Inset'
  return 'Edge'
}

/** Truncate a hex address for display: 0x1234...5678 */
export function truncateAddress(address: string, prefixLength = 10, suffixLength = 6): string {
  if (address.length <= prefixLength + suffixLength) return address
  return `${address.slice(0, prefixLength)}...${address.slice(-suffixLength)}`
}

/** Cubic ease-out: fast start, slow finish. Input/output in 0-1 range. */
export function cubicEaseOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3)
}

/** Clamp a number between min and max (inclusive) */
export function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Format byte count as human-readable string (B, KB, MB) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Byte count for display, or a word when there is no count to show.
 *
 * Metadata arrives from the image pipeline with nulls in it — an image whose
 * size was never recorded is not an image of zero bytes, and must not read as one.
 */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return 'Unknown'
  return formatBytes(bytes)
}

/**
 * Pixel dimensions for display.
 *
 * A vector image has no pixel size to report, so it says what it is instead of
 * reporting whatever raster dimensions happened to be stored alongside it.
 */
export function formatDimensions(format: string, width: number | null, height: number | null): string {
  if (format === 'SVG') return 'Scalable'
  if (width && height) return `${width} × ${height} px`
  return 'Unknown'
}

/** Detect image format from a URI (data URI or URL with extension) */
export function detectImageFormat(imageUri: string): string {
  if (imageUri.startsWith('data:')) {
    return imageUri.split(';')[0].split('/')[1] || 'unknown'
  }
  return imageUri.match(/\.(svg|png|webp|jpg|jpeg|gif)(\?|$)/i)?.[1] || 'auto'
}

/** Append width/height query params to an image URL, passthrough data URIs */
export function buildImageUrlWithSize(imageUri: string, width: number, height: number): string {
  if (imageUri.startsWith('data:')) return imageUri
  const separator = imageUri.includes('?') ? '&' : '?'
  return `${imageUri}${separator}w=${width}&h=${height}`
}

/** Generate a slugified repo name for a token list */
export function generateRepoName(listName: string, customName?: string): string {
  if (customName) return customName
  return `token-list-${listName.toLowerCase().replace(/\s+/g, '-')}`
}

/** Generate a default commit message for a token list update */
export function generateCommitMessage(listName: string, customMessage?: string): string {
  if (customMessage) return customMessage
  return `Update ${listName} token list`
}
