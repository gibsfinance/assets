/**
 * Pan and zoom arithmetic for the studio's infinite canvas.
 *
 * These functions were the body of two event handlers inside a 780-line
 * component. Reaching them meant rendering the whole configurator, stubbing a
 * ResizeObserver and a matchMedia, faking a bounding rectangle that jsdom
 * cannot produce, and dispatching a wheel event — all to check three lines of
 * multiplication. Here they are ordinary functions over ordinary numbers, so
 * the invariant that matters can be stated directly.
 */

/** Where the canvas content sits, and how far it is scaled. */
export interface CanvasTransform {
  /** Horizontal offset of the content in screen pixels. */
  x: number
  /** Vertical offset of the content in screen pixels. */
  y: number
  /** Scale factor. 1 shows the content at its natural size. */
  zoom: number
}

/** Closest the view may zoom out. */
export const MIN_ZOOM = 0.25
/** Closest the view may zoom in. */
export const MAX_ZOOM = 4

/** The unscaled, unmoved view. */
export const IDENTITY_TRANSFORM: CanvasTransform = Object.freeze({ x: 0, y: 0, zoom: 1 })

/** Hold a zoom factor inside the allowed range. */
export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/**
 * Move the content by a screen-space delta.
 *
 * The offsets are screen pixels, not content pixels, so a drag moves the
 * content the same distance under the cursor at every zoom level.
 */
export const panBy = (transform: CanvasTransform, dx: number, dy: number): CanvasTransform => ({
  ...transform,
  x: transform.x + dx,
  y: transform.y + dy,
})

/** A wheel gesture, in coordinates relative to the canvas element. */
export interface ZoomGesture {
  /** Pointer position from the left edge of the canvas. */
  pointerX: number
  /** Pointer position from the top edge of the canvas. */
  pointerY: number
  /** Wheel delta. Positive scrolls away from the viewer and zooms out. */
  deltaY: number
}

/** How much one unit of wheel delta changes the zoom factor. */
export const WHEEL_ZOOM_SENSITIVITY = 0.001

/**
 * Zoom toward the pointer.
 *
 * The invariant: the point of content under the cursor stays under the cursor.
 * Scaling alone would pull the content toward the origin, so the offset is
 * rewritten to put the same content point back beneath the same screen point.
 * Dropping that correction leaves a canvas that drifts away from wherever the
 * user is pointing, which is why the offsets move even when the zoom is already
 * clamped and the scale is 1.
 */
export const zoomAtPointer = (transform: CanvasTransform, gesture: ZoomGesture): CanvasTransform => {
  const { pointerX, pointerY, deltaY } = gesture
  const zoom = clampZoom(transform.zoom * (1 - deltaY * WHEEL_ZOOM_SENSITIVITY))
  const scale = zoom / transform.zoom
  return {
    x: pointerX - scale * (pointerX - transform.x),
    y: pointerY - scale * (pointerY - transform.y),
    zoom,
  }
}

/**
 * Content coordinates of a screen point, given the transform showing it.
 *
 * The inverse of the mapping `zoomAtPointer` preserves. Tests use it to state
 * the invariant as an equality rather than as a restatement of the arithmetic
 * under test.
 */
export const screenToContent = (
  transform: CanvasTransform,
  screenX: number,
  screenY: number,
): { x: number; y: number } => ({
  x: (screenX - transform.x) / transform.zoom,
  y: (screenY - transform.y) / transform.zoom,
})
