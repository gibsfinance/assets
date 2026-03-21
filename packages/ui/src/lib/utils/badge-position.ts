/**
 * Computes the absolute position and size of a badge image rendered over a
 * circular container token icon.
 *
 * @param containerSize - Width/height of the square token container in pixels
 * @param angleDeg      - Clock-face angle in degrees (0 = top, 90 = right, …)
 * @param sizeRatio     - Badge diameter as a fraction of containerSize (0–1)
 * @param overlap       - Overlap factor: negative = floating, positive = inset
 * @returns Pixel coordinates and badge size for use in inline `style` objects
 */
export function badgePositionToCSS(
  containerSize: number,
  angleDeg: number,
  sizeRatio: number,
  overlap: number,
): { top: number; left: number; badgeSize: number } {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  const badgeSize = containerSize * sizeRatio
  const radius = containerSize / 2 + (badgeSize / 2) * (1 - overlap * 2)
  const left = containerSize / 2 + Math.cos(rad) * radius - badgeSize / 2
  const top = containerSize / 2 + Math.sin(rad) * radius - badgeSize / 2
  return { top, left, badgeSize }
}
