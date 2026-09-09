/**
 * Angle arithmetic for the badge position picker.
 *
 * Zero degrees is the top of the circle, and the angle runs clockwise: 90 is
 * the right edge, 180 the bottom, 270 the left. That is the convention the
 * badge itself uses, so the picker and the rendered badge agree without a
 * conversion between them.
 */

/** Diameter of the circular track, in pixels. */
export const CIRCLE_SIZE = 120
/** Diameter of the draggable handle, in pixels. */
export const HANDLE_SIZE = 12
/** Centre of the track, in track coordinates. */
export const CENTER = CIRCLE_SIZE / 2
/** Distance from the centre the handle sits at. Keeps the handle inside the border. */
export const RADIUS = (CIRCLE_SIZE - HANDLE_SIZE - 4) / 2

/** The top-left corner of the track in page coordinates. */
export interface TrackOrigin {
  left: number
  top: number
}

/** Bring any angle into 0–359, so -90 and 630 both read as 270. */
export const normalizeAngle = (angleDeg: number): number => ((angleDeg % 360) + 360) % 360

/**
 * The angle a pointer sits at, relative to the centre of the track.
 *
 * `Math.atan2` puts zero at the right edge and counts counter-clockwise in a
 * coordinate system whose y axis points down; the 90-degree offset moves zero
 * to the top, and the downward y axis is what makes the result run clockwise.
 */
export const angleFromPointer = (clientX: number, clientY: number, origin: TrackOrigin): number => {
  const dx = clientX - (origin.left + CENTER)
  const dy = clientY - (origin.top + CENTER)
  return normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI + 90)
}

/** Where the handle sits on the circle for a given angle, in track coordinates. */
export const handlePosition = (angleDeg: number): { x: number; y: number } => {
  const radians = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: CENTER + RADIUS * Math.cos(radians),
    y: CENTER + RADIUS * Math.sin(radians),
  }
}
