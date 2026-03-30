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
